// SPDX-License-Identifier: AGPL-3.0-only
// One mounted Projects pane and one mounted Details pane serve both layouts.
export function createSidecars({
  app, header, main, projects, details, projectsToggle, detailsToggle,
  projectsClose, detailsClose, backdrop, onLayout = () => {},
}) {
  const document = app.ownerDocument, window = document.defaultView;
  const footer = app.querySelector('.app-status');
  const media = window.matchMedia('(max-width: 768px)');
  const panels = { projects, details }, toggles = { projects: projectsToggle, details: detailsToggle };
  const closes = { projects: projectsClose, details: detailsClose };
  const wide = { projects: true, details: true };
  let narrow = media.matches, active = null, returnFocus = null, destroyed = false;
  const attributes = new Map(), properties = new Map();
  function rememberAttribute(element, name) {
    let saved = attributes.get(element);
    if (!saved) attributes.set(element, saved = new Map());
    if (!saved.has(name)) saved.set(name, element.getAttribute(name));
  }
  function attribute(element, name, value) {
    rememberAttribute(element, name);
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
  function property(element, name, value) {
    let saved = properties.get(element);
    if (!saved) properties.set(element, saved = new Map());
    if (!saved.has(name)) saved.set(name, element[name]);
    element[name] = value;
  }
  for (const name of ['sidecar-layout', 'projects-open', 'details-open'])
    rememberAttribute(app, 'data-' + name);
  for (const kind of Object.keys(panels)) {
    const panel = panels[kind];
    if (!panel.id) attribute(panel, 'id', 'references-' + kind + '-sidecar');
    attribute(toggles[kind], 'aria-controls', panel.id);
    rememberAttribute(panel, 'role');
    rememberAttribute(panel, 'aria-modal');
    rememberAttribute(panel, 'tabindex');
  }
  const original = (element, name) => attributes.get(element).get(name);
  const focusableSelector = 'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]';
  const canFocus = element => element?.isConnected && !element.disabled &&
    !element.closest('[hidden],[inert]') && element.getClientRects().length > 0;
  const focusables = panel => [...panel.querySelectorAll(focusableSelector)]
    .filter(element => element.tabIndex >= 0 && canFocus(element));
  function render() {
    if (destroyed) return;
    app.dataset.sidecarLayout = narrow ? 'overlay' : 'fixed';
    for (const kind of Object.keys(panels)) {
      const panel = panels[kind], open = narrow ? active === kind : wide[kind];
      app.dataset[kind + 'Open'] = String(open);
      property(panel, 'hidden', !open);
      property(closes[kind], 'hidden', !narrow || !open);
      attribute(toggles[kind], 'aria-expanded', String(open));
      attribute(panel, 'role', narrow && open ? 'dialog' : original(panel, 'role'));
      attribute(panel, 'aria-modal', narrow && open ? 'true' : original(panel, 'aria-modal'));
      attribute(panel, 'tabindex', narrow && open ? '-1' : original(panel, 'tabindex'));
    }
    property(header, 'inert', narrow && active !== null);
    property(main, 'inert', narrow && active !== null);
    if (footer) property(footer, 'inert', narrow && active !== null);
    property(backdrop, 'hidden', !narrow || active === null);
    onLayout();
  }
  function restoreFocus(kind, target = returnFocus) {
    if (canFocus(target) && (target.tabIndex >= 0 || target.hasAttribute('tabindex') || target.isContentEditable))
      target.focus({ preventScroll: true });
    else if (canFocus(toggles[kind])) toggles[kind].focus({ preventScroll: true });
  }
  function refreshMode() {
    if (destroyed || narrow === media.matches) return;
    const focused = document.activeElement;
    const focusedKind = Object.keys(panels).find(kind => panels[kind].contains(focused));
    narrow = media.matches;
    active = null;
    returnFocus = null;
    render();
    if (focusedKind && !canFocus(focused)) restoreFocus(focusedKind, toggles[focusedKind]);
  }
  function close() {
    refreshMode();
    if (!narrow || active === null) return;
    const previous = active;
    active = null;
    render();
    restoreFocus(previous);
    returnFocus = null;
  }
  function show(kind) {
    refreshMode();
    if (destroyed || !Object.hasOwn(panels, kind)) return;
    if (!narrow) {
      wide[kind] = true;
      render();
      return;
    }
    if (active === kind) return;
    if (active === null) returnFocus = document.activeElement;
    active = kind;
    render();
    const panel = panels[kind];
    (focusables(panel)[0] || panel).focus({ preventScroll: true });
  }
  function toggle(kind) {
    refreshMode();
    if (narrow) {
      if (active === kind) close();
      else show(kind);
    } else {
      wide[kind] = !wide[kind];
      render();
    }
  }
  const listeners = [];
  function listen(element, event, callback) {
    element.addEventListener(event, callback);
    listeners.push(() => element.removeEventListener(event, callback));
  }
  for (const kind of Object.keys(panels)) {
    listen(toggles[kind], 'click', () => toggle(kind));
    listen(closes[kind], 'click', close);
  }
  listen(backdrop, 'click', close);
  listen(document, 'keydown', event => {
    refreshMode();
    if (!narrow || active === null || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      const panel = panels[active], choices = focusables(panel);
      if (!choices.length) {
        event.preventDefault(); panel.focus({ preventScroll: true });
        return;
      }
      const index = choices.indexOf(document.activeElement);
      if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === choices.length - 1) {
        event.preventDefault();
        choices[event.shiftKey ? choices.length - 1 : 0].focus({ preventScroll: true });
      }
    }
  });
  listen(media, 'change', refreshMode);
  render();
  return {
    show,
    showMain: close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const remove of listeners) remove();
      for (const [element, saved] of properties)
        for (const [name, value] of saved) element[name] = value;
      for (const [element, saved] of attributes)
        for (const [name, value] of saved)
          if (value === null) element.removeAttribute(name);
          else element.setAttribute(name, value);
    },
  };
}
