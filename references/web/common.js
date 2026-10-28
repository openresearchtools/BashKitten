// SPDX-License-Identifier: AGPL-3.0-only
export function node(tag, attributes = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (["checked", "disabled", "hidden", "value"].includes(key))
      el[key] = value;
    else el.setAttribute(key, String(value));
  }
  el.append(...children.filter((x) => x !== undefined && x !== null));
  return el;
}
export const button = (label, action, attributes = {}) =>
  node("button", { type: "button", ...attributes, onclick: action }, label);
export const human = (value) =>
  String(value || "")
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (s) => s.toUpperCase());
export const creators = (item) =>
  (item.data?.creators || [])
    .map((c) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" "))
    .join("; ");
export const title = (item) =>
  item.data?.title ||
  item.data?.note?.replace(/<[^>]+>/g, "").slice(0, 120) ||
  "Untitled";
export const year = (item) =>
  String(item.data?.date || "").match(/\d{4}/)?.[0] || "";
export const query = (values) =>
  new URLSearchParams(
    Object.entries(values).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  ).toString();
export function field(label, input) {
  return node("label", { class: "field" }, node("span", {}, label), input);
}
export function status(target, error) {
  target.textContent = error?.message || String(error || "");
  target.classList.toggle("error", !!error);
}
// CSL markup is data. Retain formatting without accepting scripts/URLs from item fields.
export function renderedHTML(target, html) {
  const parsed = new DOMParser().parseFromString(
      String(html || ""),
      "text/html",
    ),
    allowed = new Set([
      "I",
      "B",
      "EM",
      "STRONG",
      "SPAN",
      "DIV",
      "P",
      "SUP",
      "SUB",
      "BR",
      "A",
      "SMALL",
    ]);
  function copy(parent) {
    const frag = document.createDocumentFragment();
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) frag.append(child.textContent);
      else if (
        child.nodeType === Node.ELEMENT_NODE &&
        allowed.has(child.tagName)
      ) {
        const el = node(child.tagName.toLowerCase());
        if (child.tagName === "A") {
          const href = child.getAttribute("href");
          if (/^https?:\/\//i.test(href || "")) {
            el.href = href;
            el.target = "_blank";
            el.rel = "noopener noreferrer";
          }
        }
        if (child.className && /^[\w -]+$/.test(child.className))
          el.className = child.className;
        for (const property of [
          "font-style",
          "font-weight",
          "text-decoration",
          "vertical-align",
          "text-align",
          "display",
          "padding-left",
          "margin-left",
          "text-indent",
        ]) {
          const value = child.style.getPropertyValue(property);
          if (value && !/url\(|expression|[<>]/i.test(value))
            el.style.setProperty(property, value);
        }
        el.append(copy(child));
        frag.append(el);
      }
    }
    return frag;
  }
  target.replaceChildren(copy(parsed.body));
}
export function dialog(titleText) {
  const titleId = "dialog-" + crypto.randomUUID(),
    el = node("dialog", {
      "aria-labelledby": titleId,
      class: "reference-dialog",
    }),
    heading = node("h2", { id: titleId }, titleText),
    body = node("div", { class: "dialog-content" }),
    notice = node("p", { class: "notice", role: "status" }),
    actions = node("div", { class: "dialog-actions" });
  el.append(heading, body, notice, actions);
  document.body.append(el);
  el.addEventListener("close", () => el.remove(), { once: true });
  return { el, body, notice, actions, open: () => el.showModal() };
}
export async function promptFields(
  titleText,
  fields,
  { submit = "Save" } = {},
) {
  const d = dialog(titleText),
    form = node("form");
  for (const f of fields) form.append(f);
  const cancel = button("Cancel", () => d.el.close());
  d.actions.append(
    cancel,
    button(submit, () => form.requestSubmit(), { class: "primary" }),
  );
  d.body.append(form);
  return new Promise((resolve) => {
    let accepted = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      accepted = true;
      resolve(form);
      d.el.close();
    });
    d.el.addEventListener(
      "close",
      () => {
        if (!accepted) resolve(null);
      },
      { once: true },
    );
    d.open();
    fields[0]?.querySelector("input,select,textarea")?.focus();
  });
}
export function debounce(fn, delay = 250) {
  let timer;
  const invoke = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  invoke.cancel = () => clearTimeout(timer);
  return invoke;
}
