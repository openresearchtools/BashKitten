// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { ZoteroClient } from './zotero.mjs';
import { MetadataError as ZoteroImportError, requestText as request } from './metadata-http.mjs';
import { normalizeIdentifier, resolveIdentifiers } from './identifiers.mjs';
export { ZoteroImportError };

const MAX_BYTES = 4 * 1024 * 1024;
const RIS = 'application/x-research-info-systems';
const fail = message => new ZoteroImportError(message);


function connectorUrl(localUrl, path) {
  // Share the read client's loopback-only validation. No credentials are needed.
  try { return new URL(`../connector/${path}`, new ZoteroClient({ localUrl }).base); }
  catch { throw fail('Local URL must be loopback HTTP with path /api/.'); }
}

function json(text) {
  try { return JSON.parse(text); }
  catch { throw fail('Zotero returned invalid JSON.'); }
}

/** Read the selected destination without asking Zotero to change the selection. */
export async function connectorTarget({ localUrl, signal, timeoutMs } = {}, dependencies = {}) {
  const raw = json(await request(connectorUrl(localUrl, 'getSelectedCollection'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zotero-Connector-API-Version': '3' }, body: '{}',
  }, { ...dependencies, signal, timeoutMs }));
  if (!Number.isSafeInteger(raw.libraryID) || raw.libraryID < 1 ||
      (raw.id !== null && (!Number.isSafeInteger(raw.id) || raw.id < 1))) throw fail('Zotero returned an invalid selected destination.');
  return {
    target: raw.id === null ? `L${raw.libraryID}` : `C${raw.id}`,
    libraryName: raw.libraryName, collectionName: raw.id === null ? null : raw.name,
    editable: raw.libraryEditable === true && raw.editable !== false,
  };
}

function normalizeDoi(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^10\.\d{4,9}\/\S+$/u.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw fail('Supply bare DOIs such as 10.1234/example (at most 2048 characters each).');
  }
  return value.toLowerCase();
}

/** Explicit metadata-only import. Connector chooses the UI-selected destination;
 * expectedTarget is a preflight guard, not an atomic destination lock. */
export async function importDois({ dois, expectedTarget, localUrl, signal, timeoutMs } = {}, dependencies = {}) {
  if (!Array.isArray(dois) || dois.length < 1 || dois.length > 20) throw fail('Import 1–20 DOIs at a time.');
  if (!/^[LC][1-9]\d*$/.test(expectedTarget ?? '')) throw fail('Specify the selected target from the target command, such as L1 or C23.');
  dois = [...new Set(dois.map(normalizeDoi))];
  const options = { localUrl, signal, timeoutMs };
  const target = await connectorTarget(options, dependencies);
  if (!target.editable || target.target !== expectedTarget) throw fail('Selected Zotero destination is read-only or does not match --expect-target; nothing imported.');
  const records = [];
  for (const doi of dois) {
    const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/${RIS}`);
    const text = await request(url, { headers: { Accept: RIS } }, { ...dependencies, signal, timeoutMs });
    const fields = text.replace(/\r\n?/g, '\n');
    // Match Zotero's RIS grammar, which accepts both one and two spaces.
    const tags = fields.split('\n').map(line => line.match(/^([A-Z][A-Z0-9]) {1,2}-(?: (.*))?$/)).filter(Boolean);
    const identifiers = tags.filter(tag => tag[1] === 'DO');
    if (identifiers.length !== 1 || normalizeDoi(identifiers[0][2]?.trim()) !== doi ||
        tags.filter(tag => tag[1] === 'TY').length !== 1 || tags.filter(tag => tag[1] === 'ER').length !== 1 ||
        tags[0]?.[1] !== 'TY' || tags.at(-1)?.[1] !== 'ER' || tags.some(tag => /^L[1-4]$/.test(tag[1]))) {
      throw fail('Crossref returned an invalid or mismatched RIS record, or attachment fields; nothing imported.');
    }
    records.push({ doi, source: url.href, ris: fields });
  }
  const current = await connectorTarget(options, dependencies);
  if (!current.editable || current.target !== expectedTarget) throw fail('Selected Zotero destination changed during retrieval; nothing imported.');
  const body = records.map(record => record.ris.trimEnd()).join('\n\n') + '\n';
  if (Buffer.byteLength(body) > MAX_BYTES) throw fail('Combined import exceeds 4 MiB; use fewer DOIs.');
  const session = randomUUID();
  const url = connectorUrl(localUrl, 'import');
  url.searchParams.set('session', session);
  // Never retry a write: a timeout or malformed reply may follow a successful save.
  try {
    const saved = json(await request(url, {
      method: 'POST', headers: { 'Content-Type': RIS, 'X-Zotero-Connector-API-Version': '3' }, body,
    }, { ...dependencies, signal, timeoutMs }));
    if (!Array.isArray(saved) || saved.length !== records.length) throw fail('Unexpected item count in import response.');
    const keys = new Set();
    const items = records.map(record => {
      const matches = saved.filter(item => typeof item.DOI === 'string' && item.DOI.toLowerCase() === record.doi);
      if (matches.length !== 1 || !/^[A-Z0-9]{8}$/.test(matches[0].key) || keys.has(matches[0].key)) throw fail('Cannot verify saved DOI/item keys from import response.');
      keys.add(matches[0].key);
      return { doi: record.doi, itemKey: matches[0].key, source: record.source };
    });
    return { version: 1, operation: 'import-doi', provider: 'Crossref', target, session, importedAt: new Date().toISOString(), items,
      note: 'Item keys are local receipts, not citation identities. Search Zotero to obtain verified library-qualified IDs. Imports can create duplicates; do not change the Zotero selection during an import.' };
  } catch (error) {
    throw fail(`${error instanceof ZoteroImportError ? error.message : 'Import verification failed.'} Zotero may have saved items; inspect the library before retrying.`);
  }
}

/** One identifier per write keeps mixed metadata formats and partial batches explicit.
 * DOI retains the existing batch helper; ISBN and versioned arXiv remain native
 * Zotero search payloads until a suitable HTTP import route is implemented. */
export async function importIdentifier({ identifier, expectedTarget, localUrl, signal, timeoutMs, mailto } = {}, dependencies = {}) {
  const input = normalizeIdentifier(identifier);
  if (input.type === 'ISBN') throw fail('ISBN is normalized by resolve, but this helper does not import ISBN metadata. Use Zotero Add Item by Identifier with the normalized ISBN. Nothing imported.');
  if (input.type === 'arXiv' && /v\d+$/.test(input.value)) throw fail('arXiv BibTeX export does not preserve requested versions. Use the native arXiv payload from resolve with Zotero, or deliberately choose an unversioned identifier. Nothing imported.');
  if (input.type === 'DOI') return importDois({ dois: [input.value], expectedTarget, localUrl, signal, timeoutMs }, dependencies);
  const resolution = (await resolveIdentifiers({ identifiers: [identifier], signal, timeoutMs, mailto }, dependencies)).items[0];
  if (!resolution.zoteroIdentifier) throw fail('PMC could not resolve this PMCID to a PMID. Inspect resolve output; nothing imported.');
  if (!/^[LC][1-9]\d*$/.test(expectedTarget ?? '')) throw fail('Specify the selected target from the target command, such as L1 or C23.');
  const options = { localUrl, signal, timeoutMs };
  const target = await connectorTarget(options, dependencies);
  if (!target.editable || target.target !== expectedTarget) throw fail('Selected Zotero destination is read-only or does not match --expect-target; nothing imported.');
  const pmid = resolution.zoteroIdentifier.PMID;
  let url;
  let contentType;
  let body;
  let matches;
  if (pmid) {
    url = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi');
    url.search = new URLSearchParams({ db: 'pubmed', id: pmid, retmode: 'xml', tool: 'SystematicReviewerV3' });
    contentType = 'application/xml';
    body = await request(url, { headers: { Accept: contentType } }, { ...dependencies, signal, timeoutMs });
    // PubMed's optional external DTD is unnecessary for import. Never allow
    // entities or a custom internal subset to cause hidden reads in Zotero.
    if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(body)) throw fail('PubMed XML contains unsupported entity declarations; nothing imported.');
    body = body.replace(/<!DOCTYPE[^>]*>/gi, '');
    const primary = body.match(/<MedlineCitation\b[^>]*>\s*<PMID\b[^>]*>(\d+)<\/PMID>/);
    // Count every XML opening-tag spelling XPath could import, including spaces,
    // attributes and self-closing tags. Official EFetch uses the plain spelling.
    if (!body.includes('<PubmedArticleSet>') || [...body.matchAll(/<PubmedArticle(?=[\s/>])/g)].length !== 1 || /<PubmedBookArticle\b/.test(body) ||
        primary?.[1] !== pmid || !/<ArticleTitle>[^]*?\S[^]*?<\/ArticleTitle>/.test(body)) {
      throw fail('Expected one matching PubMed article. Book records are not imported because Zotero may fetch attachments; use native Add Item by Identifier. Nothing imported.');
    }
    matches = item => String(item.PMID ?? '') === pmid || new RegExp(`(?:^|\\n)PMID:\\s*${pmid}(?:\\n|$)`).test(item.extra ?? '');
  } else {
    const arxiv = resolution.zoteroIdentifier.arXiv;
    url = new URL(`https://arxiv.org/bibtex/${arxiv.split('/').map(encodeURIComponent).join('/')}`);
    contentType = 'application/x-bibtex';
    body = await request(url, { headers: { Accept: contentType } }, { ...dependencies, signal, timeoutMs });
    const eprints = [...body.matchAll(/\beprint\s*=\s*[{\"]([^}\"]+)[}\"]/gi)];
    // Zotero drops ASCII whitespace inside field names (e.g. "p df" is "pdf").
    // This conservative scan also rejects suspicious strings inside values.
    if ([...body.matchAll(/@\w+\s*[{(]/g)].length !== 1 || eprints.length !== 1 || eprints[0][1] !== arxiv ||
        !/\btitle\s*=\s*[{\"][^}\"]+/.test(body) || /(?:file|pdf|path|sentelink)=/i.test(body.replace(/[ \t\r\n]/g, ''))) throw fail('arXiv returned mismatched or unsafe BibTeX metadata; nothing imported.');
    // Zotero's BibTeX importer recognizes eprinttype, not archivePrefix.
    body = body.replace(/\barchivePrefix\s*=/i, 'eprinttype=');
    matches = item => item.arXiv === arxiv || item.archiveID === arxiv || item.url === `https://arxiv.org/abs/${arxiv}` || (item.extra ?? '').split('\n').some(line => line.trim() === `arXiv: ${arxiv}`);
  }
  const current = await connectorTarget(options, dependencies);
  if (!current.editable || current.target !== expectedTarget) throw fail('Selected Zotero destination changed during retrieval; nothing imported.');
  const endpoint = connectorUrl(localUrl, 'import');
  const session = randomUUID();
  endpoint.searchParams.set('session', session);
  try {
    const saved = json(await request(endpoint, { method: 'POST', headers: { 'Content-Type': contentType, 'X-Zotero-Connector-API-Version': '3' }, body }, { ...dependencies, signal, timeoutMs }));
    if (!Array.isArray(saved) || saved.length !== 1 || !/^[A-Z0-9]{8}$/.test(saved[0].key) || !matches(saved[0])) throw fail('Cannot verify saved identifier/item key from import response.');
    return { version: 1, operation: 'import', target, session, importedAt: new Date().toISOString(),
      items: [{ ...resolution, itemKey: saved[0].key, source: url.href }],
      note: 'Item keys are local receipts, not citation identities. Search Zotero for verified library-qualified IDs. Imports can create duplicates.' };
  } catch (error) {
    throw fail(`${error instanceof ZoteroImportError ? error.message : 'Import verification failed.'} Zotero may have saved items; inspect the library before retrying.`);
  }
}
