// SPDX-License-Identifier: AGPL-3.0-or-later
import { MetadataError, requestText } from './metadata-http.mjs';
const fail = message => new MetadataError(message);

/** Normalize an identifier, not a title or an arbitrary fragment of prose. */
export function normalizeIdentifier(input) {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u001f\u007f]/u.test(input)) throw fail('Identifier must be a single line of at most 2048 characters.');
  let value = input.trim();
  let type;
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw fail('Invalid identifier URL.'); }
    if (url.username || url.password || url.search || url.hash || url.port) throw fail('Use an identifier URL without credentials, query, fragment, or custom port.');
    const host = url.hostname.toLowerCase();
    try { value = decodeURIComponent(url.pathname); } catch { throw fail('Invalid encoded identifier URL.'); }
    if (['doi.org', 'dx.doi.org'].includes(host)) { type = 'DOI'; value = value.slice(1); }
    else if (host === 'pubmed.ncbi.nlm.nih.gov') { type = 'PMID'; value = value.replace(/^\//, '').replace(/\/$/, ''); }
    else if (host === 'pmc.ncbi.nlm.nih.gov' && /^\/articles\//i.test(value)) { type = 'PMCID'; value = value.replace(/^\/articles\//i, '').replace(/\/$/, ''); }
    else if (host === 'www.ncbi.nlm.nih.gov' && /^\/pmc\/articles\//i.test(value)) { type = 'PMCID'; value = value.replace(/^\/pmc\/articles\//i, '').replace(/\/$/, ''); }
    else if (['arxiv.org', 'www.arxiv.org'].includes(host) && /^\/(abs|pdf)\//i.test(value)) { type = 'arXiv'; value = value.replace(/^\/(abs|pdf)\//i, '').replace(/\.pdf$/i, ''); }
    else throw fail('Unsupported identifier URL; use a DOI, PMID, PMCID, arXiv ID, or ISBN.');
  } else {
    const prefix = value.match(/^(doi|pmid|pmcid|arxiv|isbn(?:-1[03])?)(?:\s*:\s*|\s+)/i);
    if (prefix) {
      type = { doi: 'DOI', pmid: 'PMID', pmcid: 'PMCID', arxiv: 'arXiv', isbn: 'ISBN' }[prefix[1].toLowerCase().replace(/-1[03]$/, '')];
      value = value.slice(prefix[0].length);
    }
  }
  type ??= /^10\.\d{4,9}\//i.test(value) ? 'DOI' : /^PMC/i.test(value) ? 'PMCID' :
    /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(value) ? 'arXiv' :
      /^[1-9]\d{0,8}$/.test(value) ? 'PMID' : 'ISBN';
  if (type === 'DOI') {
    if (!/^10\.\d{4,9}\/\S+$/u.test(value) || /[\u0000-\u001f\u007f]/u.test(value) || !value.isWellFormed()) throw fail('Invalid DOI.');
    value = value.toLowerCase();
  } else if (type === 'PMID') {
    if (!/^[1-9]\d{0,8}$/.test(value)) throw fail('Invalid PMID; use a positive PubMed numeric ID.');
  } else if (type === 'PMCID') {
    value = value.replace(/^PMC/i, '');
    if (!/^[1-9]\d*(?:\.[1-9]\d*)?$/.test(value)) throw fail('Invalid PMCID.');
    value = `PMC${value}`;
  } else if (type === 'arXiv') {
    if (!/^(?:\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v[1-9]\d*)?$/i.test(value)) throw fail('Invalid arXiv ID.');
    value = value.replace(/V(?=\d+$)/, 'v');
  } else {
    value = value.replace(/[-\s]/g, '').toUpperCase();
    const valid10 = /^\d{9}[\dX]$/.test(value) && [...value].reduce((n, c, i) => n + (c === 'X' ? 10 : Number(c)) * (10 - i), 0) % 11 === 0;
    const valid13 = /^97[89]\d{10}$/.test(value) && [...value].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0;
    if (!valid10 && !valid13) throw fail('Unrecognized identifier or invalid ISBN checksum; use an explicit DOI/PMID/PMCID/arXiv/ISBN prefix.');
  }
  return { type, value };
}

/** Convert the one legacy non-native identifier (PMCID) through PMC; preserve
 * native Zotero payloads for the other types without claiming metadata lookup. */
export async function resolveIdentifiers({ identifiers, signal, timeoutMs, mailto } = {}, dependencies = {}) {
  if (!Array.isArray(identifiers) || identifiers.length < 1 || identifiers.length > 20) throw fail('Resolve 1–20 identifiers at a time.');
  if (mailto !== undefined && (typeof mailto !== 'string' || mailto.length > 254 || !/^[^@\s<>]+@[^@\s<>]+$/.test(mailto))) throw fail('Mailto must be a single email address.');
  signal?.throwIfAborted();
  const inputs = identifiers.map(normalizeIdentifier);
  const pmcids = [...new Set(inputs.filter(item => item.type === 'PMCID').map(item => item.value.replace(/\.\d+$/, '')))];
  const mappings = new Map();
  let source;
  let retrievedAt;
  if (pmcids.length) {
    const url = new URL('https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/');
    url.search = new URLSearchParams({ ids: pmcids.join(','), idtype: 'pmcid', format: 'json', versions: 'yes', tool: 'BashKittenReferences' });
    source = url.href;
    if (mailto) url.searchParams.set('email', mailto);
    let data;
    try { data = JSON.parse(await requestText(url, { headers: { Accept: 'application/json' } }, { ...dependencies, signal, timeoutMs })); }
    catch (error) { if (error instanceof MetadataError) throw error; throw fail('PMC converter returned invalid JSON.'); }
    if (data?.status !== 'ok' || !Array.isArray(data.records) || data.records.length > pmcids.length) throw fail('PMC converter returned an invalid result.');
    for (const record of data.records) {
      const requested = normalizeIdentifier(`pmcid:${record['requested-id'] ?? record.requested_id ?? record.pmcid ?? ''}`).value;
      if (!pmcids.includes(requested) || mappings.has(requested)) throw fail('PMC converter returned unexpected or duplicate identifiers.');
      mappings.set(requested, record);
    }
    retrievedAt = new Date().toISOString();
  }
  return { version: 1, items: inputs.map(input => {
    if (input.type !== 'PMCID') return { input, status: 'native', zoteroIdentifier: { [input.type]: input.value } };
    const record = mappings.get(input.value.replace(/\.\d+$/, ''));
    const versioned = /\.\d+$/.test(input.value);
    const version = versioned ? record?.versions?.find(item => item.pmcid === input.value) : null;
    const pmid = record?.pmid && (!versioned || version) ? normalizeIdentifier(`pmid:${record.pmid}`).value : null;
    const doi = (version?.doi ?? record?.doi) ? normalizeIdentifier(`doi:${version?.doi ?? record.doi}`).value : null;
    return { input, status: pmid ? 'resolved' : 'unresolved', zoteroIdentifier: pmid ? { PMID: pmid } : null,
      identifiers: { PMCID: input.value, PMID: pmid, DOI: doi }, provenance: { source, retrievedAt },
      note: pmid ? 'PMC maps this article to a PubMed record; a PMID does not select a specific PMC manuscript version.' : 'PMC returned no PMID or did not verify the requested version; no native Zotero search identifier was invented.' };
  }) };
}
