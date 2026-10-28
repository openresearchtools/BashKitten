// SPDX-License-Identifier: AGPL-3.0-only
// Page metadata may grow with visited pages; record data is bounded to six pages.
// The database owns search/sort. A changed library invalidates the cursor snapshot.
import { node } from "./common.js";
export class VirtualList {
  constructor({
    element,
    load,
    render,
    onSelect = () => {},
    onActivate = () => {},
    key = (item) => item.key,
    rowHeight = 42,
    pageSize = 80,
    label = "Items",
    onStatus = () => {},
    role = "listbox",
    rowRole = "option",
    rowAttributes = () => ({}),
    total = null,
  }) {
    Object.assign(this, {
      element,
      load,
      renderRow: render,
      onSelect,
      onActivate,
      key,
      rowHeight,
      pageSize,
      onStatus,
      rowRole,
      rowAttributes,
    });
    this.pages = new Map();
    this.pending = new Map();
    this.cursors = new Map([[0, null]]);
    this.length = 0;
    this.more = true;
    this.focusIndex = 0;
    this.selected = new Set();
    this.generation = 0;
    this.failures = new Set();
    this.root = node("div", {
      class: "virtual-list",
      role,
      tabindex: "0",
      "aria-label": label,
      "aria-multiselectable": "true",
    });
    this.spacer = node("div", { class: "virtual-space" });
    this.root.append(this.spacer);
    element.append(this.root);
    this.scroll = () => this.draw();
    this.root.addEventListener("scroll", this.scroll, { passive: true });
    this.root.addEventListener("keydown", (event) => this.keydown(event));
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(this.root);
    this.reset({ total });
  }
  reset({
    preserveSelection = true,
    preservePosition = false,
    total = null,
  } = {}) {
    const scroll = preservePosition ? this.root.scrollTop : 0;
    const length = preservePosition ? this.length : 0;
    const focus = preservePosition ? this.focusIndex : 0;
    this.controller?.abort();
    this.controller = new AbortController();
    ++this.generation;
    this.pages.clear();
    this.pending.clear();
    this.failures.clear();
    this.cursors = new Map([[0, null]]);
    this.length = length;
    this.more = true;
    this.version = null;
    this.total = total;
    this.focusIndex = focus;
    this.pendingSelection = null;
    this.root.scrollTop = scroll;
    if (!preserveSelection) this.selected.clear();
    this.draw();
  }
  destroy() {
    this.destroyed = true;
    this.controller.abort();
    this.observer.disconnect();
    this.root.remove();
  }
  setSelection(keys) {
    this.selected = new Set(keys);
    this.draw();
  }
  item(index) {
    return this.pages.get(Math.floor(index / this.pageSize))?.items[
      index % this.pageSize
    ];
  }
  async fetch(page) {
    if (
      this.destroyed ||
      this.controller.signal.aborted ||
      this.pending.size >= 2 ||
      this.pending.has(page) ||
      this.pages.has(page) ||
      this.failures.has(page)
    )
      return;
    const generation = this.generation,
      signal = this.controller.signal;
    this.pending.set(page, true);
    this.onStatus("Loading…");
    try {
      const result = await this.load({
        start: page * this.pageSize,
        limit: this.pageSize,
        cursor: this.cursors.get(page),
        signal,
      });
      if (signal.aborted || generation !== this.generation) return;
      if (
        this.version !== null &&
        result.version !== undefined &&
        result.version !== this.version
      )
        throw Object.assign(
          Error("The library changed. Refresh to load its latest order."),
          { status: 409 },
        );
      this.version = result.version ?? this.version;
      if (Number.isSafeInteger(result.total) && result.total >= 0)
        this.total = result.total;
      this.pages.set(page, result);
      if (result.next) this.cursors.set(page + 1, result.next);
      const end = page * this.pageSize + result.items.length;
      if (end >= this.length || (!result.next && result.hasMore !== true)) {
        this.length = end;
        this.more = !!result.next || result.hasMore === true;
      }
      const visible = Math.floor(
        this.root.scrollTop / this.rowHeight / this.pageSize,
      );
      for (const old of [...this.pages.keys()].sort(
        (a, b) => Math.abs(b - visible) - Math.abs(a - visible),
      )) {
        if (this.pages.size <= 6) break;
        if (Math.abs(old - visible) > 1) this.pages.delete(old);
      }
      this.onStatus(this.length ? "" : "No matching items.");
      if (this.pendingSelection && this.item(this.pendingSelection.index)) {
        const pending = this.pendingSelection;
        this.pendingSelection = null;
        this.select(pending.index, pending.event);
      }
    } catch (error) {
      if (signal.aborted || generation !== this.generation) return;
      this.failures.add(page);
      this.onStatus(error.message, error);
    } finally {
      if (generation === this.generation) {
        this.pending.delete(page);
        this.draw();
      }
    }
  }
  draw() {
    if (this.destroyed || !this.spacer) return;
    const rows = this.total ?? this.length + (this.more ? this.pageSize : 0);
    this.spacer.style.height =
      Math.max(rows * this.rowHeight, this.root.clientHeight) + "px";
    const start = Math.max(
        0,
        Math.floor(this.root.scrollTop / this.rowHeight) - 5,
      ),
      end = Math.min(
        rows,
        Math.ceil(
          (this.root.scrollTop + this.root.clientHeight) / this.rowHeight,
        ) + 5,
      ),
      fragment = document.createDocumentFragment(),
      pages = new Set();
    let active = null;
    for (let i = start; i < end; i++) {
      const item = this.item(i);
      pages.add(Math.floor(i / this.pageSize));
      const row = node("div", {
        class: "virtual-row",
        role: this.rowRole,
        "aria-posinset": i + 1,
        id: "row-" + this.id + "-" + i,
      });
      row.style.top = i * this.rowHeight + "px";
      row.style.height = this.rowHeight + "px";
      if (item) {
        for (const [name, value] of Object.entries(this.rowAttributes(item)))
          row.setAttribute(name, String(value));
        row.setAttribute(
          "aria-selected",
          String(this.selected.has(this.key(item))),
        );
        row.append(this.renderRow(item, i));
        row.addEventListener("click", (event) => this.select(i, event));
        row.addEventListener("dblclick", () => this.onActivate(item));
        if (i === this.focusIndex) active = row.id;
      } else {
        row.classList.add("placeholder");
        row.textContent = this.failures.has(Math.floor(i / this.pageSize))
          ? "Refresh to retry"
          : "Loading…";
      }
      fragment.append(row);
    }
    this.spacer.replaceChildren(fragment);
    if (active) this.root.setAttribute("aria-activedescendant", active);
    else this.root.removeAttribute("aria-activedescendant");
    for (const page of pages) void this.fetch(page);
  }
  get id() {
    return (this._id ??= crypto.randomUUID());
  }
  select(index, event = {}) {
    const item = this.item(index);
    if (!item) {
      this.pendingSelection = {
        index,
        event: {
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        },
      };
      return;
    }
    this.pendingSelection = null;
    this.focusIndex = index;
    this.onSelect(item, {
      toggle: !!(event.ctrlKey || event.metaKey),
      range: !!event.shiftKey,
      index,
    });
    this.root.focus({ preventScroll: true });
    this.draw();
  }
  keydown(event) {
    let index = this.focusIndex;
    const page = Math.max(
      1,
      Math.floor(this.root.clientHeight / this.rowHeight),
    );
    if (event.key === "ArrowDown") index++;
    else if (event.key === "ArrowUp") index--;
    else if (event.key === "PageDown") index += page;
    else if (event.key === "PageUp") index -= page;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = (this.total ?? this.length) - 1;
    else if (event.key === "Enter") {
      const item = this.item(index);
      if (item) {
        event.preventDefault();
        this.onActivate(item);
      }
      return;
    } else if (event.key === " ") {
      event.preventDefault();
      this.select(index, { ctrlKey: true });
      return;
    } else return;
    event.preventDefault();
    index = Math.min(
      Math.max(0, index),
      Math.max(0, (this.total ?? this.length) - 1),
    );
    this.focusIndex = index;
    if (index * this.rowHeight < this.root.scrollTop)
      this.root.scrollTop = index * this.rowHeight;
    else if (
      (index + 1) * this.rowHeight >
      this.root.scrollTop + this.root.clientHeight
    )
      this.root.scrollTop =
        (index + 1) * this.rowHeight - this.root.clientHeight;
    this.select(index, event);
    this.draw();
  }
}
