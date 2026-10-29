// SPDX-License-Identifier: AGPL-3.0-or-later
// The project SQLite adapter shares V3's strict identifier validation. Identity
// is work-scoped: journal/ISSN IDs and title similarity never merge references.
import { normalizeIdentifier } from './identifiers.mjs';

export const workIdentifierFields = Object.freeze(['DOI', 'PMID', 'PMCID', 'OpenAlex', 'arXiv']);
const names = new Map([...workIdentifierFields, 'ISBN'].map(kind => [kind.toLowerCase(), kind]));
names.set('openalexworkid', 'OpenAlex');
export const workIdentifierKind = name => names.get(String(name).replace(/[ _-]/g, '').toLowerCase());
const conflict = kind => Object.assign(new Error(`Conflicting ${kind} work identifiers; reconcile the identity before importing or merging`), { status: 409 });

export function canonicalWorkIdentifier(kind, value) {
  kind = workIdentifierKind(kind);
  if (!kind) return null;
  const input = String(value).trim();
  const normalized = normalizeIdentifier(/^https?:\/\//i.test(input) || new RegExp(`^(?:${kind}|OpenAlexWorkID)\\s*:`, 'i').test(input)
    ? input : `${kind}:${input}`);
  if (normalized.type !== kind) throw Object.assign(new Error(`Expected a ${kind} identifier`), { status: 400 });
  // A manuscript revision still identifies the same work. Keep its complete
  // supplied identifier in source provenance; index the stable work identity.
  return { type: kind, value: kind === 'PMCID' ? normalized.value.replace(/\.\d+$/, '')
    : kind === 'arXiv' ? normalized.value.replace(/v\d+$/, '') : normalized.value };
}

/** Extract independently supplied identities, refusing contradictory evidence.
 * strict:false is only for indexing legacy metadata without altering it. */
export function workIdentifiers(data = {}, { strict = true } = {}) {
  const found = {};
  const add = (name, value) => {
    const kind = workIdentifierKind(name);
    if (!kind || value == null || value === '' || (kind === 'ISBN' && data.itemType !== 'book')) return;
    try {
      const result = canonicalWorkIdentifier(kind, value);
      if (found[kind] && found[kind] !== result.value) throw conflict(kind);
      found[kind] = result.value;
    } catch (error) {
      if (strict || error.status === 409) throw error;
    }
  };
  for (const [kind, value] of Object.entries(data.provenance?.identifiers || {})) add(kind, value);
  add('OpenAlex', data.provenance?.openalex?.id);
  for (const field of [...workIdentifierFields, 'OpenAlexWorkID', 'ISBN']) add(field, data[field]);
  for (const line of String(data.extra || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(DOI|PMID|PMCID|OpenAlex(?:[ _-]?Work[ _-]?ID)?|arXiv)\s*:\s*(.*?)\s*$/i);
    if (match) add(match[1], match[2]);
  }
  return found;
}

/** The existing identifier table permits several values of one kind. Primary
 * fields remain readable/editable; alternate exact evidence is never guessed. */
export function workIdentifierEntries(data, options) {
  const entries = new Map(Object.entries(workIdentifiers(data, options)).map(([kind, value]) => [kind + ':' + value, [kind, value]]));
  for (const [kind, values] of Object.entries(data.provenance?.identifierAliases || {})) {
    if (!Array.isArray(values)) throw Object.assign(new Error('Identifier aliases must be arrays'), { status: 400 });
    for (const value of values) {
      const id = canonicalWorkIdentifier(kind, value);
      if (id && (id.type !== 'ISBN' || data.itemType === 'book')) entries.set(id.type + ':' + id.value, [id.type, id.value]);
      if (entries.size > 200) throw Object.assign(new Error('A reference has more than 200 work identifiers; review its identity evidence'), { status: 422 });
    }
  }
  return [...entries.values()];
}
export function sharesWorkIdentifier(first, second) {
  const known = new Set(workIdentifierEntries(first).map(([kind, value]) => kind + ':' + value));
  return workIdentifierEntries(second).some(([kind, value]) => known.has(kind + ':' + value));
}

/** Materialize identifiers as editable fields, while retaining their sources.
 * Explicit field changes replace stale index evidence, never historical raw
 * resolver records. Unchanged source disagreements remain a truthful conflict. */
export function normalizeWorkMetadata(input, { previous, editedFields = [] } = {}) {
  const data = { ...input, provenance: { ...input.provenance } };
  const changed = new Set(editedFields.map(workIdentifierKind).filter(Boolean));
  if (previous) {
    for (const field of [...workIdentifierFields, 'OpenAlexWorkID'])
      if (Object.hasOwn(input, field) && input[field] !== previous[field]) changed.add(workIdentifierKind(field));
  }
  if (changed.size) {
    data.provenance.identifiers = { ...data.provenance.identifiers };
    data.provenance.identifierAliases = { ...data.provenance.identifierAliases };
    for (const name of Object.keys(data.provenance.identifiers))
      if (changed.has(workIdentifierKind(name))) delete data.provenance.identifiers[name];
    for (const name of Object.keys(data.provenance.identifierAliases))
      if (changed.has(workIdentifierKind(name))) delete data.provenance.identifierAliases[name];
    if (changed.has('OpenAlex') && data.provenance.openalex)
      data.provenance.openalex = { ...data.provenance.openalex, id: undefined };
    data.extra = String(data.extra || '').split(/\r?\n/).filter(line => {
      const match = line.match(/^\s*([^:]+)\s*:/);
      return !match || !changed.has(workIdentifierKind(match[1]));
    }).join('\n');
    if (changed.has('OpenAlex')) {
      if (Object.hasOwn(input, 'OpenAlexWorkID') && input.OpenAlexWorkID !== previous?.OpenAlexWorkID)
        data.OpenAlex = input.OpenAlexWorkID;
      delete data.OpenAlexWorkID;
    }
  }
  const identifiers = workIdentifiers(data);
  Object.assign(data, identifiers);
  delete data.OpenAlexWorkID;
  if (Object.keys(identifiers).length || data.provenance.identifiers)
    data.provenance.identifiers = { ...data.provenance.identifiers, ...identifiers };
  if (data.provenance.identifierAliases) {
    const aliases = {};
    for (const [kind, value] of workIdentifierEntries(data)) {
      if (identifiers[kind] === value) continue;
      (aliases[kind] ||= []).push(value);
    }
    data.provenance.identifierAliases = aliases;
  }
  if (!Object.keys(data.provenance).length) delete data.provenance;
  return data;
}

export function assertCompatibleWorkIdentifiers(...records) {
  const known = {};
  for (const data of records) for (const [kind, value] of Object.entries(workIdentifiers(data))) {
    if (known[kind] && known[kind] !== value) throw conflict(kind);
    known[kind] = value;
  }
  return known;
}
