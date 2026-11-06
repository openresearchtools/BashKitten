/* SPDX-License-Identifier: AGPL-3.0-only */
import { node, field, check, select, button, runStatus, confirm } from './ui.mjs';

/** Presentation only. All host operations use this view's bound private owner. */
export async function renderSection({ root, call, info, signal }) {
  root.append(node(root, 'p', 'Share this Local Agent. Each connection uses its own account, authenticator and encrypted connection image.'));
  let instance = 'tor';
  const transport = select(root, 'Connection', [['tor', 'Tor'], ['cloudflare', 'Cloudflare Quick Tunnel'], ['tailcat', 'Tailcat instant'], ['tailscale', 'Tailscale']], instance);
  const shareCall = (name, value = {}) => call(name, { ...value, instance });
  const body = node(root, 'div'); root.append(body);
  const status = runStatus(root, signal), secrets = new Set();
  const run = operation => status(async () => {
    transport.disabled = true;
    try { return await operation(); } finally { if (current()) transport.disabled = Boolean(setupId); }
  });
  const current = () => !signal.aborted && root.isConnected;
  const action = (parent, title, operation) => button(parent, title, () => run(operation));
  let setupId = '', serviceState;
  function clearSecrets() { for (const input of secrets) input.value = ''; secrets.clear(); }
  signal.addEventListener('abort', () => { clearSecrets(); body.replaceChildren(); }, { once: true });
  function clear() { clearSecrets(); body.replaceChildren(); }
  function qr(parent, url, title) {
    if (!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(url || '')) throw Error('The controller did not supply a valid QR image.');
    const image = node(parent, 'img'); image.src = url; image.alt = title;
    image.style.maxWidth = '100%'; image.style.width = '280px'; image.style.height = 'auto'; parent.append(image);
    return image;
  }
  const load = async () => draw(await shareCall('share-status'));
  transport.onchange = () => {
    const selected = transport.value; transport.value = instance;
    void run(async () => { instance = selected; transport.value = selected; await load(); });
  };
  async function cancelSetup() {
    if (setupId) { const id = setupId; await shareCall('share-cancel', { setupId: id }); setupId = ''; }
    await load();
  }
  function draw(state) {
    if (!current()) return;
    const previousSetup = setupId; setupId = ''; clear();
    if (state.needsSetup) {
      body.append(node(body, 'p', 'Set up Local on this device before sharing it. Your saved remote connections are kept.'));
      action(body, 'Set up Local', () => call('share-local-setup')); return;
    }
    if (state.error) { const error = node(body, 'p', state.error); error.setAttribute('role', 'alert'); body.append(error); }
    if (state.loginUrl) {
      body.append(node(body, 'p', 'Authorize this connection with Tailscale, then continue.'));
      action(body, 'Open Tailscale sign-in', () => shareCall('share-open-transport-login'));
      action(body, 'Refresh', load);
    }
    if (state.awaitingNetwork) {
      if (!state.loginUrl) body.append(node(body, 'p', state.transportState === 'approval' ? 'Approve this device in Tailscale, then continue.' : 'Waiting for the connection. Continue to check its status.'));
      setupId = state.setupId || previousSetup; transport.disabled = Boolean(setupId);
      action(body, 'Continue', async () => draw(await shareCall('share-confirm', { setupId })));
      action(body, 'Cancel', cancelSetup); return;
    }
    if (state.reissueRequired) { action(body, 'Reissue identity', () => account(true)); return; }
    if (state.phase !== 'ready') {
      if (state.migrationRequired) body.append(node(body, 'p', 'Replace the previous remote identity to use encrypted connections. Old connection exports will stop working.'));
      action(body, state.migrationRequired ? 'Reissue identity' : 'Turn on', () => account(Boolean(state.migrationRequired))); return;
    }
    body.append(node(body, 'p', state.running ? 'Publishing is on' : state.error ? 'Publishing failed' : state.enabled ? 'Publishing is waiting for the connection' : 'Publishing is off'));
    action(body, state.enabled ? 'Turn off' : 'Turn on', async () => draw(await shareCall('share-publish', { enabled: !state.enabled })));
    const startup = check(body, 'Start publishing automatically', state.startup === true);
    startup.onchange = () => {
      const enabled = startup.checked; startup.checked = state.startup === true;
      void run(async () => draw(await shareCall('share-startup', { enabled })));
    };
    const files = check(body, 'Allow remote file manager', Boolean(state.allowFileManager));
    files.onchange = () => { const allowed = files.checked; files.checked = Boolean(state.allowFileManager); void run(async () => draw(await shareCall('share-files', { allowed }))); };
    body.append(node(body, 'p', state.address || ''), node(body, 'p', 'Connection QR — encrypted with your account password.'));
    if (state.qrRefreshRequired) {
      if (!['ready', 'running'].includes(state.transportState)) {
        body.append(node(body, 'p', 'Turn on this connection before updating its encrypted image.'));
      } else {
        body.append(node(body, 'p', 'The connection address changed. Enter this account’s password to update its encrypted image.'));
        const password = field(body, 'Password', '', { type: 'password', autocomplete: 'current-password', required: '' }); secrets.add(password);
        action(body, 'Update connection image', async () => {
          if (!password.reportValidity()) return;
          const request = shareCall('share-export', { password: password.value }); password.value = ''; draw(await request);
        });
      }
    } else if (state.qrDataUrl) {
      const image = qr(body, state.qrDataUrl, 'Encrypted connection QR');
      image.onclick = () => void run(() => shareCall('share-save-qr'));
      action(body, 'Download QR image', () => shareCall('share-save-qr'));
    }
    action(body, 'Services', loadServices);
    action(body, 'Reissue identity', () => account(true));
    action(body, 'Refresh', load);
  }
  async function account(reissue) {
    if (reissue && !await confirm(root, { title: 'Reissue identity?', message: 'Disconnect all old clients and replace the remote account, authenticator and connection keys? Local chats and provider logins are kept.' }, signal)) return;
    if (!current()) return;
    clear();
    const form = node(body, 'form'); body.append(form); form.autocomplete = 'off';
    const username = field(form, 'Username', '', { required: '', autocomplete: 'off' });
    const password = field(form, 'Password', '', { type: 'password', required: '', autocomplete: 'new-password' });
    const repeated = field(form, 'Confirm password', '', { type: 'password', required: '', autocomplete: 'new-password' });
    secrets.add(password); secrets.add(repeated);
    const allow = check(form, 'Allow remote file manager', false);
    const submit = async () => {
      if (!form.reportValidity()) return;
      if (password.value !== repeated.value) throw Error('The passwords do not match.');
      const input = { username: username.value.trim(), password: password.value, allowFileManager: allow.checked };
      const request = shareCall(reissue ? 'share-reissue' : 'share-setup', input);
      password.value = repeated.value = '';
      const value = await request;
      if (!current()) return; // Native owner cancels late/abandoned setup results.
      factor(value);
    };
    action(form, 'Set up authenticator', submit);
    action(form, 'Cancel', load);
    form.onsubmit = event => { event.preventDefault(); void run(submit); };
    username.focus();
  }
  function factor(value) {
    if (value.awaitingNetwork) { draw(value); return; }
    clear(); setupId = value.setupId; transport.disabled = true;
    if (!setupId) throw Error('The controller did not return an authenticator setup.');
    body.append(node(body, 'p', 'Add this account to your authenticator, then enter its six-digit code.'));
    qr(body, value.qrDataUrl, 'Authenticator setup QR');
    if (value.otpauthUrl?.startsWith('otpauth://totp/')) action(body, 'Open authenticator', () => shareCall('share-open-authenticator', { setupId }));
    const form = node(body, 'form'); body.append(form);
    const code = field(form, 'Authenticator code', '', { required: '', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: 6, autocomplete: 'one-time-code' });
    secrets.add(code);
    const verify = async () => {
      if (!form.reportValidity()) return;
      const request = shareCall('share-confirm', { setupId, code: code.value }); code.value = '';
      draw(await request);
    };
    action(form, 'Verify and publish', verify); action(form, 'Cancel', cancelSetup);
    form.onsubmit = event => { event.preventDefault(); void run(verify); }; code.focus();
  }
  const loadServices = async () => services(await call('service-status'));
  function services(value) {
    if (!current()) return;
    clear(); serviceState = value;
    action(body, 'Back to Share Local', load);
    const llama = (value.services || []).find(service => service.id === 'localai-llama');
    const share = check(body, 'Share llama.cpp', Boolean(llama?.enabled));
    share.onchange = () => { const enabled = share.checked; share.checked = Boolean(llama?.enabled); void run(async () => { await call('localai-share', { enabled }); await loadServices(); }); };
    body.append(node(body, 'p', 'Configure the local router, models and runtime in LocalAI.'));
    if (info.local || info.backendKind === 'machine') action(body, 'Open LocalAI', () => call('share-open-localai'));
    for (const service of value.services || []) {
      const card = node(body, 'section'); card.className = 'connection-card'; body.append(card);
      card.append(node(card, 'h2', service.name), node(card, 'p', `${service.state} · ${service.reachable ? 'Target reachable' : 'Target unavailable'}`));
      if (service.error) card.append(node(card, 'p', service.error));
      if (service.savedForNextStart) card.append(node(card, 'p', 'Saved command applies on Reload.'));
      for (const operation of service.actions || []) {
        if (!['start', 'stop', 'reload'].includes(operation)) continue;
        action(card, { start: 'Start', stop: 'Stop', reload: 'Reload' }[operation], async () => {
          if (operation === 'reload' && !await confirm(root, { title: 'Reload service?', message: 'Restart with the saved command? Active streams will end.' }, signal)) return;
          services(await call('service-action', { id: service.id, action: operation }));
        });
      }
      if (!service.id.startsWith('localai-')) {
        action(card, 'Edit', () => editService(service));
        action(card, 'Remove', async () => {
          if (await confirm(root, { title: 'Remove service?', message: `Stop and remove “${service.name}”? Its files are kept.` }, signal)) services(await call('service-remove', { id: service.id, revision: value.revision }));
        });
      }
      if (service.output) { const output = node(card, 'details'); output.append(node(card, 'summary', 'Output'), node(card, 'pre', service.output)); card.append(output); }
    }
    action(body, 'Add service', () => editService({})); action(body, 'Refresh', loadServices);
  }
  function editService(service) {
    clear(); const form = node(body, 'form'); body.append(form);
    const name = field(form, 'Name', service.name || '', { required: '' });
    const target = field(form, 'Target — loopback address:port or /absolute/socket', service.target?.address || '', { required: '' });
    const scheme = select(form, 'Web scheme', [['http', 'http'], ['https', 'https']], service.scheme || 'http');
    const openPath = field(form, 'Opening path', service.openPath || '/');
    const kind = select(form, 'Type', [['web', 'web'], ['llama', 'llama']], service.kind || 'web');
    const enabled = check(form, 'Available remotely', service.enabled ?? true);
    form.append(node(form, 'p', 'An external service needs no launch command. For Taskarian to start this service, enter its absolute executable and arguments as a JSON array. Shell syntax requires an explicit shell command.'));
    const argv = field(form, 'Launch command (JSON array)', service.command ? JSON.stringify(service.command.argv, null, 2) : '', { multiline: true, rows: 4, spellcheck: 'false' });
    const cwd = field(form, 'Working directory', service.command?.cwd || '');
    const env = field(form, 'Environment (JSON object)', JSON.stringify(service.command?.env || {}, null, 2), { multiline: true, rows: 4, spellcheck: 'false' });
    const startup = check(form, 'Launch on startup', Boolean(service.startup));
    const save = async () => {
      if (!form.reportValidity()) return;
      const value = { name: name.value, target: { network: target.value.startsWith('/') ? 'unix' : 'tcp', address: target.value }, scheme: scheme.value,
        openPath: openPath.value, kind: kind.value, enabled: enabled.checked, startup: startup.checked, command: null };
      if (service.id) value.id = service.id;
      if (argv.value.trim()) {
        let args, environment;
        try { args = JSON.parse(argv.value); environment = JSON.parse(env.value); } catch { throw Error('Use a JSON array for the command and a JSON object for its environment.'); }
        if (!Array.isArray(args) || !environment || Array.isArray(environment) || typeof environment !== 'object') throw Error('Use a JSON array for the command and a JSON object for its environment.');
        value.command = { argv: args, cwd: cwd.value, env: environment };
      }
      services(await call('service-save', { service: value, revision: serviceState.revision }));
    };
    action(form, 'Save changes', save); action(form, 'Cancel', () => services(serviceState));
    form.onsubmit = event => { event.preventDefault(); void run(save); }; name.focus();
  }
  action(body, 'Retry', load);
  await run(load);
}
