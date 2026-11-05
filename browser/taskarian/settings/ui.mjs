/* SPDX-License-Identifier: AGPL-3.0-only */
export function node(root, tag, text = '') {
  const element = root.ownerDocument.createElement(tag);
  element.textContent = text;
  return element;
}
export function field(root, title, value = '', { multiline = false, type = 'text', ...attributes } = {}) {
  const label = node(root, 'label', title), input = node(root, multiline ? 'textarea' : 'input');
  if (!multiline) input.type = type;
  input.value = value;
  for (const [key, setting] of Object.entries(attributes)) input.setAttribute(key, String(setting));
  label.append(input); root.append(label); return input;
}
export function check(root, title, checked) {
  const label = node(root, 'label', title), input = node(root, 'input');
  input.type = 'checkbox'; input.checked = checked;
  label.prepend(input); root.append(label); return input;
}
export function select(root, title, choices, value) {
  const label = node(root, 'label', title), input = node(root, 'select');
  for (const [id, title] of choices) { const option = node(root, 'option', title); option.value = id; input.append(option); }
  input.value = value; label.append(input); root.append(label); return input;
}
let modelPickerId = 0;
/** A bounded, keyboard-accessible select with visible download state per option. */
export function modelSelect(root, title, { choices = [], value = '', onSelect, signal } = {}) {
  const doc = root.ownerDocument, win = doc.defaultView, events = new win.AbortController();
  const host = node(root, 'div'); host.className = 'model-picker';
  const id = `model-picker-${++modelPickerId}`, label = node(root, 'span', title); label.id = `${id}-label`; label.className = 'model-picker-label';
  const trigger = node(root, 'button'); trigger.type = 'button'; trigger.id = id;
  trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-labelledby', `${label.id} ${id}-value ${id}-status`);
  const list = node(root, 'div'); list.id = `${id}-list`; list.className = 'model-picker-options'; list.hidden = true;
  const nativePopover = typeof list.showPopover === 'function'; if (nativePopover) list.setAttribute('popover', 'manual');
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-labelledby', label.id); trigger.setAttribute('aria-controls', list.id);
  host.append(label, trigger, list); root.append(host);
  let items = [], selected = value, cursor = -1, typed = '', typedAt = 0, choicesRevision, titleRevision;
  const badge = choice => {
    const text = choice.status === 'custom' ? '[custom]' : choice.downloaded ? '[downloaded]' : choice.status === 'downloading' ? '[downloading]' : '[download]';
    const result = node(root, 'span', text); result.className = `model-status ${choice.downloaded ? 'downloaded' : 'download'}`; return result;
  };
  const titleNodes = choice => [node(root, 'span', choice?.title || 'Choose a model'), ...(choice ? [badge(choice)] : [])];
  const close = () => {
    if (nativePopover && list.matches(':popover-open')) list.hidePopover();
    list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-activedescendant');
  };
  const place = () => {
    if (list.hidden) return;
    const rect = trigger.getBoundingClientRect(), viewport = win.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || win.innerWidth, height = viewport?.height || win.innerHeight, edge = 8, gap = 4;
    if (rect.bottom <= top || rect.top >= top + height) { close(); return; }
    const below = Math.max(0, top + height - edge - rect.bottom - gap), above = Math.max(0, rect.top - top - edge - gap);
    const ideal = Math.min(352, height * .45), upwards = below < ideal && above > below;
    const limit = Math.max(0, Math.min(ideal, upwards ? above : below));
    list.style.width = `${Math.min(rect.width, Math.max(0, width - edge * 2))}px`;
    list.style.maxHeight = `${limit}px`;
    list.style.left = `${Math.max(left + edge, Math.min(rect.left, left + width - edge - Math.min(rect.width, width - edge * 2)))}px`;
    const measuredHeight = Math.min(limit, list.getBoundingClientRect().height);
    list.style.top = `${upwards ? rect.top - gap - measuredHeight : rect.bottom + gap}px`;
  };
  const paintCursor = (reveal = true) => {
    [...list.children].forEach((option, index) => { option.dataset.active = String(index === cursor); });
    const option = list.children[cursor];
    if (option) {
      if (trigger.getAttribute('aria-activedescendant') !== option.id) trigger.setAttribute('aria-activedescendant', option.id);
      const top = option.offsetTop, bottom = top + option.offsetHeight;
      if (reveal && top < list.scrollTop) list.scrollTop = top;
      else if (reveal && bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    } else trigger.removeAttribute('aria-activedescendant');
  };
  const open = () => {
    if (trigger.disabled || !items.length) return;
    list.hidden = false; if (nativePopover) list.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    place(); cursor = Math.max(0, items.findIndex(choice => choice.id === selected)); paintCursor();
  };
  const choose = index => {
    const choice = items[index]; if (!choice || choice.disabled || trigger.disabled) return;
    close(); trigger.focus({ preventScroll: true }); void onSelect?.(choice.id);
  };
  const update = ({ choices: next = items, value: nextValue = selected, disabled = trigger.disabled } = {}) => {
    const wasOpen = !list.hidden, cursorId = items[cursor]?.id, scrollTop = list.scrollTop;
    items = next; selected = nextValue; trigger.disabled = disabled;
    const choice = items.find(choice => choice.id === selected), heading = JSON.stringify(choice);
    if (heading !== titleRevision) {
      const nodes = titleNodes(choice); nodes[0].id = `${id}-value`; if (nodes[1]) nodes[1].id = `${id}-status`;
      trigger.replaceChildren(...nodes, node(root, 'span', '▾')); titleRevision = heading;
    }
    const revision = JSON.stringify(items);
    if (revision !== choicesRevision) {
      list.replaceChildren(...items.map((item, index) => {
        const option = node(root, 'div'); option.id = `${id}-${index}`; option.className = 'model-picker-option';
        option.setAttribute('role', 'option'); if (item.disabled) option.setAttribute('aria-disabled', 'true');
        option.append(...titleNodes(item));
        if (item.detail) { const detail = node(root, 'small', item.detail); detail.className = 'model-picker-detail'; option.append(detail); }
        option.onpointerdown = event => event.preventDefault(); option.onclick = () => choose(index);
        return option;
      })); choicesRevision = revision;
    }
    [...list.children].forEach((option, index) => {
      const value = String(items[index].id === selected);
      if (option.getAttribute('aria-selected') !== value) option.setAttribute('aria-selected', value);
    });
    if (wasOpen && !disabled) { cursor = Math.max(0, items.findIndex(item => item.id === cursorId)); place(); paintCursor(false); list.scrollTop = scrollTop; }
    else close();
  };
  trigger.onclick = () => list.hidden ? open() : close();
  trigger.onkeydown = event => {
    if (event.key === 'Escape') { close(); event.preventDefault(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) { open(); if (!['Home', 'End'].includes(event.key)) return; }
      cursor = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, cursor + (event.key === 'ArrowDown' ? 1 : -1))); paintCursor();
    } else if (['Enter', ' '].includes(event.key)) {
      event.preventDefault(); if (list.hidden) open(); else choose(cursor);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault(); const now = Date.now(); typed = (now - typedAt < 700 ? typed : '') + event.key.toLocaleLowerCase(); typedAt = now;
      if (list.hidden) open();
      const index = items.findIndex(item => item.title.toLocaleLowerCase().startsWith(typed)); if (index >= 0) { cursor = index; paintCursor(); }
    }
  };
  const settings = { signal: events.signal };
  host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget)) close(); }, settings);
  doc.addEventListener('pointerdown', event => { if (!host.contains(event.target)) close(); }, settings);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) close(); }, settings);
  win.addEventListener('resize', place, settings);
  win.addEventListener('scroll', event => { if (event.target !== list) place(); }, { ...settings, capture: true });
  win.visualViewport?.addEventListener('resize', place, settings); win.visualViewport?.addEventListener('scroll', place, settings);
  const dispose = () => { close(); events.abort(); observer.disconnect(); signal?.removeEventListener('abort', dispose); };
  const observer = new win.MutationObserver(() => { if (!host.isConnected) dispose(); });
  observer.observe(doc.documentElement, { childList: true, subtree: true }); signal?.addEventListener('abort', dispose, { once: true });
  update({ choices, value });
  return { element: host, trigger, update };
}
export function downloadProgress({ downloaded = 0, total, bytesPerSecond } = {}) {
  const amount = Math.max(0, Number(downloaded) || 0), size = Number(total), speed = Number(bytesPerSecond);
  const known = Number.isFinite(size) && size > 0;
  const unit = (known ? size : amount) >= 1e9 ? 'GB' : 'MB', divisor = unit === 'GB' ? 1e9 : 1e6;
  const rate = Number.isFinite(speed) && speed >= 0 ? `${(speed / 1e6).toFixed(2)} MB/s` : 'measuring speed…';
  return `${(amount / divisor).toFixed(2)} / ${known ? (size / divisor).toFixed(2) : '?'} ${unit} · ${known ? `${Math.min(100, amount / size * 100).toFixed(1)}%` : 'size pending'} · ${rate}`;
}
export function button(root, title, action) {
  const element = node(root, 'button', title); element.type = 'button'; element.onclick = action;
  root.append(element); return element;
}
export function runStatus(root, signal) {
  const status = node(root, 'p'); status.setAttribute('role', 'status'); root.append(status);
  let busy = false;
  return async action => {
    if (busy || signal.aborted || !root.isConnected) return;
    busy = true; status.textContent = '';
    const controls = [...root.querySelectorAll('button')].map(element => [element, element.disabled]);
    for (const [element] of controls) element.disabled = true;
    try { return await action(); }
    catch (error) { if (!signal.aborted && root.isConnected) status.textContent = error.message; }
    finally { busy = false; for (const [element, disabled] of controls) if (element.isConnected) element.disabled = disabled; }
  };
}
export function confirm(root, { title, message }, signal) {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const dialog = node(root, 'dialog'), heading = node(root, 'h2', title), body = node(root, 'p', message);
    const actions = node(root, 'div'); actions.className = 'actions';
    let settled = false;
    const observer = new root.ownerDocument.defaultView.MutationObserver(() => { if (!dialog.isConnected) finish(false); });
    const finish = value => {
      if (settled) return;
      settled = true; observer.disconnect(); signal.removeEventListener('abort', cancel); dialog.remove(); resolve(value);
    };
    const cancel = () => finish(false);
    const no = button(actions, 'Cancel', cancel);
    button(actions, 'Continue', () => finish(true));
    dialog.append(heading, body, actions); root.append(dialog);
    observer.observe(root, { childList: true, subtree: true });
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    signal.addEventListener('abort', cancel, { once: true });
    dialog.showModal(); no.focus();
  });
}
