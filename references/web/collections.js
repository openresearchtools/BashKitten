// SPDX-License-Identifier: AGPL-3.0-only
import { node, button, query } from "./common.js";
import { VirtualList } from "./virtual-list.js";

// One windowed tree, including simultaneously expanded branches. Branch spans
// contain sparse page positions, not a materialized array of every collection.
export class Collections {
  constructor({ element, api, onSelect = () => {} }) {
    this.api = api;
    this.onSelect = onSelect;
    this.expanded = new Set();
    this.cache = new Map();
    this.version = null;
    this.selected = null;
    this.serial = 0;
    this.destroyed = false;
    this.queue = [];
    this.active = 0;
    this.header = node("div", { class: "collection-path" });
    this.notice = node("p", { class: "notice", role: "status" });
    this.body = node("div", { class: "collection-list" });
    element.append(this.header, this.body, this.notice);
    this.root = this.branch(null, null, -1, null);
    this.list = new VirtualList({
      element: this.body,
      label: "Collections",
      role: "tree",
      rowRole: "treeitem",
      pageSize: 40,
      rowHeight: 42,
      total: this.root.span,
      key: (row) =>
        row.item?.key || "pending-" + row.branch.serial + "-" + row.index,
      rowAttributes: (row) => ({
        "aria-level": row.branch.depth + 1,
        "aria-posinset": row.index + 1,
        ...(row.item
          ? { "aria-expanded": String(this.expanded.has(row.item.key)) }
          : { "aria-disabled": "true" }),
      }),
      load: (args) => this.loadRows(args),
      render: (row) => this.renderRow(row),
      onSelect: (row) => {
        if (!row.item) return;
        this.focusRow = row;
        this.selected = row.item;
        this.list.setSelection([row.item.key]);
        this.onSelect(row.item);
      },
      onActivate: (row) => this.toggle(row),
      onStatus: (text, error) => {
        this.notice.textContent = error ? error.message : text;
      },
    });
    this.list.root.setAttribute("aria-multiselectable", "false");
    this.list.root.addEventListener("keydown", (event) => this.treeKey(event));
    this.header.append(
      button("All references", () => {
        this.selected = null;
        this.list.setSelection([]);
        this.onSelect(null);
      }),
      button("Collapse all", () => {
        this.expanded.clear();
        this.refresh();
      }),
      button("Refresh collections", () => this.refresh()),
    );
  }
  get parent() {
    return this.selected?.key || null;
  }
  branch(key, owner, index, item) {
    return {
      key,
      owner,
      index,
      item,
      serial: ++this.serial,
      depth: owner ? owner.depth + 1 : 0,
      extent: 0,
      more: true,
      span: 1,
      children: new Map(),
      offsets: [],
      controller: new AbortController(),
      pending: new Map(),
    };
  }
  recalculate(branch) {
    for (let current = branch; current; current = current.owner) {
      let added = 0;
      current.offsets = [];
      for (const [index, child] of [...current.children].sort(
        (a, b) => a[0] - b[0],
      )) {
        current.offsets.push({ index, start: index + added, child });
        added += child.span;
      }
      current.span = current.extent + (current.more ? 1 : 0) + added;
    }
  }
  locate(branch, index) {
    // Binary search the sparse expansion boundaries; collapsed sibling ranges
    // cost O(1) memory and do not require visiting their records.
    let low = 0,
      high = branch.offsets.length - 1,
      last = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (branch.offsets[mid].start <= index) {
        last = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (last >= 0) {
      const entry = branch.offsets[last];
      if (index === entry.start) return { branch, index: entry.index };
      if (index <= entry.start + entry.child.span)
        return this.locate(entry.child, index - entry.start - 1);
      return {
        branch,
        index: index - (entry.start - entry.index + entry.child.span),
      };
    }
    return { branch, index };
  }
  position(branch, index) {
    let position = index;
    for (const entry of branch.offsets) {
      if (entry.index >= index) break;
      position += entry.child.span;
    }
    if (branch.owner)
      return this.position(branch.owner, branch.index) + 1 + position;
    return position;
  }
  invalidate() {
    if (this.destroyed || this.repaintPending) return;
    const anchor = this.list.item(
      Math.floor(this.list.root.scrollTop / this.list.rowHeight),
    );
    const remainder = this.list.root.scrollTop % this.list.rowHeight;
    this.repaintPending = true;
    queueMicrotask(() => {
      this.repaintPending = false;
      if (this.destroyed) return;
      const focus =
        this.focusRow?.branch && !this.focusRow.branch.controller.signal.aborted
          ? this.position(this.focusRow.branch, this.focusRow.index)
          : null;
      this.list.reset({ preservePosition: true, total: this.root.span });
      if (anchor && !anchor.branch.controller.signal.aborted)
        this.list.root.scrollTop =
          this.position(anchor.branch, anchor.index) * this.list.rowHeight +
          remainder;
      if (focus !== null) this.list.focusIndex = focus;
      if (!this.root.span) this.notice.textContent = "No collections.";
      this.list.setSelection(this.selected ? [this.selected.key] : []);
    });
  }
  touch(key, value) {
    this.cache.delete(key);
    this.cache.set(key, value);
    while (this.cache.size > 6)
      this.cache.delete(this.cache.keys().next().value);
    return value;
  }
  request(signal, task) {
    return new Promise((resolve, reject) => {
      const entry = { signal, task, resolve, reject };
      const abort = () => {
        entry.cancelled = true;
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      entry.cleanup = () => signal.removeEventListener("abort", abort);
      this.queue.push(entry);
      this.pump();
    });
  }
  pump() {
    while (this.active < 2 && this.queue.length) {
      const entry = this.queue.shift();
      if (entry.cancelled || entry.signal.aborted) {
        entry.cleanup();
        entry.reject(entry.signal.reason);
        continue;
      }
      ++this.active;
      Promise.resolve()
        .then(entry.task)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          entry.cleanup();
          --this.active;
          this.pump();
        });
    }
  }
  async page(branch, pageIndex, viewSignal) {
    const key = branch.serial + ":" + pageIndex;
    if (this.cache.has(key)) return this.touch(key, this.cache.get(key));
    const pending = branch.pending.get(pageIndex);
    if (pending && !pending.signal.aborted) return pending.promise;
    const signal = AbortSignal.any([branch.controller.signal, viewSignal]);
    const promise = (async () => {
      const result = await this.request(signal, () =>
        this.api.request(
          "collections?" +
            query({ parent: branch.key, start: pageIndex * 80, limit: 80 }),
          { signal },
        ),
      );
      signal.throwIfAborted();
      if (this.version !== null && result.version !== this.version)
        throw Error(
          "The library changed. Refresh collections to load their current order.",
        );
      this.version = result.version;
      const previous = this.root.span,
        end = pageIndex * 80 + result.items.length;
      branch.extent = Math.max(branch.extent, end);
      if (result.items.length < 80) {
        branch.extent = end;
        branch.more = false;
      }
      for (const [offset, item] of result.items.entries()) {
        const index = pageIndex * 80 + offset;
        if (this.expanded.has(item.key) && !branch.children.has(index))
          branch.children.set(
            index,
            this.branch(item.key, branch, index, item),
          );
      }
      this.touch(key, result);
      this.recalculate(branch);
      if (this.root.span !== previous) this.invalidate();
      return result;
    })();
    branch.pending.set(pageIndex, { promise, signal });
    try {
      return await promise;
    } finally {
      if (branch.pending.get(pageIndex)?.promise === promise)
        branch.pending.delete(pageIndex);
    }
  }
  async loadRows({ start, limit, signal }) {
    const rows = [];
    for (
      let index = start;
      index < Math.min(start + limit, this.root.span);
      index++
    ) {
      signal.throwIfAborted();
      const location = this.locate(this.root, index),
        branch = location.branch;
      const result = await this.page(
        branch,
        Math.floor(location.index / 80),
        signal,
      );
      signal.throwIfAborted();
      const item = result.items[location.index % 80];
      if (!item) break;
      rows.push({ ...location, item });
    }
    return { items: rows, total: this.root.span, version: this.version };
  }
  renderRow(row) {
    const expanded = this.expanded.has(row.item.key),
      toggle = button(
        expanded ? "▾" : "▸",
        (event) => {
          event.stopPropagation();
          this.toggle(row);
        },
        {
          "aria-label":
            (expanded ? "Collapse " : "Expand ") + row.item.data.name,
          "aria-expanded": expanded,
          class: "tree-toggle",
        },
      );
    const label = node(
      "span",
      { class: "collection-label", title: row.item.data.name },
      row.item.data.name,
    );
    const result = node("div", { class: "collection-tree-row" }, toggle, label);
    result.style.paddingInlineStart =
      Math.min(row.branch.depth, 12) * 12 + "px";
    return result;
  }
  stop(branch) {
    const pending = [branch];
    while (pending.length) {
      const current = pending.pop();
      current.controller.abort();
      pending.push(...current.children.values());
    }
  }
  toggle(row) {
    if (!row?.item) return;
    this.focusRow = row;
    if (this.expanded.has(row.item.key)) {
      this.expanded.delete(row.item.key);
      const child = row.branch.children.get(row.index);
      if (child) this.stop(child);
      row.branch.children.delete(row.index);
    } else {
      this.expanded.add(row.item.key);
      row.branch.children.set(
        row.index,
        this.branch(row.item.key, row.branch, row.index, row.item),
      );
    }
    this.recalculate(row.branch);
    this.invalidate();
    this.list.root.focus({ preventScroll: true });
  }
  treeKey(event) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const row = this.list.item(this.list.focusIndex);
    if (!row?.item) return;
    event.preventDefault();
    if (event.key === "ArrowRight") {
      if (!this.expanded.has(row.item.key)) this.toggle(row);
      else if (row.branch.children.get(row.index)?.span) {
        this.list.focusIndex++;
        this.list.select(this.list.focusIndex);
        this.list.draw();
      }
    } else if (this.expanded.has(row.item.key)) this.toggle(row);
    else if (row.branch.owner) {
      const position = this.position(row.branch.owner, row.branch.index);
      this.list.focusIndex = position;
      this.list.select(position);
      this.list.draw();
    }
  }
  refresh() {
    this.stop(this.root);
    this.cache.clear();
    this.version = null;
    this.focusRow = null;
    this.root = this.branch(null, null, -1, null);
    this.list.reset({ preservePosition: false, total: this.root.span });
    this.list.setSelection(this.selected ? [this.selected.key] : []);
  }
  destroy() {
    this.destroyed = true;
    this.stop(this.root);
    this.cache.clear();
    this.list.destroy();
  }
}
