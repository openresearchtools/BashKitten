/* SPDX-License-Identifier: AGPL-3.0-only */
import { node, field, check, select, button, runStatus, confirm } from './ui.mjs';

const delivery = [['off', 'Off'], ['call-in', 'Only when I call'], ['messages', 'Messages'], ['calls', 'Calls']];
export async function renderSection({ root, call, subscribe, info, signal }) {
  const calling = info.section === 'telephone';
  if (info.platform !== 'android') {
    const status = await call('phone-status'); if (signal.aborted) return;
    const run = runStatus(root, signal);
    root.append(node(root, 'p', `Manage ${calling ? 'calls' : 'messages'} on your connected Android phone.`));
    for (const phone of status.registrations || []) {
      const card = node(root, 'section'); card.className = 'connection-card'; root.append(card);
      card.append(node(root, 'h3', phone.name || 'Phone'));
      card.append(node(root, 'p', phone.connected ? 'Phone registered' : 'Not connected'));
      card.append(node(root, 'p', `${calling ? 'Calls' : 'Messages'}: ${phone[calling ? 'telephony' : 'messages'] ? 'On' : 'Off'}`));
      if (Number.isFinite(phone.lastSeenAt) && phone.lastSeenAt > 0)
        card.append(node(root, 'p', `Last check-in: ${new Date(phone.lastSeenAt).toLocaleString()}`));
    }
    if (!status.registrations?.length) root.append(node(root, 'p', "No phone connected. On your Android phone, open this environment's saved remote and choose Connect to phone."));
    root.append(node(root, 'p', 'A container needs its own shared connection. A recent check-in does not confirm that calling is ready.'));
    if (info.backendKind === 'local' || info.backendKind === 'machine') button(root, 'Share Local', () => run(() => call('phone-share')));
    return;
  }
  let state = await call('snapshot'), page = 'main', revision = 0, eventError;
  if (signal.aborted) return;
  const clean = subscribe('phone-state', value => {
    if (signal.aborted) return;
    state = value;
    if (eventError) eventError.textContent = state.error || '';
    if (page === 'main') overview();
    else if (page === 'contacts') contacts();
  });
  signal.addEventListener('abort', clean, { once: true });
  const refresh = async () => {
    const value = await call('snapshot');
    if (!signal.aborted) { state = value; if (page === 'main') overview(); else if (page === 'contacts') contacts(); }
  };
  root.ownerDocument.defaultView.addEventListener('focus', () => { void refresh().catch(() => {}); }, { signal });
  function screen(name, title) {
    page = name; revision++; root.replaceChildren();
    if (name !== 'main') { button(root, 'Back', overview); root.append(node(root, 'h2', title)); }
    eventError = node(root, 'p', state.error || ''); eventError.setAttribute('role', 'alert'); root.append(eventError);
    return runStatus(root, signal);
  }
  function message(value) { if (value) root.append(node(root, 'p', value)); }
  function connectionHint(value = state) {
    const name = calling ? 'Calls' : 'Messages';
    if (value.connectionState === 'connecting') return 'Connecting to your chats…';
    const local = value.localOnRequested === false ? 'Turn on Local to connect your chats. ' : '';
    if (value.connectionState === 'not-started')
      return `${local}${name} are enabled but haven't started. Turn ${name} off and on to start them.`;
    return local || `${name} aren't connected. Turn ${name} off and on to retry.`;
  }
  function overview() {
    const run = screen('main'), key = calling ? 'telephony' : 'messages';
    if (!calling) {
      root.append(node(root, 'h2', 'Completed turns'));
      message(state.turnNotifications?.enabled ? 'Turn notifications are on.' : 'Turn notifications are off.');
      button(root, 'Turn notification settings', turnSettings);
      root.append(node(root, 'hr'));
    }
    const enabled = check(root, calling ? 'Calls' : 'Messages', !!state.settings?.[key]);
    enabled.disabled = calling && !state.supported && !enabled.checked;
    enabled.onchange = () => {
      enabled.disabled = true;
      void run(async () => { await call('configure', { patch: { [key]: enabled.checked } }); await refresh(); })
        .finally(() => { if (enabled.isConnected) enabled.disabled = calling && !state.supported && !enabled.checked; });
    };
    if (calling) {
      const startup = check(root, 'Start with BashKitten', !!state.settings?.startup);
      startup.onchange = () => run(async () => { await call('configure', { patch: { startup: startup.checked } }); await refresh(); });
      message('Reconnects enabled Calls and Messages when BashKitten opens.');
      if (!state.supported) message("Calls aren't supported on this device.");
      button(root, 'Call setup', setup).disabled = !state.supported;
      button(root, 'Call settings', () => settings(true));
      button(root, 'Contacts and voicemail', contacts);
    } else {
      message('Reply to these messages from notifications or Android Auto.');
      button(root, 'Message settings', () => settings(false));
      if (!state.notifications) button(root, 'Allow notifications', () => run(() => call('notification-permission')));
    }
    if (state.settings?.[key] && !state.connected) message(connectionHint());
  }
  function turnSettings() {
    const run = screen('turn-settings', 'Turn notifications'), saved = state.turnNotifications || {};
    const enabled = check(root, 'Notify when a turn finishes', !!saved.enabled);
    const hidden = check(root, 'Only when this chat is not visible', saved.onlyWhenHidden !== false);
    const preview = check(root, 'Show a short message preview', saved.preview !== false);
    const actions = node(root, 'div'); actions.className = 'actions'; root.append(actions);
    button(actions, 'Cancel', overview);
    button(actions, 'Save', () => run(async () => {
      state.turnNotifications = await call('turn-notification-settings', { enabled: enabled.checked, onlyWhenHidden: hidden.checked, preview: preview.checked });
      if (!signal.aborted) overview();
    }));
  }
  function setup() {
    const run = screen('setup', 'Call setup'), current = revision;
    const status = node(root, 'p', state.settings?.telephony ? 'Checking setup…' : 'Turn on Calls to set up calling.');
    status.setAttribute('role', 'status'); root.append(status);
    const ready = async () => {
      const value = await call('readiness'); if (signal.aborted || current !== revision) return;
      const missing = [];
      if (!state.settings?.telephony) missing.push('Turn on Calls.');
      if (value.reason) missing.push(value.reason);
      else if (!value.accountEnabled) missing.push('Enable BashKitten in calling account settings.');
      if (!value.microphone) missing.push('Allow microphone access to speak during calls.');
      if (state.settings?.telephony && !value.gateway) missing.push(connectionHint(value));
      status.textContent = missing.length ? missing.join('\n') : 'Calling is set up. Speech models are checked when you call.';
    };
    button(root, 'Set up calling account', () => run(() => call('setup-account'))).disabled = !state.settings?.telephony;
    button(root, 'Check setup', () => run(ready));
    button(root, 'Call agent', () => run(() => call('call'))).disabled = !state.settings?.telephony || !state.connected;
    if (!state.microphone) button(root, 'Allow microphone', () => run(() => call('microphone-permission')));
    button(root, 'Voice settings', () => run(() => call('open-voice-settings')));
    if (state.settings?.telephony) void run(ready);
  }
  function settings(calls) {
    const run = screen('settings', calls ? 'Call settings' : 'Message settings');
    const saved = { ...state.settings }, input = {};
    input.ordinaryDefault = select(root, 'Updates for new chats', delivery, saved.ordinaryDefault || 'off');
    if (calls) {
      input.callDefault = select(root, 'Updates for chats started by phone', delivery.slice(1), saved.callDefault || 'calls');
      input.recent = select(root, 'Recent chats to read out', Array.from({ length: 9 }, (_, i) => [String(i + 1), String(i + 1)]), String(saved.recent || 5));
      root.append(node(root, 'hr'));
      input.finish = select(root, 'Finish speaking', [['hash', 'Press #'], ['silence', 'Pause'], ['either', 'Pause or press #']], saved.finish || 'either');
      input.silenceSeconds = field(root, 'Stop recording after (seconds without speech)', saved.silenceSeconds ?? 4, { type: 'number', min: '0', step: 'any' });
      input.silenceSeconds.disabled = input.finish.value === 'hash';
      input.finish.onchange = () => { input.silenceSeconds.disabled = input.finish.value === 'hash'; };
    } else button(root, 'Android Auto', () => run(async () => {
      const value = await call('android-auto'); if (signal.aborted || value.opened) return;
      autoHelp(value.installed);
    }));
    const actions = node(root, 'div'); actions.className = 'actions'; root.append(actions);
    button(actions, 'Cancel', overview);
    button(actions, 'Save', () => run(async () => {
      const patch = {};
      for (const [key, control] of Object.entries(input)) {
        let value = control.value;
        if (key === 'recent' || key === 'silenceSeconds') value = Number(value);
        if (key === 'silenceSeconds' && (!Number.isFinite(value) || value <= 0)) {
          control.setCustomValidity('Enter a number greater than zero'); control.reportValidity(); return;
        }
        control.setCustomValidity?.('');
        if (value !== saved[key]) patch[key] = value;
      }
      state = await call('configure', { patch }); if (!signal.aborted) overview();
    }));
  }
  function autoHelp(installed) {
    const run = screen('auto', 'Android Auto');
    message(installed ? "Android Auto doesn't offer a direct settings shortcut on this device." : "Android Auto isn't installed on this device.");
    message("Listen and reply in Android Auto's notifications. In Android Auto developer settings, allow unknown sources for this sideloaded app.");
    if (installed) button(root, 'Open app settings', () => run(() => call('android-auto-settings')));
  }
  function contacts() {
    const run = screen('contacts', 'Contacts and voicemail');
    button(root, 'Add Kitten contact', () => run(() => call('contact')));
    for (const [id, backend] of Object.entries(state.backends || {})) {
      if (backend.revoked) continue;
      const card = node(root, 'section'); card.className = 'connection-card'; root.append(card);
      card.append(node(root, 'h3', backend.name || 'BashKitten'));
      button(card, 'Add contact', () => run(() => call('contact', { backendId: id })));
      const divert = check(card, 'Send calls to voicemail', !!backend.divert);
      divert.onchange = () => run(() => call('divert', { backendId: id, enabled: divert.checked }));
      button(card, 'View voicemail', () => voicemail(id, backend.name));
      button(card, 'Clear voicemail', () => run(async () => {
        if (await confirm(root, { title: 'Clear voicemail?', message: `Clear voicemail for ${backend.name || 'BashKitten'}? Your chats will stay available.` }, signal))
          await call('clear-voicemail', { backendId: id });
      }));
    }
  }
  function voicemail(id, name) {
    screen('voicemail', `Voicemail · ${name || 'BashKitten'}`);
    const items = Object.values(state.mailbox || {}).filter(item => item.backendId === id);
    if (!items.length) message('No voicemail');
    for (const item of items) {
      const card = node(root, 'section'); card.className = 'connection-card'; root.append(card);
      card.append(node(root, 'h3', `${item.title || 'Chat'}${item.replied ? ' · Replied' : ''}`));
      if (item.questionStatus) card.append(node(root, 'p', item.questionStatus));
      const text = node(root, 'p', item.text || ''); text.style.whiteSpace = 'pre-wrap'; card.append(text);
    }
  }
  overview();
}
