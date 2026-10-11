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
