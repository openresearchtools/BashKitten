/* SPDX-License-Identifier: AGPL-3.0-only */
import { node, check, button, runStatus, confirm } from './ui.mjs';

const labels = { APPS: 'Apps and links', SCREEN: 'Read screen', TOUCH: 'Touch and gestures', TEXT: 'Typing' };
export async function renderSection({ root, call, subscribe, signal }) {
  let state = await call('snapshot');
  if (signal.aborted) return;
  const clean = subscribe('phone-controls-state', value => {
    if (signal.aborted) return;
    state = value; render();
  });
  signal.addEventListener('abort', clean, { once: true });
  const refresh = async () => { const value = await call('snapshot'); if (!signal.aborted) { state = value; render(); } };
  root.ownerDocument.defaultView.addEventListener('focus', () => { void refresh().catch(() => {}); }, { signal });
  function message(value) { root.append(node(root, 'p', value)); }
  function render() {
    root.replaceChildren(); const run = runStatus(root, signal);
    const master = check(root, 'Phone controls', !!state.enabled);
    master.onchange = () => {
      master.disabled = true;
      void run(async () => { state = await call('set-master', { enabled: master.checked }); if (!signal.aborted) render(); })
        .finally(() => { if (master.isConnected) master.disabled = false; });
    };
    if (state.enabled && !state.connected) message('Turn on Local to let your agent use phone controls.');
    if (!state.enabled) message('Turn on Phone controls to use these actions.');
    const action = (parent, title, work) => {
      const control = button(parent, title, () => run(work));
      control.disabled = !state.enabled;
      return control;
    };
    const folders = () => {
      root.append(node(root, 'h3', 'Allowed folders'));
      action(root, 'Add folder', async () => { await call('add-location'); await refresh(); });
      for (const location of state.locations || []) {
        const card = node(root, 'section'); card.className = 'connection-card'; root.append(card);
        card.append(node(root, 'h3', location.name || 'Folder'));
        const permissions = {};
        for (const [key, title] of [['read', 'Read'], ['write', 'Write'], ['delete', 'Delete']]) {
          permissions[key] = check(card, title, !!location[key]);
          permissions[key].disabled = !state.enabled;
        }
        for (const control of Object.values(permissions)) control.onchange = () => {
          for (const value of Object.values(permissions)) value.disabled = true;
          const args = { id: location.id, ...Object.fromEntries(Object.entries(permissions).map(([key, value]) => [key, value.checked])) };
          void run(async () => { state = await call('set-location', args); if (!signal.aborted) render(); })
            .finally(() => { for (const value of Object.values(permissions)) if (value.isConnected) value.disabled = !state.enabled; });
        };
        action(card, 'Remove access', async () => {
          if (!await confirm(root, { title: 'Remove folder access?', message: `Your agent will no longer have access to ${location.name || 'this folder'}. Files won't be deleted.` }, signal)) return;
          state = await call('remove-location', { id: location.id }); if (!signal.aborted) render();
        });
      }
      if (!state.locations?.length) message('No folders allowed yet.');
    };
    let accessibility = false;
    for (const feature of state.features || []) {
      if (feature.accessibility && !accessibility) {
        accessibility = true; root.append(node(root, 'hr'), node(root, 'h3', 'Accessibility'));
        if (!feature.available) message('Allow Accessibility access to use the actions below.');
        action(root, 'Accessibility settings', () => call('accessibility-settings'));
      }
      const option = check(root, labels[feature.id] || feature.label, !!feature.selected);
      const unavailable = !state.enabled || feature.accessibility && !feature.available;
      option.disabled = unavailable;
      option.onchange = () => {
        option.disabled = true;
        void run(async () => { state = await call('set-feature', { feature: feature.id, enabled: option.checked }); if (!signal.aborted) render(); })
          .finally(() => { if (option.isConnected) option.disabled = unavailable; });
      };
      if (feature.id === 'NOTIFICATIONS') {
        if (!feature.available) message('Notification access is needed.');
        action(root, 'Notification access', () => call('notification-settings'));
      }
      if (feature.id === 'FILES') folders();
      if (feature.id === 'LOCATION' && !feature.available) action(root, 'Allow precise location', () => call('location-permission'));
    }
  }
  render();
}
