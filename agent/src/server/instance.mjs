import fs from 'node:fs/promises';
import net from 'node:net';
import https from 'node:https';
import path from 'node:path';
import { dataDir, digest, readJson } from './common.mjs';
import { unixRequest } from './access/io.mjs';

export const serverFile = path.join(dataDir, 'server.json');

// Kernel ownership disappears even after SIGKILL. No stale lock-file deletion race.
export async function claimInstance(name) {
  const scope = await fs.realpath(dataDir);
  const lock = net.createServer(socket => socket.destroy());
  try {
    await new Promise((resolve, reject) => {
      lock.once('error', reject);
      lock.listen('\0bashkitten-' + digest(`${process.getuid()}:${scope}:${name}`), resolve);
    });
    return lock;
  } catch (error) {
    if (error.code === 'EADDRINUSE') return null;
    throw error;
  }
}

export async function processStart(pid) {
  if (!Number.isInteger(pid) || pid < 2) return null;
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return ['Z', 'X'].includes(fields[0]) ? null : fields[19];
  } catch { return null; }
}

export async function backendAlive(info) {
  const started = await processStart(info?.pid);
  if (!info?.script || !started || (info.started && started !== info.started)) return false;
  try {
    if (!(await fs.readFile(`/proc/${info.pid}/cmdline`, 'utf8')).split('\0').includes(info.script)) return false;
    const env = Object.fromEntries((await fs.readFile(`/proc/${info.pid}/environ`, 'utf8')).split('\0').filter(v => v.includes('=')).map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]));
    return await fs.realpath(env.BASHKITTEN_DATA_DIR || path.join(env.HOME, '.local/share/bashkitten-pi')) === await fs.realpath(dataDir);
  }
  catch { return false; }
}

export async function probeBackend(info) {
  if (info === undefined) info = await readJson(serverFile, null);
  if (!await backendAlive(info) || !/^https:\/\/127\.0\.0\.1:\d+$/.test(info.url) || !/^[a-f0-9]{64}$/.test(info.token || '') || !info.identity?.caPem || !info.socket) return null;
  if (await processStart(info.managerPid) !== info.managerStarted) return null;
  try {
    const response = await unixRequest(info.socket, '/api/instance', { headers: { host: new URL(info.url).host, authorization: 'Bearer ' + info.token }, timeout: 2000 });
    const value = JSON.parse(response.body);
    if (response.status !== 200 || value.pid !== info.pid || value.instance !== info.token) return null;
  } catch { return null; }
  return new Promise(resolve => {
    // Verify the saved CA and hostname before sending any credentials.
    const req = https.get(info.url + '/licenses.json', { ca: info.identity.caPem, rejectUnauthorized: true }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200 ? info : null));
      res.on('error', () => resolve(null));
    });
    const timer = setTimeout(() => { req.destroy(); resolve(null); }, 2000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => resolve(null));
  });
}
