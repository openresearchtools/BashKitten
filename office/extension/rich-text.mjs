// SPDX-License-Identifier: AGPL-3.0-only
// CSL's small rich-text vocabulary becomes native text runs, never executable HTML.
export function citationRuns(html, { bibliography = false } = {}) {
  const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
    if (name[0] === '#') { const value = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10); return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''; }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' })[name.toLowerCase()];
  });
  const stack = [{ tag: '', style: {} }], runs = [];
  const append = value => {
    if (!value) return;
    const style = stack.at(-1).style, previous = runs.at(-1);
    if (previous && JSON.stringify({ ...previous, text: '' }) === JSON.stringify({ ...style, text: '' })) previous.text += value;
    else runs.push({ ...style, text: value });
  };
  // Match citeproc's native RTF display/block and display/indent semantics:
  // a soft line break within an entry; an indent additionally starts with a tab.
  const lineBreak = () => { if (runs.length && !runs.at(-1).text.endsWith('\n')) runs.push({ text: '\n', lineBreak: true }); };
  for (const token of String(html ?? '').match(/<[^>]*>|[^<]+/g) || []) {
    if (!token.startsWith('<')) {
      if (bibliography && /^\s+$/.test(token) && /[\r\n]/.test(token) && stack.at(-1).tag === 'div') continue;
      append(decode(bibliography ? token.replace(/[\t\r\n ]+/g, ' ') : token)); continue;
    }
    const match = /^<\s*(\/?)\s*([a-z][a-z0-9-]*)\b([^>]*)>/i.exec(token); if (!match) continue;
    const [, closing, rawTag, attributes] = match, tag = rawTag.toLowerCase();
    if (closing) { const index = stack.map(frame => frame.tag).lastIndexOf(tag), block = stack[index]?.block; if (index > 0) stack.splice(index); if (block) lineBreak(); continue; }
    if (tag === 'br') { lineBreak(); continue; }
    const block = tag === 'div' && /class\s*=\s*["'][^"']*\bcsl-(block|indent)\b/i.test(attributes);
    if (block) { lineBreak(); if (/\bcsl-indent\b/.test(attributes)) append('\t'); }
    if (tag === 'div' && /class\s*=\s*["'][^"']*\bcsl-right-inline\b/i.test(attributes)) {
      if (runs.length) runs.at(-1).text = runs.at(-1).text.replace(/ +$/, '');
      append('\t');
    }
    if (tag === 'div' && runs.length && /csl-entry/.test(attributes) && !runs.at(-1).text.endsWith('\n')) append('\n');
    const style = { ...stack.at(-1).style };
    if (tag === 'i' || tag === 'em' || /font-style\s*:\s*italic/i.test(attributes)) style.italic = true;
    if (/font-style\s*:\s*normal/i.test(attributes)) style.italic = false;
    if (tag === 'b' || tag === 'strong' || /font-weight\s*:\s*(bold|700)/i.test(attributes)) style.bold = true;
    if (/font-weight\s*:\s*(normal|400)/i.test(attributes)) style.bold = false;
    if (tag === 'sc' || /font-variant\s*:\s*small-caps/i.test(attributes)) style.smallCaps = true;
    if (/font-variant\s*:\s*normal/i.test(attributes)) style.smallCaps = false;
    if (tag === 'sup' || /vertical-align\s*:\s*sup/i.test(attributes)) style.superscript = true;
    if (tag === 'sub' || /vertical-align\s*:\s*sub/i.test(attributes)) style.subscript = true;
    if (/vertical-align\s*:\s*baseline|style\s*=\s*["']baseline["']/i.test(attributes)) { style.superscript = false; style.subscript = false; }
    if (tag === 'u' || /text-decoration\s*:\s*underline/i.test(attributes)) style.underline = true;
    if (/text-decoration\s*:\s*none/i.test(attributes)) style.underline = false;
    if (tag === 'a') { const href = /href\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]; if (href && /^(https?:|mailto:)/i.test(href)) style.url = decode(href); }
    if (!/\/\s*>$/.test(token)) stack.push({ tag, style, block });
  }
  return { text: runs.map(run => run.text).join(''), runs };
}

// Each CSL entry is one native paragraph. The formatter's left/right columns
// become a native tab, whose position comes from its bibliography format.
export function bibliographyRuns(entries) {
  const runs = [];
  for (const entry of entries) {
    if (runs.length) runs.push({ text: '\n' });
    const rendered = citationRuns(entry.trim(), { bibliography: true }).runs;
    if (rendered.length) { rendered[0].text = rendered[0].text.trimStart(); rendered.at(-1).text = rendered.at(-1).text.trimEnd(); }
    runs.push(...rendered);
  }
  return { text: runs.map(run => run.text).join(''), runs };
}
