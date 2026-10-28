// SPDX-License-Identifier: AGPL-3.0-only
import { runCitationCommand } from './citations.mjs';
// Parse with Systematic Reviewer's actual Markdown parser in the References worker.
// Only a bounded native changed region enters the parser; no formulas or code styles.
export async function promoteCitationCodes({ invoke, parse, renderDocument, documentType, projectId, target, signal }) {
  const region = await invoke({ operation: 'codes.region', target }, { signal });
  if (region.formula || region.codeStyle || !region.text?.includes('sr-cite:')) return { promoted: 0, skipped: region.unavailable || null };
  if (region.text.length > 65536) throw new Error('Process citation codes in a smaller native text region');
  const result = await parse(region.text, { signal });
  const citations = result.citations || [];
  if (citations.length > 32) throw new Error('Process at most 32 citation codes in one changed region');
  if (documentType !== 'text' && (citations.length !== 1 || region.text.slice(0, citations[0].start).trim() || region.text.slice(citations[0].end).trim())) return { promoted: 0, skipped: 'A sheet or slide citation code must occupy a whole cell or text shape' };
  let promoted = 0;
  for (const citation of [...citations].reverse()) {
    signal?.throwIfAborted();
    if (citation.unresolved || citation.cluster.items.some(item => !item.id.startsWith('bkref:'))) throw new Error('This legacy citation identity needs an explicit References import mapping');
    const latest = await invoke({ operation: 'codes.region', target: region.target }, { signal });
    if (latest.text.slice(citation.start, citation.end) !== region.text.slice(citation.start, citation.end)) throw new Error('The citation code changed while it was being resolved');
    const insertion = { ...region.target, expectedText: latest.text };
    if (documentType === 'text') Object.assign(insertion, { offset: citation.start, length: citation.end - citation.start });
    await runCitationCommand({ invoke, renderDocument, documentType, projectId, request: { operation: 'citations.insert', cluster: { items: citation.cluster.items }, target: insertion }, signal });
    promoted++;
  }
  return { promoted };
}
