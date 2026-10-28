// SPDX-License-Identifier: AGPL-3.0-only
import { node, button, query } from "./common.js";
import { VirtualList } from "./virtual-list.js";
// Navigate one expanded branch at a time; the same bounded tree works on phones.
export class Collections {
  constructor({ element, api, onSelect = () => {} }) {
    this.api = api;
    this.onSelect = onSelect;
    this.path = [];
    this.selected = null;
    this.header = node("div", { class: "collection-path" });
    this.notice = node("p", { class: "notice", role: "status" });
    this.body = node("div", { class: "collection-list" });
    element.append(this.header, this.body, this.notice);
    this.list = new VirtualList({
      element: this.body,
      label: "Collections",
      rowHeight: 42,
      load: async ({ start, limit, signal }) => {
        const result = await this.api.request(
          "collections?" + query({ parent: this.parent, start, limit }),
          { signal },
        );
        return { ...result, hasMore: result.items.length === limit };
      },
      render: (item) =>
        node(
          "span",
          { class: "collection-label", title: item.data.name },
          node("span", { "aria-hidden": "true" }, "▸ "),
          item.data.name,
        ),
      onSelect: (item) => {
        this.selected = item;
        this.list.setSelection([item.key]);
        this.renderPath();
        this.onSelect(item);
      },
      onActivate: (item) => this.enter(item),
      onStatus: (text) => (this.notice.textContent = text),
    });
    this.renderPath();
  }
  get parent() {
    return this.path.at(-1)?.key || null;
  }
  renderPath() {
    this.header.replaceChildren(
      button("All references", () => {
        this.selected = null;
        this.list.setSelection([]);
        this.renderPath();
        this.onSelect(null);
      }),
      button("Top collections", () => {
        this.path = [];
        this.selected = null;
        this.onSelect(null);
        this.refresh();
      }),
    );
    for (const [i, item] of this.path.entries())
      this.header.append(
        button(item.data.name, () => {
          this.path = this.path.slice(0, i + 1);
          this.selected = null;
          this.onSelect(item);
          this.refresh();
        }),
      );
    this.header.append(
      button(
        "Open subcollections",
        () => {
          if (this.selected) this.enter(this.selected);
        },
        { disabled: !this.selected },
      ),
    );
  }
  enter(item) {
    const index = this.path.findIndex((parent) => parent.key === item.key);
    if (index < 0) this.path.push(item);
    else this.path = this.path.slice(0, index + 1);
    this.selected = null;
    this.refresh();
  }
  refresh() {
    this.renderPath();
    this.list.reset({ preserveSelection: false });
  }
  destroy() {
    this.list.destroy();
  }
}
