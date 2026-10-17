/* SPDX-License-Identifier: AGPL-3.0-only */
import { node, button, check as toggle } from './ui.mjs';

/** Android-owned APK and Termux updates; ordinary Agent pages have no updater. */
export async function renderSection({ root, call, signal, subscribe }) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const browser = node(root, 'section'), packages = node(root, 'section');
  const message = node(root, 'p'); message.setAttribute('role', 'status');
  root.append(browser, packages, message);
  browser.append(node(browser, 'h2', 'BashKitten'));
  const channel = toggle(browser, 'Include pre-releases (nightly)', false);
  channel.onchange = () => {
    const value = channel.checked ? 'nightly' : 'stable';
    void run(() => call('updates.channel', { channel: value }));
  };
  browser.append(node(browser, 'p', 'Applies to app checks and package updates here. Turning this off waits for newer stable releases without downgrading the app.'));
  const browserStatus = node(browser, 'p'); browser.append(browserStatus);
  const actions = node(browser, 'div'); actions.className = 'actions'; browser.append(actions);
  const check = button(actions, 'Check for updates', () => run(() => call('updates.check')));
  const download = button(actions, 'Download app update', () => run(() => call('updates.download')));
  browser.append(node(browser, 'p', 'Android asks you to install the downloaded app. Its matching Termux packages update automatically after you open the new version. Package repair restores the exact versions required by the installed app.'));
  packages.append(node(packages, 'h2', 'Termux packages'));
  const matching = node(packages, 'p'); packages.append(matching);
  const packageSummary = node(packages, 'p'); packages.append(packageSummary);
  const availableBox = node(packages, 'details'); availableBox.append(node(availableBox, 'summary', 'Available package updates'));
  const availableList = node(availableBox, 'div'); availableBox.append(availableList); packages.append(availableBox);
  const packageActions = node(packages, 'div'); packageActions.className = 'actions'; packages.append(packageActions);
  const controls = [];
  for (const [kind, title] of [['match-packages', 'Retry update'], ['update-packages', 'Update packages'],
    ['refresh-lists', 'Refresh lists'], ['recover-packages', 'Repair interrupted update'],
    ['update-pi', 'Update Pi'], ['rollback-pi', 'Roll back Pi']]) {
    const control = button(packageActions, title, () => run(() => call('updates.packages', { kind })));
    controls.push({ kind, control });
  }
  const phase = node(packages, 'p'); phase.setAttribute('role', 'status'); packages.append(phase);
  const progress = node(packages, 'progress'); progress.max = 100; progress.style.width = '100%'; progress.setAttribute('aria-label', 'Package update progress'); packages.append(progress);
  const cancel = button(packages, 'Cancel after current step', () => run(() => call('updates.cancel')));
  const outputBox = node(packages, 'details'); outputBox.append(node(outputBox, 'summary', 'Package output'));
  const output = node(outputBox, 'pre'); output.style.whiteSpace = 'pre-wrap'; outputBox.append(output); packages.append(outputBox);
  const inventoryBox = node(packages, 'details'); inventoryBox.append(node(inventoryBox, 'summary', 'Installed packages'));
  const inventory = node(inventoryBox, 'div'); inventoryBox.append(inventory); packages.append(inventoryBox);
  let pending = false, polling = false, timer, snapshot, availableKey = '';
  const active = () => !signal.aborted && root.isConnected;
  async function run(work) {
    if (pending || !active()) return;
    pending = true; message.textContent = ''; draw();
    try { await work(); await load(); }
    catch (error) { if (active()) message.textContent = error.message; }
    finally { pending = false; draw(); }
  }
  function draw() {
    if (!active()) return;
    const app = snapshot?.browser || {}, termux = snapshot?.termux || {}, state = snapshot?.packages || {};
    const job = state.job, busy = ['running', 'waiting'].includes(job?.status) || termux.updating;
    channel.checked = app.channel === 'nightly'; channel.disabled = pending || busy || Boolean(app.checking) || !snapshot;
    browserStatus.textContent = [`Installed ${app.version || ''}`, app.available ? `${app.available.version} is available` : app.checked ? `No newer ${app.channel === 'nightly' ? 'stable or nightly' : 'stable'} app is available` : '', app.error].filter(Boolean).join(' · ');
    check.disabled = pending || Boolean(app.checking); download.hidden = !app.available; download.disabled = pending;
    matching.textContent = termux.needsSetup ? 'Complete Local setup to manage Termux packages.' :
      termux.error || (termux.matching ? 'BashKitten packages match this app.' : termux.updating ? 'Updating the packages required by this app…' : 'Checking the packages required by this app…');
    const apt = state.sources?.apt?.channel === app.channel ? state.sources.apt : null, pi = state.sources?.pi;
    packageSummary.textContent = [state.runtime?.version ? `Pi ${state.runtime.version}` : '', apt?.error || (apt ? `${apt.available || 0} package updates available` : ''), pi?.error].filter(Boolean).join(' · ');
    const entries = apt?.packages || [], key = JSON.stringify(entries);
    availableBox.hidden = !entries.length;
    if (key !== availableKey) {
      availableKey = key; availableList.replaceChildren();
      for (const item of entries) availableList.append(node(availableList, 'p', `${item.name} · ${item.current} → ${item.latest}${item.managedByApk ? ' · updates with the app' : ''}`));
    }
    for (const { kind, control } of controls) {
      control.disabled = pending || busy || termux.needsSetup || !snapshot;
      control.hidden = kind === 'match-packages' && termux.matching || kind === 'rollback-pi' && !state.runtime?.previous;
    }
    phase.textContent = job ? [job.phase, job.status, job.error].filter(Boolean).join(' · ') : '';
    progress.hidden = !busy;
    if (busy && job?.progress) progress.value = job.progress.percent; else progress.removeAttribute('value');
    cancel.hidden = !busy; cancel.disabled = pending || Boolean(job?.cancelRequested);
    const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
    output.textContent = job?.log || termux.output || '';
    if (follow) output.scrollTop = output.scrollHeight;
  }
  async function load() {
    if (!active() || doc.hidden || polling) return;
    polling = true;
    try { const value = await call('updates.snapshot'); if (active()) { snapshot = value; draw(); } }
    finally { polling = false; }
  }
  async function poll() {
    try { await load(); } catch (error) { if (active()) message.textContent = error.message; }
    finally { if (active() && !doc.hidden) timer = win.setTimeout(poll, 1500); }
  }
  inventoryBox.ontoggle = () => {
    if (!inventoryBox.open || !active()) return;
    void run(async () => {
      const value = await call('updates.inventory'); if (!active()) return;
      inventory.replaceChildren();
      for (const [title, entries] of [['APT', value.apt], ['npm', value.npm], ['Pi', [{ name: 'Pi', version: value.pi }]], ['Search', value.search?.packages]]) {
        if (!entries?.length) continue;
        inventory.append(node(inventory, 'h3', title));
        for (const entry of entries) inventory.append(node(inventory, 'p', `${entry.name} · ${entry.version}`));
      }
      if (value.npmError) inventory.append(node(inventory, 'p', value.npmError));
    });
  };
  const unsubscribe = subscribe('updates', () => { if (active() && !doc.hidden) void load().catch(error => { message.textContent = error.message; }); });
  signal.addEventListener('abort', () => { win.clearTimeout(timer); unsubscribe?.(); }, { once: true });
  doc.addEventListener('visibilitychange', () => { win.clearTimeout(timer); if (!doc.hidden && active()) void poll(); }, { signal });
  await poll();
}
