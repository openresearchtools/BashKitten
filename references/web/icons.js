// SPDX-License-Identifier: AGPL-3.0-only
// UI artwork inherits the current text colour in both native browser themes.
const paths = {
  add: '<path d="M12 5v14M5 12h14"/>',
  identifier: '<path d="m3 19 11-11 4 4L7 23zM11 11l4 4M18 2v4M16 4h4M5 3v4M3 5h4M20 16v4M18 18h4"/>',
  import: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  export: '<path d="M12 15V3M8 7l4-4 4 4M4 16v5h16v-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  literature: '<path d="M3 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-3-2H3zM13 7a3 3 0 0 1 3-3h5v9M16 16l5 5"/><circle cx="16" cy="15" r="3"/>',
  refresh: '<path d="M20 7V3l-3 3a8 8 0 1 0 3 10M20 3h-5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M15 4v16"/>',
  'sidebar-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M6 8v8"/>',
  'sidebar-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M18 8v8"/>',
  select: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z"/>',
  save: '<path d="m5 12 4 4L20 5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  attachment: '<path d="m8 12 6-6a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L12 4m-6 12 9-9"/>',
  note: '<path d="M4 3h12l4 4v14H4zM15 3v5h5M8 12h8M8 16h6"/>',
  cite: '<path d="M4 6h6v7H7c0 3-1 5-3 5M14 6h6v7h-3c0 3-1 5-3 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.2"/>',
  settings: '<path d="m9 3-.5 3-2 1-3-.5-1 3 2.5 2v2l-2.5 2 1 3 3-.5 2 1 .5 3h6l.5-3 2-1 3 .5 1-3-2.5-2v-2l2.5-2-1-3-3 .5-2-1-.5-3z"/><circle cx="12" cy="12" r="3"/>',
  jobs: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
};
export function icon(name) {
  const document = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon" aria-hidden="true">' + paths[name] + '</svg>',
    'image/svg+xml',
  );
  return window.document.importNode(document.documentElement, true);
}
export function iconButton(button, name, label) {
  button.replaceChildren(icon(name));
  button.classList.add('icon-only');
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
}
