// SPDX-License-Identifier: AGPL-3.0-or-later
// Run in a real Termux terminal with the Pi helper and Pi installed in this cwd.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { SessionManager, DefaultResourceLoader, createReadTool } from '@earendil-works/pi-coding-agent';
import { browserCall, sessionLocation } from '@openresearchtools/pi-wildbuzzard/client.mjs';

const vendor = process.argv[2] || 'signed';
assert(['signed', 'vendor'].includes(vendor));
const directory = resolve('results-' + vendor);
await mkdir(directory, { recursive: true, mode: 0o700 });
const report = { vendor, uid: process.getuid(), node: process.version, started: new Date().toISOString(), checks: [] };
const publish = async () => {
  await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  try { await fetch('http://127.0.0.1:8767/result/' + vendor, { method: 'POST', body: JSON.stringify(report) }); } catch {}
};
const check = async (name, action) => {
  console.log('CHECK', name);
  await action(); report.checks.push(name); await publish();
};
const find = (value, tag, name) => {
  if (!value || typeof value !== 'object') return null;
  if (value.tag === tag && (!name || value.name?.includes(name)) && value.reference) return value;
  for (const child of Object.values(value)) { const found = find(child, tag, name); if (found) return found; }
  return null;
};
const poll = async (action, label, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { const result = await action(); if (result) return result; } catch {} await delay(400); }
  throw new Error('Timed out: ' + label);
};
try {
  const a = SessionManager.create(directory, join(directory, 'sessions'));
  const b = SessionManager.create(directory, join(directory, 'sessions'));
  report.sessions = [a.getSessionId(), b.getSessionId()];
  const loader = new DefaultResourceLoader({ cwd: directory, agentDir: join(directory, 'pi'),
    additionalExtensionPaths: [resolve('node_modules/@openresearchtools/pi-wildbuzzard/extension.mjs')],
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions.find(item => item.tools.has('wildbuzzard_browser'));
  assert(extension);
  const tool = (name, args, session = a) => extension.tools.get(name).definition.execute(
    'termux-test', args, undefined, undefined, { sessionManager: session });
  const call = async (method, params = {}, session = a) => (await tool('wildbuzzard_browser', { method, params }, session)).details.result;
  const value = async (tabId, code) => (await call('evaluate', { tabId, code })).value;
  const loadedPage = (tabId, expression) => poll(() => value(tabId, 'return ' + expression + ';'), expression);
  let tabId;
  await check('browser-owned CLI prints its offline license notices', async () => {
    const execute = promisify(execFile);
    const { stdout } = await execute('pm', ['path', 'org.openresearchtools.wildbuzzard']);
    const env = { ...process.env, CLASSPATH: stdout.trim().replace(/^package:/, '') };
    delete env.LD_PRELOAD; delete env.LD_LIBRARY_PATH;
    const printed = await execute('/system/bin/app_process', ['/', 'org.openresearchtools.wildbuzzard.BrowserCommand', '--licenses'], { env, maxBuffer: 5000000 });
    for (const name of ['Mozilla Public License', 'BrowserOS', 'Tor Project', 'Android dependencies from this APK']) assert(printed.stdout.includes(name), name);
    report.licenseBytes = Buffer.byteLength(printed.stdout);
  });
  await check('actual Pi extension loads and Android app identity authorizes', async () => {
    if (vendor === 'vendor') {
      if (process.env.WB_EXPECT_DENIAL === '1') await assert.rejects(call('capabilities'), /authorization/);
      await browserCall(null, {}, { authorize: true });
    }
    const caps = await call('capabilities'); report.capabilities = caps;
    assert.equal(caps.authorization, vendor === 'signed' ? 'publisher-signature' : 'user-grant');
    assert.equal(caps.debuggable, false); assert.equal(caps.androidAccessibilityService, false);
    assert.equal(caps.foregroundService, true);
  });
  await check('real example.com navigation, tree and link action to IANA', async () => {
    tabId = (await call('tabs.create', { url: 'https://example.com' })).id;
    await loadedPage(tabId, 'document.title === "Example Domain"');
    const tree = await call('snapshot', { tabId });
    await writeFile(join(directory, 'example-tree.json'), JSON.stringify(tree), { mode: 0o600 });
    const link = find(tree, 'a'); assert(link);
    await call('act', { tabId, kind: 'click', target: link.reference });
    await loadedPage(tabId, 'location.hostname === "www.iana.org" && document.readyState === "complete"');
    assert.match(JSON.stringify(await call('read', { tabId, format: 'text' })), /IANA|Example Domains/);
    await call('back', { tabId }); await loadedPage(tabId, 'document.title === "Example Domain"');
    await call('forward', { tabId }); await loadedPage(tabId, 'location.hostname === "www.iana.org"');
    await call('reload', { tabId }); await loadedPage(tabId, 'document.readyState === "complete"');
  });
  await check('real MDN page renders and returns a page tree', async () => {
    await call('navigate', { tabId, url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript' });
    await loadedPage(tabId, 'document.querySelector("h1")?.textContent.includes("JavaScript")');
    const tree = await call('snapshot', { tabId, depth: 8 });
    assert.match(JSON.stringify(tree), /JavaScript/);
    await writeFile(join(directory, 'mdn-tree.json'), JSON.stringify(tree), { mode: 0o600 });
  });
  await check('DOM references fill, click, wait, read, console and per-tab policies', async () => {
    await call('navigate', { tabId, url: 'http://127.0.0.1:8765/' });
    await loadedPage(tabId, 'document.title === "Agent test page"');
    const tree = await call('snapshot', { tabId });
    const input = find(tree, 'input', 'Name'), button = find(tree, 'button', 'Submit');
    assert(input); assert(button);
    await call('act', { tabId, kind: 'fill', target: input.reference, value: vendor, clear: true });
    await call('act', { tabId, kind: 'click', target: button.reference });
    assert.equal((await call('wait', { tabId, for: 'text', value: 'Hello ' + vendor, timeout: 5000 })).matched, true);
    assert.match(JSON.stringify(await call('read', { tabId, format: 'text' })), new RegExp('Hello ' + vendor));
    await call('clearConsole', { tabId });
    await value(tabId, 'console.log("wildbuzzard-termux-check"); return true;');
    assert.match(JSON.stringify(await call('console', { tabId })), /wildbuzzard-termux-check/);
    await call('viewport', { tabId });
    await call('tabs.setDesktopMode', { tabId, enabled: true });
    await loadedPage(tabId, '!navigator.userAgent.includes("Mobile")');
    await call('tabs.setDesktopMode', { tabId, enabled: false });
    await loadedPage(tabId, 'navigator.userAgent.includes("Mobile")');
    await loadedPage(tabId, 'document.querySelector("#ad-test")?.dataset.result === "blocked"');
    await call('tabs.setAdblocking', { tabId, enabled: false });
    await loadedPage(tabId, 'document.querySelector("#ad-test")?.dataset.result === "loaded"');
    await call('tabs.setAdblocking', { tabId, enabled: true });
    await loadedPage(tabId, 'document.documentElement.dataset.consent === "rejected"');
    await call('stop', { tabId });
  });
  await check('actual remote/debugging/accessibility/WebDriver flags remain off after snapshots', async () => {
    report.diagnostics = await call('diagnostics', { tabId });
    for (const key of ['devtoolsRemoteEnabled', 'marionetteEnabled', 'remoteAgentEnabled', 'webdriver', 'engineAccessibilityEnabled']) assert.equal(report.diagnostics[key], false, key);
    assert.equal(report.diagnostics.snapshotBackend, 'dom');
  });
  await check('private screenshot returned as a Pi image and read again with Pi read', async () => {
    const result = await tool('wildbuzzard_screenshot', { tabId });
    assert(result.content.some(item => item.type === 'image' && item.mimeType === 'image/png'));
    assert.equal(dirname(result.details.path), sessionLocation(a).directory);
    assert.equal((await stat(result.details.path)).mode & 0o777, 0o600);
    const imageRead = await createReadTool(directory).execute('read', { path: result.details.path });
    assert(imageRead.content.some(item => item.type === 'image' && item.data));
    report.screenshot = { path: result.details.path, width: result.details.width, height: result.details.height,
      sha256: createHash('sha256').update(await readFile(result.details.path)).digest('hex') };
  });
  await check('two native Pi sessions cannot list or close one another’s tabs', async () => {
    assert(!(await call('tabs.list', {}, b)).some(tab => tab.id === tabId));
    await assert.rejects(call('tabs.close', { tabId }, b), /owned|authorized/);
    const second = (await call('tabs.create', { url: 'https://example.com' }, b)).id;
    assert(!(await call('tabs.list')).some(tab => tab.id === second));
    await call('tabs.close', { tabId: second }, b);
  });
  let exported, exportedAt;
  await check('real browser download, private Pi file and bearer-protected wget', async () => {
    const contents = 'Wild Buzzard ' + vendor + ' real browser download\n';
    await value(tabId, `const a=document.createElement('a');a.download='termux-${vendor}.txt';a.href=URL.createObjectURL(new Blob([${JSON.stringify(contents)}.repeat(4096)],{type:'text/plain'}));document.body.append(a);a.click();return true;`);
    const download = await poll(async () => {
      const items = (await tool('wildbuzzard_downloads', { action: 'list' })).details.downloads;
      const entry = items.find(item => item.name.startsWith('termux-' + vendor));
      if (entry?.status === 'INITIATED') try { await call('downloads.accept', { tabId, downloadId: entry.id }); } catch {}
      return entry?.status === 'COMPLETED' ? entry : null;
    }, 'download completes', 60000);
    const result = await tool('wildbuzzard_downloads', { action: 'fetch', downloadId: download.id });
    assert.equal(await readFile(result.details.path, 'utf8'), contents.repeat(4096));
    assert.equal((await stat(result.details.path)).mode & 0o777, 0o600);
    assert(!JSON.stringify(result).includes('Bearer'));
    exported = (await browserCall('downloads.get', { downloadId: download.id }, sessionLocation(a))).transfer;
    exportedAt = Date.now();
    assert.equal((await fetch(exported.url)).status, 403);
    assert.equal((await fetch(exported.url, { headers: { Authorization: 'Bearer wrong' } })).status, 403);
    assert.equal((await fetch(exported.url, { headers: { Authorization: 'Bearer ' + exported.token, Origin: 'https://example.com' } })).status, 403);
    const wgetDir = join(directory, 'wget'); await mkdir(wgetDir, { recursive: true, mode: 0o700 });
    await promisify(execFile)('sh', ['-c', exported.wget], { cwd: wgetDir });
    assert.equal(await readFile(join(wgetDir, download.name), 'utf8'), contents.repeat(4096));
    assert(!(await tool('wildbuzzard_downloads', { action: 'list' }, b)).details.downloads.some(item => item.id === download.id));
    await assert.rejects(tool('wildbuzzard_downloads', { action: 'fetch', downloadId: download.id }, b));
    report.download = { path: result.details.path, bytes: (await stat(result.details.path)).size };
  });
  await check('closing the last chat tab leaves the browser callable', async () => {
    await call('tabs.close', { tabId });
    await call('capabilities');
    assert(!(await call('tabs.list')).some(tab => tab.id === tabId));
  });
  if (process.env.WB_CHECK_EXPIRY === '1') await check('file grant expires while the authorized browser stays running', async () => {
    const headers = { Authorization: 'Bearer ' + exported.token };
    assert.equal((await fetch(exported.url, { headers })).status, 200);
    await delay(Math.max(0, exported.expiresInSeconds * 1000 + 1000 - (Date.now() - exportedAt)));
    assert.equal((await call('capabilities')).foregroundService, true);
    try { assert.equal((await fetch(exported.url, { headers })).status, 403); }
    catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error; }
  });
  report.ok = true; report.completed = new Date().toISOString(); await publish();
  console.log('PASS', report.checks.length, 'checks', directory);
} catch (error) {
  report.ok = false; report.error = String(error.message).replace(/Bearer [a-f0-9]{64}/g, 'Bearer [redacted]');
  await publish(); console.error(String(error.stack || error).replace(/Bearer [a-f0-9]{64}/g, 'Bearer [redacted]')); process.exitCode = 1;
}
