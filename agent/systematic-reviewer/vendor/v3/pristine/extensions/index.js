import { Type } from 'typebox';
import { withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { resolve } from 'node:path';
import { citationMarker } from '../lib/markdown.mjs';
import { renderDocument } from '../lib/citations.mjs';
import { ZoteroClient } from '../lib/zotero.mjs';
import { readText, writeOutput } from '../lib/io.mjs';

const namespace = { name: 'systematic_review', description: 'Zotero citation interchange for flexible research artifacts. Review methodology is in the systematic-review skill.' };
const citationItem = Type.Object({
  id: Type.String({ description: 'Verified scoped identity: users/123/items/ABCD2345, groups/456/items/ABCD2345, or users/local/<realKey>/items/ABCD2345' }),
  locator: Type.Optional(Type.String()), label: Type.Optional(Type.String({ description: 'CSL locator label, e.g. page, section, table. Defaults to page.' })),
  prefix: Type.Optional(Type.String()), suffix: Type.Optional(Type.String()),
  'suppress-author': Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const fileParameters = {
  input: Type.String({ description: 'Input Markdown path' }),
  references: Type.String({ description: 'Reference snapshot JSON path (version 1)' }),
  output: Type.String({ description: 'Output path; existing files are refused unless overwrite is true' }),
  overwrite: Type.Optional(Type.Boolean()),
  style: Type.Optional(Type.String({ description: 'Independent in-text CSL style file. Default is the bundled minimal author-date style, NOT APA.' })),
  locale: Type.Optional(Type.String({ description: 'CSL locale, default en-US' })),
  localeFile: Type.Optional(Type.String({ description: 'CSL locale XML file required for non-bundled locale' })),
};
const outputSchema = Type.Object({
  path: Type.String(), citations: Type.Number(), bibliographyEntries: Type.Number(),
  style: Type.String(),
});
const local = (ctx, path) => resolve(ctx.cwd, path);
const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], details: data, structuredContent: data });

async function renderedInput(params, ctx, signal) {
  const input = local(ctx, params.input);
  const references = local(ctx, params.references);
  const output = local(ctx, params.output);
  if ([references, params.style && local(ctx, params.style), params.localeFile && local(ctx, params.localeFile)].includes(output)) throw new Error('Output must not replace a reference, style or locale input');
  const [markdown, snapshotText] = await Promise.all([readText(input, { signal }), readText(references, { signal })]);
  const options = { locale: params.locale ?? 'en-US' };
  if (params.style) options.styleXml = await readText(local(ctx, params.style), { signal, maxBytes: 2 * 1024 * 1024 });
  if (params.localeFile) options.locales = { [options.locale]: await readText(local(ctx, params.localeFile), { signal, maxBytes: 2 * 1024 * 1024 }) };
  signal?.throwIfAborted();
  return renderDocument(markdown, JSON.parse(snapshotText), options);
}

/** Native Pi package entry point. No model loop, background process or global settings. */
export default function systematicReviewer(pi) {
  pi.registerTool({
    name: 'review_citation', label: 'Build citation marker', namespace,
    description: 'Build a durable Markdown citation marker from verified Zotero identities and optional locators. Insert the marker with ordinary edit/write, then render the WHOLE document with review_render_citations. Never invent an item ID.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object({ items: Type.Array(citationItem, { minItems: 1, maxItems: 100 }) }),
    outputSchema: Type.Object({ marker: Type.String() }),
    async execute(_id, params) { return result({ marker: citationMarker(params.items) }); },
  });

  pi.registerTool({
    name: 'review_render_citations', label: 'Render Markdown citations', namespace,
    description: 'Render all sr-cite Markdown links and the optional bibliography block using offline CSL reference metadata. Preserves live identities, updates citation labels in document order, and fails on missing items. Writes only the requested output; returns a short summary, not the manuscript. No Zotero/office process needed.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object(fileParameters), outputSchema,
    async execute(_id, params, signal, _update, ctx) {
      const output = local(ctx, params.output);
      return withFileMutationQueue(output, async () => {
        const rendered = await renderedInput(params, ctx, signal);
        await writeOutput(output, rendered.markdown, { overwrite: params.overwrite, signal });
        return result({ path: output, citations: rendered.citations.length, bibliographyEntries: rendered.bibliography?.entries.length ?? 0, style: rendered.style.id });
      });
    },
  });

  pi.registerTool({
    name: 'review_export_docx', label: 'Export live Zotero DOCX', namespace,
    description: 'Render a Markdown manuscript and export DOCX with live Zotero citation metadata. Bookmark mode (default) is for Word/LibreOffice interoperability; fields mode is Word-specific. Requires no office binary. Zotero Refresh requires its standard office integration and the selected CSL style installed in Zotero. Unsupported Markdown fails rather than silently losing content.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    parameters: Type.Object({ ...fileParameters, mode: Type.Optional(Type.Union([Type.Literal('bookmarks'), Type.Literal('fields')])), title: Type.Optional(Type.String()) }),
    outputSchema,
    async execute(_id, params, signal, _update, ctx) {
      const output = local(ctx, params.output);
      if (output === local(ctx, params.input)) throw new Error('DOCX output must not replace the Markdown input');
      return withFileMutationQueue(output, async () => {
        const rendered = await renderedInput(params, ctx, signal);
        const { exportDocx } = await import('../lib/docx.mjs');
        const bytes = await exportDocx(rendered, { mode: params.mode ?? 'bookmarks', title: params.title });
        await writeOutput(output, bytes, { overwrite: params.overwrite, signal });
        return result({ path: output, citations: rendered.citations.length, bibliographyEntries: rendered.bibliography?.entries.length ?? 0, style: rendered.style.id });
      });
    },
  });

  pi.registerTool({
    name: 'review_zotero', label: 'Read Zotero references', namespace,
    description: 'Search Zotero or fetch verified item identities into a portable CSL snapshot; no custom Zotero plugin or SQLite access. Uses existing local API by default, or Web API with optional ZOTERO_API_KEY from environment. Explicit output file required. Search returns one bounded page; use nextStart to continue. Does NOT modify Zotero.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    parameters: Type.Object({
      operation: Type.Union([Type.Literal('search'), Type.Literal('snapshot')]),
      mode: Type.Optional(Type.Union([Type.Literal('local'), Type.Literal('web')])),
      ids: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 100 })),
      library: Type.Optional(Type.String({ description: 'users/<actualID> or groups/<actualID>; users/0 is permitted only for local search' })),
      query: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      start: Type.Optional(Type.Integer({ minimum: 0 })),
      output: Type.String(), overwrite: Type.Optional(Type.Boolean()),
    }),
    outputSchema: Type.Object({ path: Type.String(), count: Type.Number(), preview: Type.Array(Type.Object({ id: Type.String(), title: Type.String() })), page: Type.Union([Type.Object({ library: Type.String(), query: Type.String(), start: Type.Number(), limit: Type.Number(), total: Type.Union([Type.Number(), Type.Null()]), nextStart: Type.Union([Type.Number(), Type.Null()]) }), Type.Null()]) }),
    async execute(_id, params, signal, _update, ctx) {
      const output = local(ctx, params.output);
      return withFileMutationQueue(output, async () => {
        const client = new ZoteroClient({ mode: params.mode ?? 'local', apiKey: process.env.ZOTERO_API_KEY, localUrl: process.env.ZOTERO_LOCAL_URL });
        const data = params.operation === 'snapshot' ? await client.snapshot(params.ids, { signal }) : await client.search({ library: params.library, query: params.query, limit: params.limit, start: params.start, signal });
        await writeOutput(output, `${JSON.stringify(data, null, 2)}\n`, { overwrite: params.overwrite, signal });
        return result({ path: output, count: data.items.length, preview: data.items.slice(0, 20).map(item => ({ id: item.id, title: String(item.itemData.title ?? '').slice(0, 250) })), page: data.page ?? null });
      });
    },
  });
}
