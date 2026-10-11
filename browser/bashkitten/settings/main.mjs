/* SPDX-License-Identifier: AGPL-3.0-only */
const sections = Object.freeze({
  autostart: { title: 'Autostart', module: './autostart.mjs' },
  updates: { title: 'Updates', module: './updates.mjs', platform: 'android' },
  localai: { title: 'Local AI', module: './localai.mjs' },
  notifications: { title: 'Notifications', module: './phone.mjs' },
  telephone: { title: 'Callback', module: './phone.mjs' },
  'phone-use': { title: 'Phone use', module: './device-controls.mjs', platform: 'android' },
  remotes: { title: 'Remote Connections', module: './remotes.mjs' },
  performance: { title: 'Performance', module: './performance.mjs' },
  display: { title: 'Display', module: './display-settings.mjs' },
  'share-local': { title: 'Share Local', module: './share-local.mjs' },
  machine: { title: 'Container settings', module: './machine.mjs' },
});
const root = document.querySelector('#content'), status = document.querySelector('#page-status');
const lifetime = new AbortController();
let started = false;
async function start() {
  const bridge = window.bashkittenSettings;
  if (started || !bridge || lifetime.signal.aborted) return;
  started = true;
  try {
    const info = bridge.info, section = sections[info?.section];
    if (!section || section.platform && section.platform !== info.platform || typeof bridge.call !== 'function') throw Error('This settings view is unavailable.');
    const theme = value => {
      const choice = typeof value === 'string' ? value : value?.theme;
      if (['light', 'dark'].includes(choice)) document.documentElement.dataset.theme = choice;
    };
    theme(info.theme);
    const unsubscribeTheme = bridge.subscribe('theme', theme);
    if (typeof unsubscribeTheme === 'function') lifetime.signal.addEventListener('abort', unsubscribeTheme, { once: true });
    document.title = `${section.title} — BashKitten`;
    document.querySelector('#title').textContent = section.title;
    document.querySelector('#backend').textContent = info.backendName || (info.local ? 'Local' : '');
    const close = document.querySelector('#close'); close.hidden = false;
    close.onclick = () => bridge.call('settings-close', {}).catch(error => { status.textContent = error.message; });
    const module = await import(section.module);
    if (lifetime.signal.aborted) return;
    status.textContent = '';
    await module.renderSection({ root, call: (name, args = {}) => bridge.call(name, args),
      subscribe: (type, listener) => bridge.subscribe(type, listener), info, signal: lifetime.signal });
  } catch (error) { if (!lifetime.signal.aborted) status.textContent = error.message; }
}
window.addEventListener('bashkitten-settings-ready', start, { signal: lifetime.signal });
window.addEventListener('bashkitten-settings-error', event => {
  if (!lifetime.signal.aborted) status.textContent = event.detail?.message || 'This settings view is unavailable. Open it from BashKitten settings.';
}, { signal: lifetime.signal });
window.addEventListener('bashkitten-settings-closed', () => lifetime.abort(), { once: true });
window.addEventListener('pagehide', () => lifetime.abort(), { once: true });
void start();
