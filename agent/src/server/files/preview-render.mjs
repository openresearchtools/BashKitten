// SPDX-License-Identifier: AGPL-3.0-only
// Offline documents: no Agent URL, credential, bridge, storage or network access.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { marked, Renderer } from 'marked';
import { utils as sheetUtils } from 'xlsx';

const require = createRequire(import.meta.url);
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const css = `
:root{color-scheme:light dark;font:15px/1.6 system-ui,sans-serif;background:Canvas;color:CanvasText}*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit;color:inherit;background:Canvas;border:1px solid GrayText;border-radius:6px;padding:5px 9px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid Highlight;outline-offset:2px}header{position:sticky;top:0;z-index:3;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 16px;background:Canvas;border-bottom:1px solid GrayText}header strong{min-width:0;flex:1;overflow-wrap:anywhere}.muted{font-size:12px;opacity:.75}.hidden,[hidden]{display:none!important}main{max-width:960px;margin:auto;padding:24px;overflow-wrap:anywhere}pre{white-space:pre;overflow:auto;padding:14px;background:color-mix(in srgb,CanvasText 6%,Canvas);border-radius:6px;font:13px/1.6 ui-monospace,monospace}#raw{margin:0;border-radius:0;padding:20px;max-width:none;min-height:calc(100vh - 65px)}code{font-family:ui-monospace,monospace;font-size:.9em}h1,h2,h3,h4,h5,h6{line-height:1.25;scroll-margin-top:100px}blockquote{margin-inline:0;padding-inline:18px;border-inline-start:3px solid GrayText}img{max-width:100%;height:auto}.table-scroll{overflow-x:auto;max-width:100%;margin:18px 0}table{border-collapse:collapse;font-size:14px;min-width:100%}td,th{padding:7px 14px;text-align:start;border:1px solid GrayText;white-space:nowrap;min-width:120px;max-width:8000px}td[align=right],th[align=right]{text-align:right}td[align=center],th[align=center]{text-align:center}th{background:color-mix(in srgb,CanvasText 8%,Canvas)}.external-link{display:inline;overflow-wrap:anywhere}.external-link input{max-width:100%;width:24em;font-size:12px;padding:2px 4px}.external-link button{font-size:11px;padding:1px 5px;margin-inline:4px}.sheet-tools{padding:8px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.sheet-tools input{width:8em}#sheetGrid{position:relative;height:calc(100dvh - 156px);min-height:240px;overflow:auto;border-block:1px solid GrayText;overscroll-behavior:contain}#gridSpace{position:relative}#gridCells{position:absolute;inset:0}.cell{position:absolute;height:28px;width:180px;line-height:27px;padding:0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-right:1px solid color-mix(in srgb,CanvasText 20%,Canvas);border-bottom:1px solid color-mix(in srgb,CanvasText 20%,Canvas);font:13px/27px ui-monospace,monospace;background:Canvas}.cell.heading{font-weight:bold;background:color-mix(in srgb,CanvasText 8%,Canvas);z-index:1}.cell.formula{font-style:italic;color:GrayText}.cell:focus{outline:2px solid Highlight;outline-offset:-2px;z-index:2}#cellValue{margin:0;padding:8px 12px;max-height:15dvh;overflow:auto;white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace}#sheetNote{padding:0 12px} @media(max-width:600px){main{padding:16px}header{padding:8px}#sheetGrid{height:calc(100dvh - 205px)}}`;

// Only this code and the pinned sanitizer run inside the opaque sandbox. User
// document HTML is inert JSON until sanitized; links never navigate the frame.
function documentRuntime() {
  const byId = id => document.getElementById(id);
  const metadata = JSON.parse(byId('metadata').textContent);
  const raw = byId('raw'), article = byId('rendered');
  const download = byId('downloadRaw');
  if (download) download.onclick = () => {
    const url = URL.createObjectURL(new Blob([raw.textContent], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = metadata.name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  if (metadata.kind !== 'markdown') return;
  const toggle = byId('toggleRaw');
  toggle.onclick = () => {
    const showingRaw = raw.hidden; raw.hidden = !showingRaw; article.hidden = showingRaw;
    toggle.textContent = showingRaw ? 'Rendered' : 'Raw'; toggle.setAttribute('aria-pressed', String(showingRaw));
  };
  const headingIds = new Map();
  function safeFragment(html) {
    const fragment = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true }, RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'audio', 'video', 'source', 'picture', 'base', 'link', 'meta'],
      FORBID_ATTR: ['id', 'name', 'style', 'srcset', 'target', 'download', 'formaction'], ALLOW_DATA_ATTR: false,
    });
    for (const image of fragment.querySelectorAll('img')) {
      if (!/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.test(image.getAttribute('src') || '')) {
        const label = document.createElement('span'); label.textContent = image.alt ? '[Image: ' + image.alt + ']' : '[External image]'; image.replaceWith(label);
      }
    }
    for (const heading of fragment.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const slug = heading.textContent.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-') || 'heading';
      const count = headingIds.get(slug) || 0; headingIds.set(slug, count + 1); heading.id = 'document-' + slug + (count ? '-' + count : '');
    }
    for (const anchor of fragment.querySelectorAll('a')) {
      const href = anchor.getAttribute('href') || ''; anchor.removeAttribute('href');
      if (href.startsWith('#')) {
        let fragmentId; try { fragmentId = decodeURIComponent(href.slice(1)); } catch { continue; }
        anchor.href = '#document-' + fragmentId;
        anchor.onclick = event => { event.preventDefault(); byId('document-' + fragmentId)?.scrollIntoView(); };
      } else if (/^https?:\/\//i.test(href)) {
        const holder = document.createElement('span'); holder.className = 'external-link';
        const label = document.createElement('span'); label.append(...anchor.childNodes); holder.append(label, ' ');
        const address = document.createElement('input'); address.readOnly = true; address.value = href; address.setAttribute('aria-label', 'External link');
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy link';
        copy.onclick = () => { address.focus(); address.select(); try { copy.textContent = document.execCommand('copy') ? 'Copied' : 'Select and copy'; } catch { copy.textContent = 'Select and copy'; } };
        holder.append(address, copy); anchor.replaceWith(holder);
      }
    }
    for (const table of fragment.querySelectorAll('table')) {
      const wrap = document.createElement('div'); wrap.className = 'table-scroll'; wrap.tabIndex = 0; wrap.setAttribute('aria-label', 'Scrollable table'); table.replaceWith(wrap); wrap.append(table);
    }
    return fragment;
  }
  const chunks = document.querySelectorAll('script[data-markdown]'); let index = 0;
  function append() {
    if (index === chunks.length) { byId('renderStatus').textContent = ''; return; }
    try { article.append(safeFragment(JSON.parse(chunks[index++].textContent))); }
    catch { byId('renderStatus').textContent = 'Unable to render this document. Raw text remains available.'; return; }
    requestAnimationFrame(append);
  }
  append();
}

function sheetRuntime() {
  const byId = id => document.getElementById(id);
  const metadata = JSON.parse(byId('metadata').textContent);
  const select = byId('sheetSelect'), grid = byId('sheetGrid'), space = byId('gridSpace'), cells = byId('gridCells');
  const rowInput = byId('rowStart'), columnInput = byId('columnStart');
  const HEIGHT = 28, WIDTH = 180, LABEL = 64, PAGE_ROWS = 8192, PAGE_COLUMNS = 256;
  let sheetIndex = 0, startRow = 0, startColumn = 0, pageRows = 0, pageColumns = 0, frame = 0;
  const cache = new Map();
  function columnName(index) { let name = ''; for (index++; index > 0; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name; return name; }
  function chunk(row, column) {
    const id = 'sheet-' + sheetIndex + '-' + Math.floor(row / 32) + '-' + Math.floor(column / 32);
    if (cache.has(id)) { const value = cache.get(id); cache.delete(id); cache.set(id, value); return value; }
    const element = byId(id), values = new Map(element ? JSON.parse(element.textContent).map(value => [value[0] + ':' + value[1], value]) : []);
    cache.set(id, values); if (cache.size > 16) cache.delete(cache.keys().next().value); return values;
  }
  function cell(text, row, column, heading, formula = false) {
    const element = document.createElement('div'); element.className = 'cell' + (heading ? ' heading' : '') + (formula ? ' formula' : '');
    element.textContent = text; element.title = text; element.setAttribute('role', heading ? (row < 0 ? 'columnheader' : 'rowheader') : 'gridcell');
    element.style.left = (column < 0 ? grid.scrollLeft : LABEL + column * WIDTH) + 'px'; element.style.top = (row < 0 ? grid.scrollTop : HEIGHT + row * HEIGHT) + 'px';
    if (column < 0) element.style.width = LABEL + 'px';
    if (!heading) { element.tabIndex = 0; element.setAttribute('aria-label', columnName(startColumn + column) + (startRow + row + 1) + ': ' + text); element.onfocus = element.onclick = () => { byId('cellValue').textContent = element.getAttribute('aria-label'); }; }
    cells.append(element);
  }
  function render() {
    frame = 0; cells.replaceChildren();
    const r0 = Math.max(0, Math.floor((grid.scrollTop - HEIGHT) / HEIGHT) - 1), r1 = Math.min(pageRows, r0 + Math.ceil(grid.clientHeight / HEIGHT) + 3);
    const c0 = Math.max(0, Math.floor((grid.scrollLeft - LABEL) / WIDTH) - 1), c1 = Math.min(pageColumns, c0 + Math.ceil(grid.clientWidth / WIDTH) + 3);
    for (let row = r0; row < r1; row++) for (let column = c0; column < c1; column++) {
      const r = startRow + row, c = startColumn + column, value = chunk(r, c).get(r + ':' + c); cell(value?.[2] || '', row, column, false, Boolean(value?.[3]));
    }
    for (let row = r0; row < r1; row++) cell(String(startRow + row + 1), row, -1, true);
    for (let column = c0; column < c1; column++) cell(columnName(startColumn + column), -1, column, true);
    cell('', -1, -1, true);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(render); }
  function page() {
    const sheet = metadata.sheets[sheetIndex];
    startRow = Math.max(sheet.startRow, Math.min(sheet.endRow, Number(rowInput.value || sheet.startRow + 1) - 1));
    startColumn = Math.max(sheet.startColumn, Math.min(sheet.endColumn, Number(columnInput.value || sheet.startColumn + 1) - 1));
    startRow = Math.floor(startRow); startColumn = Math.floor(startColumn);
    pageRows = Math.min(PAGE_ROWS, sheet.endRow - startRow + 1); pageColumns = Math.min(PAGE_COLUMNS, sheet.endColumn - startColumn + 1);
    rowInput.value = startRow + 1; columnInput.value = startColumn + 1;
    rowInput.min = sheet.startRow + 1; rowInput.max = sheet.endRow + 1; columnInput.min = sheet.startColumn + 1; columnInput.max = sheet.endColumn + 1;
    byId('sheetRange').textContent = 'Rows ' + (startRow + 1) + '–' + (startRow + pageRows) + ' of ' + (sheet.endRow + 1) + ' · Columns ' + columnName(startColumn) + '–' + columnName(startColumn + pageColumns - 1) + ' of ' + columnName(sheet.endColumn);
    byId('previousRows').disabled = startRow <= sheet.startRow; byId('nextRows').disabled = startRow + pageRows > sheet.endRow;
    byId('previousColumns').disabled = startColumn <= sheet.startColumn; byId('nextColumns').disabled = startColumn + pageColumns > sheet.endColumn;
    space.style.width = LABEL + pageColumns * WIDTH + 'px'; space.style.height = HEIGHT + pageRows * HEIGHT + 'px';
    grid.scrollTop = grid.scrollLeft = 0; cache.clear(); byId('cellValue').textContent = ''; schedule();
  }
  for (const [index, sheet] of metadata.sheets.entries()) { const option = document.createElement('option'); option.value = index; option.textContent = sheet.name; select.append(option); }
  if (!metadata.sheets.length) { byId('sheetRange').textContent = 'No worksheets'; return; }
  select.onchange = () => { sheetIndex = Number(select.value); rowInput.value = metadata.sheets[sheetIndex].startRow + 1; columnInput.value = metadata.sheets[sheetIndex].startColumn + 1; page(); };
  byId('goRange').onclick = page;
  byId('previousRows').onclick = () => { rowInput.value = Math.max(1, startRow - PAGE_ROWS + 1); page(); };
  byId('nextRows').onclick = () => { rowInput.value = startRow + PAGE_ROWS + 1; page(); };
  byId('previousColumns').onclick = () => { columnInput.value = Math.max(1, startColumn - PAGE_COLUMNS + 1); page(); };
  byId('nextColumns').onclick = () => { columnInput.value = startColumn + PAGE_COLUMNS + 1; page(); };
  grid.addEventListener('scroll', schedule, { passive: true }); new ResizeObserver(schedule).observe(grid); select.onchange();
}

function markdownRenderer() {
  const renderer = new Renderer();
  renderer.tablecell = function (cell) { const tag = cell.header ? 'th' : 'td'; return '<' + tag + (cell.align ? ' align="' + escape(cell.align) + '"' : '') + '>' + this.parser.parseInline(cell.tokens) + '</' + tag + '>'; };
  const table = renderer.table;
  renderer.table = function (token) {
    // Repeat semantic headers in bounded row blocks; each table gets its own
    // horizontal scroller after sanitation, leaving surrounding prose responsive.
    if (!token.rows.length) return table.call(this, token);
    let html = '';
    for (let start = 0; start < token.rows.length; start += 32) html += table.call(this, { ...token, rows: token.rows.slice(start, start + 32) });
    return html;
  };
  return renderer;
}

function sheetCell(cell) {
  if (!cell) return null;
  const missing = cell.f && (cell.v === undefined || cell.v === null);
  if (missing) return ['=' + cell.f + ' (not calculated)', true];
  if (cell.w !== undefined) return [String(cell.w), false];
  if (cell.v === undefined || cell.v === null) return null;
  return [cell.v instanceof Date ? cell.v.toISOString() : String(cell.v), false];
}

export async function renderPreview({ kind, name, text = '', workbook }, outputPath) {
  if (!['text', 'markdown', 'sheet'].includes(kind)) throw new Error('Unsupported HTML preview kind');
  const nonce = randomBytes(24).toString('base64');
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; frame-src 'self' about:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const output = await fs.open(outputPath, 'wx', 0o600);
  // Writes are awaited, including each workbook page, so output backpressure
  // cannot accumulate the entire standalone document in the worker's memory.
  const write = value => output.writeFile(value);
  const inner = value => write(escape(value));
  const data = (id, value, attributes = '') => inner(`<script type="application/json" id="${id}" ${attributes}>${json(value)}</script>`);
  try {
    await write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><title>${escape(name)}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style></head><body><iframe title="${escape(name)}" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer" srcdoc="`);
    await inner(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><title>${escape(name)}</title><style>${css}</style></head><body><header><strong>${escape(name)}</strong>`);
    if (kind === 'sheet') {
      await inner('<select id="sheetSelect" aria-label="Worksheet"></select></header><div class="sheet-tools"><label>Row <input id="rowStart" type="number" step="1"></label><label>Column number <input id="columnStart" type="number" step="1"></label><button id="goRange">Go</button><button id="previousRows" aria-label="Previous rows">↑ Rows</button><button id="nextRows" aria-label="Next rows">↓ Rows</button><button id="previousColumns" aria-label="Previous columns">← Columns</button><button id="nextColumns" aria-label="Next columns">→ Columns</button><span id="sheetRange" class="muted" role="status"></span></div><div id="sheetGrid" role="grid" aria-label="Read-only worksheet" tabindex="0"><div id="gridSpace"><div id="gridCells"></div></div></div><pre id="cellValue" aria-live="polite"></pre><p id="sheetNote" class="muted">Read-only values. Formulas show saved results; uncached formulas are labelled “not calculated”. Download the original file from Files.</p>');
      const sheets = [];
      for (const [index, sheetName] of (workbook?.SheetNames || []).entries()) {
        const sheet = workbook.Sheets[sheetName], range = sheetUtils.decode_range(sheet['!ref'] || 'A1');
        const rows = sheet['!data'] || [];
        sheets.push({ name: sheetName, startRow: range.s.r, startColumn: range.s.c, endRow: range.e.r, endColumn: range.e.c });
        let block = -1, pages = new Map();
        const flush = async () => { for (const [column, values] of pages) await data(`sheet-${index}-${block}-${column}`, values); pages = new Map(); };
        for (const rowKey of Object.keys(rows)) {
          if (!/^\d+$/.test(rowKey)) continue;
          const row = Number(rowKey), rowBlock = Math.floor(row / 32);
          if (row < range.s.r || row > range.e.r) continue;
          if (rowBlock !== block) { await flush(); block = rowBlock; }
          for (const columnKey of Object.keys(rows[row] || [])) {
            if (!/^\d+$/.test(columnKey)) continue;
            const column = Number(columnKey); if (column < range.s.c || column > range.e.c) continue;
            const value = sheetCell(rows[row][column]); if (!value) continue;
            const columnBlock = Math.floor(column / 32); if (!pages.has(columnBlock)) pages.set(columnBlock, []);
            pages.get(columnBlock).push([row, column, ...value]);
          }
        }
        await flush();
      }
      await data('metadata', { kind, name, sheets });
      await inner(`<script nonce="${nonce}">(${sheetRuntime.toString()})();</script>`);
    } else {
      await inner(`${kind === 'markdown' ? '<button id="toggleRaw" aria-pressed="false">Raw</button>' : ''}<button id="downloadRaw">Download raw</button><span id="renderStatus" class="muted" role="status">${kind === 'markdown' ? 'Rendering…' : ''}</span></header><pre id="raw"${kind === 'markdown' ? ' hidden' : ''}><code>`);
      for (let offset = 0; offset < text.length;) {
        let end = Math.min(text.length, offset + 65536);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
        await inner(escape(text.slice(offset, end))); offset = end;
      }
      await inner('</code></pre><main id="rendered"></main>');
      await data('metadata', { kind, name });
      if (kind === 'markdown') {
        const tokens = marked.lexer(text, { gfm: true }), renderer = markdownRenderer();
        let index = 0;
        for (const token of tokens) {
          const part = [token]; part.links = tokens.links;
          await data('markdown-' + index++, marked.parser(part, { gfm: true, renderer }), 'data-markdown');
        }
        const sanitizer = await fs.readFile(path.join(path.dirname(require.resolve('dompurify')), 'purify.min.js'), 'utf8');
        if (/<\/script/i.test(sanitizer)) throw new Error('Sanitizer bundle cannot be embedded safely');
        await inner(`<script nonce="${nonce}">${sanitizer}</script>`);
      }
      await inner(`<script nonce="${nonce}">(${documentRuntime.toString()})();</script>`);
    }
    await inner('</body></html>');
    await write('"></iframe></body></html>');
    await output.sync();
  } finally { await output.close(); }
}
