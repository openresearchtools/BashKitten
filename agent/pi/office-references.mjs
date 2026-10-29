// SPDX-License-Identifier: AGPL-3.0-only
import { Type } from 'typebox';
import { applicationRequest, applicationFailure } from './apps-channel.mjs';
import { browserCall } from './client.mjs';
import { resolve } from 'node:path';
import { importReferenceFile } from './references-files.mjs';

const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: value });
const segment = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]+$/.test(value) || ['.', '..'].includes(value)) throw Error('Use a returned stable identifier');
  return encodeURIComponent(value);
};
export default function officeReferences(pi) {
  pi.registerTool({
    name: 'references', label: 'References', exposure: 'deferred',
    description: 'Manage independent named References project databases on the current backend through the shared References API. Default is created on first use; list/create/select References projects independently of BashKitten workspaces. Read the references skill. GET schema and item data to read/edit every applicable native metadata field, complete creators, abstract, DOI, PMID, PMCID, OpenAlex work ID and arXiv. PATCH item data with the returned version; preserve other metadata. Add/manage local PDF, DOCX, XML or other attachments with file. Supports tags/notes/relations, full text, shared identifier/OpenAlex import and exact-identifier merging, metadata enrichment, PDF resolution, citations and styles. Explicit project IDs, bounded pages, versions and import/job identities are required. Long work returns cancellable jobs; never start another server or resolver.',
    parameters: Type.Object({
      method: Type.Union(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(value => Type.Literal(value))),
      path: Type.String({ description: 'Component-relative References API path, including explicit /projects/<id>/ scope and query parameters' }),
      body: Type.Optional(Type.Any({ description: 'Operation body without metadata-field restrictions. Item POST {data:{itemType,...nativeFields}}, PATCH /items/KEY {version,data:{...changedFields}}, PUT replaces data explicitly. Native identifiers are DOI, PMID, PMCID, OpenAlex (Wdigits), arXiv; creators retain name or firstName/lastName plus creatorType and identifiers. GET schema and item first. Use returned canonical key/version after an exact-identifier merge.' })),
      file: Type.Optional(Type.String({ description: 'Local PDF/DOCX/XML/other file to stream with its original extension. POST /projects/PROJECT/import accepts encoding and requestId; connector/saveAttachment accepts parentKey,title,contentType,requestId; connector/saveStandaloneAttachment accepts title,contentType,requestId. No bytes enter model context.' })),
    }, { additionalProperties: false }),
    async execute(_id, { method, path, body, file }, signal, onUpdate, ctx) {
      try {
        if (file) {
          if (method !== 'POST') throw Error('Reference-file import requires POST');
          return result(await importReferenceFile(resolve(ctx.cwd, file), path, body, {
            signal, onProgress: value => onUpdate?.(result({ status: 'uploading', ...value })),
          }));
        }
        return result(await applicationRequest('references', method, path, body, { signal }));
      }
      catch (error) { return applicationFailure(error); }
    },
  });
  pi.registerTool({
    name: 'office', label: 'Office', exposure: 'deferred',
    description: 'Open/create, inspect, edit, save and export live Collabora documents, sheets and presentations through your own authenticated native view. Read the office skill. Editing does not require an open editor tab. Use returned native identities and acknowledgements, preserve managed citations, and await save/export. Optional show opens the returned normal browser URL for rendering/visual inspection. Human and agent use separate views of the same document.',
    parameters: Type.Object({
      action: Type.Union(['open', 'execute', 'history', 'close'].map(value => Type.Literal(value))),
      projectId: Type.Optional(Type.String()), documentId: Type.Optional(Type.String()),
      relativePath: Type.Optional(Type.String({ description: 'Existing file relative to the explicit owning project; native owner verifies scope and access' })),
      sessionId: Type.Optional(Type.String()),
      create: Type.Optional(Type.Object({ name: Type.String(), format: Type.String() })),
      command: Type.Optional(Type.Record(Type.String(), Type.Any())),
      show: Type.Optional(Type.Boolean({ description: 'Open the normal browser URL returned by open or history open/restore; visual inspection is optional' })),
    }, { additionalProperties: false }),
    async execute(_id, value, signal) {
      try {
        if (!['open', 'execute', 'history', 'close'].includes(value.action)) throw Error('Use office open, execute, history or close');
        let reply;
        if (value.action === 'open') {
          if (!value.projectId || [value.documentId, value.relativePath, value.create].filter(Boolean).length !== 1) throw Error('Open requires projectId and exactly one documentId, relativePath or create');
          reply = await applicationRequest('office', 'POST', '/sessions', { projectId: value.projectId,
            ...(value.documentId ? { documentId: value.documentId } : {}), ...(value.relativePath ? { relativePath: value.relativePath } : {}),
            ...(value.create ? { create: value.create } : {}) }, { signal });
        } else if (value.action === 'execute') {
          if (!value.command?.operation) throw Error('Execute requires an explicit native command.operation');
          reply = await applicationRequest('office', 'POST', `/sessions/${segment(value.sessionId)}/commands`, value.command, { signal });
        } else if (value.action === 'history') {
          if (!value.projectId || !value.documentId || !value.command?.operation) throw Error('History requires projectId, documentId and command.operation');
          reply = await applicationRequest('office', 'POST', '/snapshots', { ...value.command, projectId: value.projectId, documentId: value.documentId }, { signal });
        } else reply = await applicationRequest('office', 'DELETE', `/sessions/${segment(value.sessionId)}`, undefined, { signal });
        if (value.show) {
          try {
            if (!reply.body?.browserUrl) throw Error('Office did not return a browser URL');
            const tab = await browserCall('tabs.create', { url: reply.body.browserUrl, application: true }, { signal });
            return result({ ...reply, tab });
          } catch (error) {
            // Opening the native participant already succeeded. An optional
            // visual tab failure must not hide its session or imply no edit view.
            return result({ ...reply, viewError: { message: error.message } });
          }
        }
        return result(reply);
      } catch (error) { return applicationFailure(error); }
    },
  });
}
