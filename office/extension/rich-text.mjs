// SPDX-License-Identifier: AGPL-3.0-only
// CSL's small rich-text vocabulary becomes native text runs, never executable HTML.
export function citationRuns(html) {
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
  for (const token of String(html ?? '').match(/<[^>]*>|[^<]+/g) || []) {
    if (!token.startsWith('<')) { append(decode(token)); continue; }
    const match = /^<\s*(\/?)\s*([a-z][a-z0-9-]*)\b([^>]*)>/i.exec(token); if (!match) continue;
    const [, closing, rawTag, attributes] = match, tag = rawTag.toLowerCase();
    if (closing) { const index = stack.map(frame => frame.tag).lastIndexOf(tag); if (index > 0) stack.splice(index); if (tag === 'div' && /csl-entry/.test(attributes)) append('\n'); continue; }
    if (tag === 'br') { append('\n'); continue; }
    if (tag === 'div' && runs.length && /csl-entry/.test(attributes) && !runs.at(-1).text.endsWith('\n')) append('\n');
    const style = { ...stack.at(-1).style };
    if (tag === 'i' || tag === 'em' || /font-style\s*:\s*italic/i.test(attributes)) style.italic = true;
    if (tag === 'b' || tag === 'strong' || /font-weight\s*:\s*(bold|700)/i.test(attributes)) style.bold = true;
    if (tag === 'sup' || /vertical-align\s*:\s*sup/i.test(attributes)) style.superscript = true;
    if (tag === 'sub' || /vertical-align\s*:\s*sub/i.test(attributes)) style.subscript = true;
    if (tag === 'u') style.underline = true;
    if (tag === 'a') { const href = /href\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]; if (href && /^(https?:|mailto:)/i.test(href)) style.url = decode(href); }
    if (!/\/\s*>$/.test(token)) stack.push({ tag, style });
  }
  return { text: runs.map(run => run.text).join(''), runs };
}
