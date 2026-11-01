// SPDX-License-Identifier: AGPL-3.0-only
import { node, button, dialog, field, human, title, creators, year } from './common.js';

const defaults = [
  { id: 'title', label: 'Title', width: 240, min: 100 },
  { id: 'creator', label: 'Authors', width: 170, min: 80 },
  { id: 'itemType', label: 'Item type', width: 120, min: 70 },
  { id: 'year', label: 'Year', width: 60, min: 48 },
  { id: 'attachmentCount', label: 'Attachments', width: 48, min: 40 },
];
const preferenceKey = 'bashkitten.references.grid.v1';
export class ReferenceGrid {
  constructor({ root, header, selected, onSelect, onSort, onColumns }) {
    Object.assign(this, { root, header, selected, onSelect, onSort, onColumns });
    this.available = new Map(defaults.map(column => [column.id, column]));
    this.visible = defaults.map(column => column.id);
    this.widths = new Map();
    this.multiple = false;
    this.observer = new ResizeObserver(() => this.applyWidths());
    this.observer.observe(root);
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey));
      this.saved = saved && Array.isArray(saved.columns) ? saved : null;
    } catch { this.saved = null; }
  }
  configure(schema) {
    const names = new Set(['dateAdded', 'dateModified', 'tags', 'DOI', 'PMID', 'PMCID', 'OpenAlex', 'arXiv']);
    for (const type of schema.itemTypes)
      for (const entry of type.fields || []) {
        names.add(entry.field);
        if (entry.baseField) names.add(entry.baseField);
      }
    for (const id of names)
      if (id && !this.available.has(id)) this.available.set(id, {
        id, label: schema.locales?.['en-US']?.fields?.[id] || human(id), width: 180, min: 70,
      });
    if (this.saved) {
      this.visible = [...new Set(['title', ...this.saved.columns])].filter(id => this.available.has(id));
      for (const [id, width] of Object.entries(this.saved.widths || {}))
        if (this.available.has(id) && Number.isFinite(width)) this.widths.set(id, Math.max(this.available.get(id).min, width));
      this.saved = null;
    }
    this.renderHeader();
  }
  columns() { return this.visible.map(id => this.available.get(id)); }
  fields() { return this.visible.filter(id => !defaults.some(column => column.id === id)); }
  setMultiple(enabled) {
    this.multiple = enabled;
    this.root.dataset.multiselect = String(enabled);
    this.applyWidths();
  }
  setSort(sort, direction) { this.sort = sort; this.direction = direction; this.renderHeader(); }
  save() {
    try { localStorage.setItem(preferenceKey, JSON.stringify({ columns: this.visible, widths: Object.fromEntries(this.widths) })); }
    catch { /* A browsing profile may disable local preference storage. */ }
  }
  applyWidths() {
    if (!this.root.clientWidth) return;
    const columns = this.columns();
    const widths = columns.map(column => this.widths.get(column.id) || column.width);
    const selectionWidth = this.multiple ? 32 : 0;
    const room = this.root.clientWidth - selectionWidth;
    const shortage = widths.reduce((sum, width) => sum + width, 0) - room;
    const flexible = columns.reduce((sum, column, index) => sum + (this.widths.has(column.id) ? 0 : widths[index] - column.min), 0);
    if (room > 0 && shortage > 0 && flexible > 0)
      columns.forEach((column, index) => {
        if (!this.widths.has(column.id)) widths[index] -= Math.min(shortage, flexible) * (widths[index] - column.min) / flexible;
      });
    this.renderedWidths = new Map(columns.map((column, index) => [column.id, widths[index]]));
    this.root.style.setProperty('--reference-columns', [this.multiple ? '32px' : '0px', ...widths.map(width => width + 'px')].join(' '));
    this.root.style.setProperty('--reference-width', (widths.reduce((sum, width) => sum + width, this.multiple ? 32 : 0)) + 'px');
    for (const separator of this.header.querySelectorAll('.citation-column-resizer')) {
      const column = this.available.get(separator.parentElement.dataset.column);
      separator.setAttribute('aria-valuemin', String(column.min));
      separator.setAttribute('aria-valuenow', String(Math.round(this.renderedWidths.get(column.id))));
    }
  }
  renderHeader() {
    const focused = this.header.contains(document.activeElement)
      ? document.activeElement.closest('[data-column]')?.dataset.column : null;
    this.header.replaceChildren(node('span', { class: 'grid-select-cell', role: 'columnheader', 'aria-label': 'Selection' }));
    for (const column of this.columns()) {
      const sortButton = button(column.label + (this.sort === column.id ? this.direction === 'asc' ? ' ↑' : ' ↓' : ''), () => this.onSort(column.id));
      const heading = node('span', { class: 'reference-column', 'data-column': column.id, role: 'columnheader', 'aria-sort': this.sort === column.id ? this.direction === 'asc' ? 'ascending' : 'descending' : 'none' }, sortButton);
      const separator = node('span', { class: 'citation-column-resizer', role: 'separator', tabindex: '0', 'aria-label': 'Resize ' + column.label, 'aria-orientation': 'vertical', title: 'Drag to resize ' + column.label + ' · arrow keys also resize' });
      let drag;
      const resize = width => {
        this.widths.set(column.id, Math.max(column.min, width));
        this.applyWidths();
      };
      separator.onpointerdown = event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        drag = { id: event.pointerId, x: event.clientX, width: this.renderedWidths?.get(column.id) || this.widths.get(column.id) || column.width };
        separator.setPointerCapture(event.pointerId);
        this.root.classList.add('resizing-citation-columns');
      };
      separator.onpointermove = event => {
        if (drag?.id !== event.pointerId) return;
        event.preventDefault();
        resize(drag.width + event.clientX - drag.x);
      };
      const stop = event => {
        if (drag?.id !== event.pointerId) return;
        drag = null; this.save();
        this.root.classList.remove('resizing-citation-columns');
        if (separator.hasPointerCapture(event.pointerId)) separator.releasePointerCapture(event.pointerId);
      };
      separator.onpointerup = stop; separator.onpointercancel = stop; separator.onlostpointercapture = stop;
      separator.onclick = event => event.stopPropagation();
      separator.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        resize(event.key === 'Home' ? column.width : (this.renderedWidths?.get(column.id) || this.widths.get(column.id) || column.width) + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 24 : 8));
        this.save();
      };
      heading.append(separator); this.header.append(heading);
    }
    this.applyWidths();
    if (focused) this.header.querySelector('[data-column="' + CSS.escape(focused) + '"] > button')?.focus({ preventScroll: true });
  }
  value(item, column) {
    if (column.id === 'title') return title(item);
    if (column.id === 'creator') return creators(item);
    if (column.id === 'year') return year(item);
    if (column.id === 'itemType') return this.typeLabel?.(item.data.itemType) || human(item.data.itemType);
    if (column.id === 'attachmentCount') return String(item.meta?.attachmentCount ?? item.data.attachmentCount ?? 0);
    if (column.id === 'tags') return (item.data.tags || []).map(tag => typeof tag === 'string' ? tag : tag.tag).join('; ');
    const value = item.data[column.id];
    return value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  render(item, index) {
    const checkbox = node('input', { type: 'checkbox', class: 'row-checkbox', checked: this.selected(item), 'aria-label': 'Select ' + title(item) });
    let range = false;
    checkbox.onclick = event => { range = event.shiftKey; };
    checkbox.onchange = async () => {
      await this.onSelect(item, { toggle: true, range, index });
      checkbox.checked = this.selected(item);
    };
    const row = node('div', { class: 'record-row' }, node('span', { class: 'grid-select-cell' }, checkbox));
    for (const column of this.columns()) {
      const value = this.value(item, column);
      row.append(node('span', { role: 'gridcell', title: value }, value));
    }
    return row;
  }
  chooseColumns() {
    const d = dialog('Reference columns'), options = node('div', { class: 'citation-column-options' }),
      search = node('input', { type: 'search', placeholder: 'Find a metadata field', 'aria-label': 'Find a column' });
    const controls = [...this.available.values()].sort((a, b) => a.label.localeCompare(b.label)).map(column => {
      const input = node('input', { type: 'checkbox', checked: this.visible.includes(column.id), disabled: column.id === 'title' });
      const row = field(column.label, input); options.append(row);
      return { column, input, row };
    });
    search.oninput = () => { for (const { column, row } of controls) row.hidden = !column.label.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()); };
    d.body.append(field('Columns', search), options);
    d.notice.textContent = 'Drag column dividers to resize. Click a heading to sort; click it again to reverse the order.';
    d.actions.append(button('Cancel', () => d.el.close()), button('Apply columns', () => {
      const chosen = new Set(controls.filter(entry => entry.input.checked).map(entry => entry.column.id));
      this.visible = [...this.visible.filter(id => chosen.has(id)), ...[...chosen].filter(id => !this.visible.includes(id))];
      this.save(); this.renderHeader(); this.onColumns(); d.el.close();
    }, { class: 'primary' }));
    d.open(); search.focus();
  }
}
