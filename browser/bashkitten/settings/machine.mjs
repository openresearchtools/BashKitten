/* SPDX-License-Identifier: AGPL-3.0-only */
import { node, field, check, select, button, confirm, runStatus } from './ui.mjs';

/** The native enrollment binds every request to one machine, outside the page. */
export async function renderSection({ root, call, info, signal }) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const active = () => !signal.aborted && root.isConnected;
  const run = runStatus(root, signal);
  let state, devices = [], cursor = 0, operationId, timer, reading = false, readEpoch = 0, stateEpoch = 0;
  const status = node(root, 'p'), lifecycle = node(root, 'div'), editor = node(root, 'section');
  status.setAttribute('role', 'status'); editor.className = 'connection-card';
  const operation = node(root, 'details'), progress = node(root, 'p'), output = node(root, 'pre');
  operation.className = 'connection-card'; progress.setAttribute('role', 'status');
  operation.append(node(root, 'summary', 'Installation and operation output'), progress, output);
  root.append(status, lifecycle, editor, operation);
  const busyState = () => ['preparing', 'starting', 'stopping', 'deleting'].includes(state?.machine.state);
  const controls = new Map();
  const availability = () => {
    for (const control of controls.values()) control.disabled = busyState();
    const machine = state?.machine;
    if (!machine) return;
    controls.get('start').hidden = machine.state === 'running';
    controls.get('stop').hidden = machine.state !== 'running';
    controls.get('retry').hidden = !['failed', 'error'].includes(machine.state);
    cancel.disabled = !busyState();
  };
  const action = (parent, title, work) => button(parent, title, async () => { await run(work); if (active()) availability(); });
  const updateStatus = value => {
    state = value;
    status.textContent = [state.machine.state, state.machine.lastError, state.machine.pendingChanges ? 'Saved launch changes will apply at the next restart.' : ''].filter(Boolean).join(' · ');
    availability();
  };
  const refreshStatus = async () => {
    const epoch = ++stateEpoch, next = await call('machines.get', {});
    if (active() && epoch === stateEpoch) updateStatus(next);
    return next;
  };
  const stopReading = () => { win.clearTimeout(timer); timer = null; };
  const schedule = delay => { stopReading(); if (active() && operation.open && !doc.hidden) timer = win.setTimeout(readOutput, delay); };
  const readOutput = async () => {
    if (reading || !active() || !operation.open || doc.hidden) return;
    reading = true;
    const epoch = readEpoch;
    try {
      const result = await call('machines.operation', { cursor });
      if (!active() || !operation.open || doc.hidden || epoch !== readEpoch) return;
      if (operationId !== undefined && result.id !== operationId) {
        cursor = 0; output.replaceChildren(); operationId = result.id; schedule(0); return;
      }
      operationId = result.id;
      const read = result.cursor - cursor; cursor = result.cursor;
      const atEnd = output.scrollTop + output.clientHeight >= output.scrollHeight - 2;
      output.append(doc.createTextNode(result.output || ''));
      if (atEnd) output.scrollTop = output.scrollHeight;
      progress.textContent = result.error || result.phase || result.state;
      cancel.disabled = result.state !== 'running';
      if (read >= 65536 || result.hasMore) schedule(0);
      else if (result.exitCode === null || result.state === 'running') schedule(500);
      else await refreshStatus();
    } catch (error) { if (active()) progress.textContent = error.message; }
    finally { reading = false; if (epoch !== readEpoch) schedule(0); }
  };
  const follow = async result => {
    readEpoch++; cursor = 0; operationId = result?.operation?.id; output.replaceChildren(); progress.textContent = '';
    await refreshStatus();
    if (!active()) return;
    operation.open = true; operation.scrollIntoView({ block: 'nearest' }); schedule(0);
  };
  for (const [name, label] of [['start', 'Start'], ['stop', 'Stop'], ['restart', 'Restart'], ['retry', 'Retry creation']]) {
    controls.set(name, action(lifecycle, label, async () => follow(await call(`machines.${name}`, {}))));
  }
  action(lifecycle, 'Share Local', () => call('machines.share-local', {}));
  action(lifecycle, 'Connect to phone', () => call('machines.connect-phone', {}));
  const cancel = action(operation, 'Cancel operation', async () => { await call('machines.cancel', {}); schedule(0); });
  action(operation, 'Refresh output', async () => { await readOutput(); });
  action(root, 'Delete container', async () => {
    const current = await refreshStatus();
    if (!await confirm(root, { title: `Delete ${current.machine.name}?`, message: 'Permanently delete this container and all files stored in it?' }, signal)) return;
    await call('machines.delete', { confirmName: current.machine.name });
    if (active()) await call('settings-close', {});
  });

  let name, startup, config, containerfile, helperFields, helperError, displayCommand;
  const apply = change => {
    const value = JSON.parse(config.value); change(value); config.value = JSON.stringify(value, null, 2);
    helperError.textContent = '';
  };
  const helpers = () => {
    const value = JSON.parse(config.value); helperFields.replaceChildren();
    const edit = change => event => {
      try { apply(current => change(current, event.target.type === 'checkbox' ? event.target.checked : event.target.value)); }
      catch (error) { helperError.textContent = error.message; }
    };
    const input = (parent, title, value, change, type = 'text') => {
      const control = type === 'checkbox' ? check(parent, title, value) : field(parent, title, value ?? '', { type });
      control.onchange = edit(change); return control;
    };
    const choice = (parent, title, value, choices, change) => {
      const control = select(parent, title, choices, value); control.onchange = edit(change); return control;
    };
    choice(helperFields, 'Display rendering', value.display.mode, [['auto', 'GPU when supported'], ['software', 'CPU']], (v, mode) => { v.display.mode = mode; });
    input(helperFields, 'DRM render node', value.display.renderNode, (v, path) => { v.display.renderNode = path.trim() || null; });
    action(helperFields, 'Use detected render node', async () => {
      const capabilities = await call('machines.display-capabilities', {});
      if (!active()) return;
      apply(v => { v.display.renderNode = capabilities.drmRenderNode || null; }); helpers();
    });
    input(helperFields, 'NVIDIA GPU IDs (all, indexes or UUIDs)', (value.integrations.gpus || []).join(', '), (v, ids) => { v.integrations.gpus = ids.split(/[\s,]+/).filter(Boolean); });
    for (const [index, port] of value.integrations.ports.entries()) {
      const row = node(root, 'fieldset'); row.append(node(root, 'legend', `Port ${index + 1}`));
      const change = (key, numeric = false) => (v, next) => {
        if (!v.integrations.ports[index]) throw Error('Refresh the changed port configuration.');
        v.integrations.ports[index][key] = numeric ? Number(next) : next;
      };
      input(row, 'Enabled', port.enabled, change('enabled'), 'checkbox');
      choice(row, 'Direction', port.direction, [['host-to-guest', 'Host to guest'], ['guest-to-host', 'Guest to host']], change('direction'));
      choice(row, 'Protocol', port.protocol, [['tcp', 'TCP'], ['udp', 'UDP']], change('protocol'));
      input(row, 'Host address', port.hostAddress, change('hostAddress'));
      input(row, 'Host port', port.hostPort, change('hostPort', true), 'number');
      input(row, 'Guest address', port.guestAddress, change('guestAddress'));
      input(row, 'Guest port', port.guestPort, change('guestPort', true), 'number');
      action(row, 'Remove port', async () => { apply(v => v.integrations.ports.splice(index, 1)); helpers(); }); helperFields.append(row);
    }
    action(helperFields, 'Add port', async () => {
      apply(v => v.integrations.ports.push({ enabled: false, protocol: 'tcp', direction: 'host-to-guest', hostAddress: '127.0.0.1', hostPort: 0, guestAddress: '127.0.0.1', guestPort: 0 })); helpers();
    });
    for (const [key, title] of [['guest_audio_output', 'Guest audio output'], ['host_microphone', 'Host microphone'], ['host_camera', 'Host camera']]) {
      const media = value.integrations.media[key], choices = devices.filter(device => device.kind === key).map(device => [device.node, device.description + (device.default ? ' (default)' : '')]);
      if (media.node && !choices.some(([id]) => id === media.node)) choices.unshift([media.node, `${media.node} (unavailable)`]);
      const row = node(root, 'fieldset'); row.append(node(root, 'legend', title));
      input(row, 'Enabled', media.enabled, (v, enabled) => { v.integrations.media[key].enabled = enabled; }, 'checkbox');
      choice(row, 'Device', media.node || '', [['', 'System default'], ...choices], (v, node) => { v.integrations.media[key].node = node || null; });
      const live = (state.media || []).find(item => item.name === key);
      if (live) row.append(node(root, 'small', live.error || (live.running ? 'Running' : 'Stopped')));
      helperFields.append(row);
    }
  };
  const loadDevices = async () => {
    try {
      const result = await call('machines.media-devices', {});
      if (!active()) return;
      devices = result.devices || []; helpers();
    } catch (error) { if (active()) helperError.textContent = error.message; }
  };
  await run(async () => {
    await refreshStatus(); if (!active()) return;
    name = field(editor, 'Container name', state.machine.name);
    startup = check(editor, 'Start at browser startup', state.config.autostart);
    const advanced = node(root, 'details'); advanced.append(node(root, 'summary', 'Launch configuration and Containerfile'));
    config = field(advanced, 'Podman launch command, environment, ports, media and rendering settings', JSON.stringify(state.config, null, 2), { multiline: true, rows: 14 });
    containerfile = field(advanced, 'Containerfile', state.containerfileText, { multiline: true, rows: 12 });
    displayCommand = field(editor, 'Display launch command', state.config.display.command ?? 'exec /usr/bin/xfce4-session', { multiline: true, rows: 3, spellcheck: 'false' });
    displayCommand.oninput = () => { try { apply(value => { value.display.command = displayCommand.value; }); } catch (error) { helperError.textContent = error.message; } };
    editor.append(node(root, 'p', 'Save changes, then turn Display off and on to use this command. Turning Display off closes desktop apps; the container and agent keep running.'));
    const helperSection = node(root, 'details'); helperSection.append(node(root, 'summary', 'Display, ports and media'));
    helperFields = node(root, 'div'); helperError = node(root, 'p'); helperError.setAttribute('role', 'alert'); helperSection.append(helperFields, helperError);
    action(helperSection, 'Refresh devices', loadDevices);
    helperSection.append(node(root, 'p', 'These helpers edit the configuration below. Save changes, then stop/start or restart to apply changed launch settings.'));
    config.onchange = () => { try { displayCommand.value = JSON.parse(config.value).display.command ?? 'exec /usr/bin/xfce4-session'; helpers(); } catch (error) { helperError.textContent = error.message; } };
    editor.append(helperSection, advanced);
    controls.set('save', action(editor, 'Save changes', async () => {
      const value = JSON.parse(config.value); value.name = name.value; value.autostart = startup.checked;
      await call('machines.save', { config: value, containerfileText: containerfile.value });
      const saved = await refreshStatus();
      if (!active()) return;
      config.value = JSON.stringify(saved.config, null, 2); helpers(); status.textContent = `Saved. ${status.textContent}`;
    }));
    helpers(); void loadDevices(); availability();
  });
  operation.ontoggle = () => { if (operation.open) schedule(0); else stopReading(); };
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) stopReading(); else if (operation.open) schedule(0); }, { signal });
  signal.addEventListener('abort', stopReading, { once: true });
  if (active()) {
    availability(); operation.open = !!info.operation; if (operation.open) schedule(0);
    if (info.displayCommand && displayCommand) { displayCommand.scrollIntoView({ block: 'center' }); displayCommand.focus(); }
  }
}
