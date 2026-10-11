/* SPDX-License-Identifier: AGPL-3.0-only */
import { node, field, check, button, runStatus } from './ui.mjs';

export const DISPLAY_PROMPT = 'Use the termux-display skill to set up XFCE for this device and save a working launch command, using supported GPU acceleration if available.';

export async function renderSection({ root, call, signal }) {
  root.append(node(root, 'p', 'Run desktop apps in the native Display tab. Closing the tab keeps your desktop apps running.'));
  const body = node(root, 'div'); root.append(body);
  const run = runStatus(root, signal);
  const action = (parent, title, operation) => button(parent, title, () => run(operation));
  const current = () => !signal.aborted && root.isConnected;
  let value;
  const load = async () => draw(await call('display-status'));
  function draw(result) {
    if (!current()) return;
    value = result; body.replaceChildren();
    if (value.needsSetup) { action(body, 'Set up Local', () => call('display-setup')); return; }
    const status = node(body, 'p', `Display · ${value.state || 'unavailable'}`); status.setAttribute('role', 'status'); body.append(status);
    const startup = check(body, 'Start with BashKitten', !!value.startup);
    startup.onchange = () => run(async () => draw(await call('display-save', { startup: startup.checked })));
    for (const text of [value.launcherNote, value.error]) if (text) body.append(node(body, 'p', text));
    body.append(node(body, 'pre', value.command || ''));
    action(body, 'Copy', () => call('display-copy', { kind: 'command' }));
    action(body, 'Edit', edit);
    if (value.savedForNextStart) body.append(node(body, 'p', 'Saved for next start'));
    const running = value.state === 'running', stopping = value.state === 'stopping';
    action(body, running || stopping ? 'Stop' : 'Start', async () => draw(await call(running || stopping ? 'display-stop' : 'display-start')));
    if (running) action(body, 'Open Display', () => call('display-open'));
    action(body, 'Refresh', load);
    if (value.output || value.otherDisplaySockets?.length) {
      const output = node(body, 'details'); output.append(node(body, 'summary', 'Output'));
      if (value.output) output.append(node(body, 'pre', value.output));
      if (value.otherDisplaySockets?.length) output.append(node(body, 'p', `Other X display sockets: ${value.otherDisplaySockets.join(', ')}. BashKitten does not manage these displays.`));
      body.append(output);
    }
    body.append(node(body, 'h2', 'Ask your agent'), node(body, 'p', DISPLAY_PROMPT));
    action(body, 'Copy prompt', () => call('display-copy', { kind: 'prompt' }));
  }
  function edit() {
    const revision = value.revision;
    body.replaceChildren();
    const command = field(body, 'Launch command', value.command, { multiline: true, rows: 6, spellcheck: 'false' });
    action(body, 'Save', async () => draw(await call('display-save', { revision, command: command.value, reset: false })));
    action(body, 'Cancel', load);
    action(body, 'Restore default', async () => draw(await call('display-save', { revision, command: '', reset: true })));
    command.focus();
  }
  action(body, 'Retry', load);
  await run(load);
}
