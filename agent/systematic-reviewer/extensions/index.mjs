// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Systematic Reviewer V3; see ../NOTICE.
import { Type } from 'typebox';
import { withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { resolve } from 'node:path';
import { citationMarker } from '../lib/markdown.mjs';
import { renderDocument } from '../lib/citations.mjs';
import { ReferencesClient, officeRequest } from '../lib/client.mjs';
import { readText, writeOutput } from '../lib/io.mjs';
import { reviewSetup } from '../lib/review-setup.mjs';

const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], details: data, structuredContent: data });
const citationItem = Type.Object({
  id: Type.String({ description: 'Verified bkref:<backend>/<project>/<item> identity; legacy identities require explicit References mapping' }),
  locator: Type.Optional(Type.String()), label: Type.Optional(Type.String()),
  prefix: Type.Optional(Type.String()), suffix: Type.Optional(Type.String()),
  'suppress-author': Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const local = (ctx, path) => resolve(ctx.cwd, path);

export default function systematicReviewer(pi) {
  pi.registerCommand('review-setup', { description: 'Inspect shared References service configuration or open its private OpenAlex settings', handler: reviewSetup });
  const lookup = name => ({
    name, label: 'Read References', exposure: 'deferred',
    description: `${name === 'review_zotero' ? 'Compatibility alias for review_references. ' : ''}Read one bounded References page or selected verified identities into a portable CSL snapshot. projectId is an explicit independent References database ID, separate from a BashKitten workspace; Default and user/agent-created projects are listed by GET /projects. Returned bkref identities belong to this backend. Use the references tool for shared imports, enrichment, full text, PDFs and library mutations.`,
    parameters: Type.Object({ operation: Type.Union([Type.Literal('search'), Type.Literal('snapshot')]), projectId: Type.String(),
      ids: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 100 })), query: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), start: Type.Optional(Type.Integer({ minimum: 0 })), cursor: Type.Optional(Type.String({ description: 'Returned keyset cursor; reload when concurrent library edits invalidate it' })),
      output: Type.String(), overwrite: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      const output = local(ctx, params.output);
      return withFileMutationQueue(output, async () => {
        const client = new ReferencesClient({ projectId: params.projectId });
        const data = params.operation === 'snapshot' ? await client.snapshot(params.ids, { signal }) : await client.search({ ...params, signal });
        await writeOutput(output, `${JSON.stringify(data, null, 2)}\n`, { overwrite: params.overwrite, signal });
        return result({ path: output, count: data.items.length,
          preview: data.items.slice(0, 20).map(item => ({ id: item.id, title: String(item.itemData.title ?? '').slice(0, 250) })), page: data.page ?? null });
      });
    },
  });
  pi.registerTool(lookup('review_references'));
  pi.registerTool(lookup('review_zotero'));
  pi.registerTool({
    name: 'review_citation', label: 'Build citation marker', exposure: 'deferred',
    description: 'Build a durable Markdown sr-cite marker from verified References identities and optional locators/affixes. This optional source syntax is not a live Office edit; use office citations.insert/edit for managed native citations visible to the user.',
    parameters: Type.Object({ items: Type.Array(citationItem, { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }),
    async execute(_id, params) { return result({ marker: citationMarker(params.items) }); },
  });
  pi.registerTool({
    name: 'review_render_citations', label: 'Render Markdown citations', exposure: 'deferred',
    description: 'Render the complete Markdown citation state through the same References CSL service used by live Office. Preserves sr-cite identities and document order; supports verified offline reference snapshots as input. Native Office citations/notes/bibliography use office commands. Returns a summary, not the manuscript.',
    parameters: Type.Object({ projectId: Type.String(), input: Type.String(), output: Type.String(),
      references: Type.Optional(Type.String()), style: Type.Optional(Type.String({ description: 'Installed CSL style ID or URL' })),
      locale: Type.Optional(Type.String()), overwrite: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      const output = local(ctx, params.output), referencePath = params.references && local(ctx, params.references);
      if (output === referencePath) throw Error('Output must not replace its reference snapshot');
      return withFileMutationQueue(output, async () => {
        const markdown = await readText(local(ctx, params.input), { signal });
        const snapshot = referencePath ? JSON.parse(await readText(referencePath, { signal })) : undefined;
        const rendered = await renderDocument(markdown, snapshot, { ...params, signal });
        await writeOutput(output, rendered.markdown, { overwrite: params.overwrite, signal });
        return result({ path: output, citations: rendered.citations.length, bibliographyEntries: rendered.bibliography?.entries.length ?? 0, style: rendered.style });
      });
    },
  });
  pi.registerTool({
    name: 'review_export_docx', label: 'Export Office DOCX', exposure: 'deferred',
    description: 'Save and export the current live Collabora document as DOCX with its managed citation fields through native Office. Open/import/edit first with office, then supply the returned agent sessionId. No offline DOCX serializer, separate desktop process or later external Refresh. Return the acknowledged export and normal viewing URL.',
    parameters: Type.Object({ sessionId: Type.String(), name: Type.Optional(Type.String({ description: 'Export filename, not a server filesystem path' })) }, { additionalProperties: false }),
    async execute(_id, params, signal) {
      if (!/^[A-Za-z0-9._~-]+$/.test(params.sessionId) || ['.', '..'].includes(params.sessionId)) throw Error('Use the returned native Office sessionId');
      const route = `/sessions/${encodeURIComponent(params.sessionId)}/commands`;
      await officeRequest('POST', route, { operation: 'save' }, { signal });
      const response = await officeRequest('POST', route, { operation: 'export', format: 'docx',
        name: params.name || 'document.docx' }, { signal });
      return result(response.body);
    },
  });
}
