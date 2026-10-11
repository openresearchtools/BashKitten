/* SPDX-License-Identifier: AGPL-3.0-only */
import { node, field, check, button, confirm, runStatus } from './ui.mjs';

/** Presentation only. The native owner resolves every saved connection/service. */
export async function renderSection({ root, call, subscribe, info, signal }) {
  const active = () => !signal.aborted && root.isConnected;
  const run = runStatus(root, signal), cards = new Map();
  let snapshot, refreshing = false;
  const intro = node(root, 'p', 'Connect with the encrypted connection QR from the host’s Share Local setup.');
  const local = node(root, 'section'), saved = node(root, 'div'), enrollment = node(root, 'details');
  local.className = 'connection-card'; enrollment.className = 'connection-card';
  enrollment.open = !!info.connectOnly;
  enrollment.append(node(root, 'summary', 'Connect to remote'));
  const action = (parent, title, work) => button(parent, title, () => run(work));
  local.append(node(root, 'h2', 'Local'));
  const localDescription = node(root, 'p'); local.append(localDescription);
  action(local, 'Open Agent', () => call('remotes.connect', { id: 'local' }));
  action(local, 'Share Local', () => call('remotes.share-local', {}));
  root.append(intro, local, saved, enrollment);
  const enroll = method => async () => {
    await call('remotes.enroll', { method });
    if (active()) await refresh();
  };
  const scan = action(enrollment, 'Scan QR', enroll('scan'));
  action(enrollment, 'Upload QR image', enroll('image'));
  enrollment.append(node(root, 'p', 'Use the host’s connection password when prompted, then sign in on its Authelia page.'));

  const showServices = (body, id, result) => {
    if (!active() || !body.isConnected) return;
    body.replaceChildren();
    for (const service of result.services || []) {
      const card = node(root, 'section'); card.className = 'connection-card';
      const choice = service.choice || {};
      card.append(node(root, 'h3', service.name), node(root, 'p', `${service.state} · ${service.reachable ? 'Target reachable' : 'Target unavailable'}`));
      if (service.error) card.append(node(root, 'p', service.error));
      const update = result => showServices(body, id, result);
      if (service.id === 'agent') {
        action(card, 'Open Agent', () => call('remotes.open-service', { id, serviceId: service.id }));
        body.append(card); continue;
      }
      for (const command of service.actions || []) {
        if (!['start', 'stop', 'reload'].includes(command)) continue;
        const title = command === 'start' ? 'Start' : command === 'stop' ? 'Stop' : 'Reload';
        action(card, `${title} on host`, async () => {
          if (command !== 'start' && !await confirm(root, { title: `${title} on host?`, message: `This affects every client of “${service.name}”. Active streams will end.` }, signal)) return;
          update(await call('remotes.service-action', { id, serviceId: service.id, action: command }));
        });
      }
      const form = node(root, 'form'); form.onsubmit = event => event.preventDefault();
      const enabled = check(form, 'Local access', choice.enabled === true);
      const port = field(form, 'Port (blank for Automatic)', choice.port || '', { type: 'number', min: 1, max: 65535, placeholder: 'Automatic' });
      let imported;
      if (service.kind === 'llama') {
        imported = check(form, 'Import this configuration into the coding agent', choice.importToPi === true);
        action(form, 'Add to Pi', async () => { imported.checked = true; imported.focus(); });
        const key = action(form, choice.hasKey ? 'Change service API key…' : 'Set service API key…', async () => {
          const result = await call('remotes.service-key', { id, serviceId: service.id });
          const saved = result?.services?.find(value => value.id === service.id);
          if (active() && key.isConnected && saved) key.textContent = saved.choice?.hasKey ? 'Change service API key…' : 'Set service API key…';
        });
        const importState = service.importState || choice.importState;
        if (importState) form.append(node(root, 'p', importState));
      }
      action(form, 'Save changes', async () => {
        if (!form.reportValidity()) return;
        update(await call('remotes.save-mapping', { id, serviceId: service.id, enabled: enabled.checked, port: port.value === '' ? 0 : Number(port.value), importToPi: imported?.checked === true }));
      });
      card.append(form);
      if (choice.error || service.mappingError || service.mapping?.error) card.append(node(root, 'p', choice.error || service.mappingError || service.mapping.error));
      if (service.url) {
        card.append(node(root, 'code', service.url));
        action(card, 'Open', () => call('remotes.open-service', { id, serviceId: service.id }));
        action(card, 'Copy URL', () => call('remotes.copy-service', { id, serviceId: service.id }));
        if (service.kind === 'llama') card.append(node(root, 'p', new URL('/v1', service.url).href));
      }
      body.append(card);
    }
    action(body, 'Refresh services', async () => showServices(body, id, await call('remotes.services', { id })));
  };

  const createCard = record => {
    const card = node(root, 'section'); card.className = 'connection-card';
    const title = node(root, 'h2'), status = node(root, 'p'), address = node(root, 'p'), error = node(root, 'p');
    status.setAttribute('role', 'status'); error.setAttribute('role', 'alert');
    card.append(title, address, status, error);
    const connect = action(card, 'Connect', () => call('remotes.connect', { id: record.id }));
    const disconnect = action(card, 'Disconnect', async () => { await call('remotes.disconnect', { id: record.id }); await refresh(); });
    const serviceDetails = node(root, 'details'), serviceBody = node(root, 'div');
    serviceDetails.append(node(root, 'summary', 'Services'), serviceBody); card.append(serviceDetails);
    serviceDetails.ontoggle = () => {
      if (serviceDetails.open && !serviceBody.childElementCount) void run(async () => showServices(serviceBody, record.id, await call('remotes.services', { id: record.id })));
    };
    const editing = node(root, 'details'); editing.append(node(root, 'summary', 'Connection settings'));
    const name = field(editing, 'Name', record.name);
    action(editing, 'Save name', async () => { await call('remotes.rename', { id: record.id, name: name.value }); await refresh(); });
    if (snapshot.capabilities?.browserControl) {
      action(editing, 'Allow browser control', () => call('remotes.allow-browser', { id: record.id }));
      action(editing, 'Revoke browser control', () => call('remotes.revoke-browser', { id: record.id }));
    }
    action(editing, 'Remove connection', async () => {
      if (!await confirm(root, { title: `Remove ${record.name}?`, message: 'Close this device’s connection and forget its saved keys and sign-in session.' }, signal)) return;
      await call('remotes.remove', { id: record.id }); await refresh();
    });
    card.append(editing);
    return { card, update(value) {
      Object.assign(record, value);
      title.textContent = record.name; address.textContent = record.url || ''; address.hidden = !record.url;
      status.textContent = record.migrationRequired ? 'Import a new encrypted QR from this host’s Share Local setup.' : record.state;
      error.textContent = record.error || '';
      connect.hidden = record.migrationRequired; disconnect.hidden = record.migrationRequired;
      serviceDetails.hidden = record.state !== 'ready';
      if (serviceDetails.hidden) { serviceDetails.open = false; serviceBody.replaceChildren(); }
    } };
  };
  async function refresh() {
    if (refreshing || !active()) return;
    refreshing = true;
    try {
      const result = await call('remotes.list', {});
      if (!active()) return;
      snapshot = result; localDescription.textContent = result.localLabel || 'This device';
      scan.hidden = result.capabilities?.scan === false;
      const present = new Set();
      for (const value of result.remotes || []) {
        present.add(value.id);
        let record = cards.get(value.id);
        if (!record) { record = createCard({ ...value }); cards.set(value.id, record); saved.append(record.card); }
        record.update(value);
      }
      for (const [id, record] of cards) if (!present.has(id)) { record.card.remove(); cards.delete(id); }
    } finally { refreshing = false; }
  }
  action(root, 'Refresh connections', refresh);
  const unsubscribe = subscribe('remotes.changed', () => { if (active()) void run(refresh); });
  if (typeof unsubscribe === 'function') signal.addEventListener('abort', unsubscribe, { once: true });
  await run(refresh);
}
