// Owned process group: the manager stops only this X11/session/helper group.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, readJson } from '../../common.mjs';
import '../index.mjs';
process.umask(0o077);
const config = await readJson(path.join(dataDir, 'run/desktop-launch.json'));
const env = { ...process.env, ...config.env, DISPLAY: ':' + config.display };
const children = [];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); setTimeout(() => process.exit(code), 300).unref(); }
function run(command, args, environment = env) {
  const child = spawn(command, args, { env: environment, stdio: 'inherit' }); children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); }); return child;
}
process.on('SIGTERM', () => stop()); process.on('SIGINT', () => stop());
if (config.helper) {
  await fs.rm(env.VTEST_SOCKET_NAME, { force: true });
  run('virgl_test_server_android', [...config.helper, '--socket-path', env.VTEST_SOCKET_NAME]);
  for (let i = 0; i < 60; i++) { if (await fs.stat(env.VTEST_SOCKET_NAME).catch(() => null)) break; await new Promise(r => setTimeout(r, 100)); }
}
const args = [':' + config.display, '-nolisten', 'tcp', '-dpi', String(config.dpi)];
if (config.legacyDrawing) args.push('-legacy-drawing');
if (config.forceBgra) args.push('-force-bgra');
const command = config.method === 'custom' ? config.customCommand : config.method === 'no-dbus' ? 'xfce4-session' : 'dbus-launch --exit-with-session xfce4-session';
if (config.probe) run('termux-x11', args);
else if (config.method === 'environment') run('termux-x11', args, { ...env, TERMUX_X11_XSTARTUP: command });
else if (config.method === 'separator') run('termux-x11', [...args, '--', 'sh', '-c', command]);
else if (config.method === 'separate') {
  run('termux-x11', args);
  await new Promise(r => setTimeout(r, 1000)); run('sh', ['-c', command]);
} else run('termux-x11', [...args, '-xstartup', command]);
