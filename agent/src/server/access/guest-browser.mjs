// SPDX-License-Identifier: AGPL-3.0-only
// Native guest-browser authorization. This never publishes an HTTP service or
// grants control of the host browser; commands use the existing private backend.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { dataDir } from '../common.mjs';
import { processStart } from '../instance.mjs';

const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const guestBrowserRole = () => process.platform === 'linux' && process.env.BASHKITTEN_EXECUTION_ROLE === 'container' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(process.env.BASHKITTEN_MACHINE_ID || '');
export async function guestBrowserBootstrap(stack, value) {
  if (!guestBrowserRole() || !stack.ready || !stack.guestBrowserToken) throw Error('Managed guest browser is unavailable');
  const { browserPid, helperPid, profile } = value;
  if (!Number.isInteger(browserPid) || !Number.isInteger(helperPid) || browserPid < 2 || helperPid < 2 || typeof profile !== 'string') throw Error('Invalid guest browser owner');
  const uid = process.getuid();
  const [browser, helper, profileStat, root, expected, executable, stat, environment, command, uidMap] = await Promise.all([
    fs.stat(`/proc/${browserPid}`), fs.stat(`/proc/${helperPid}`), fs.lstat(profile), fs.realpath(profile), fs.realpath(path.join(dataDir,'browser')),
    fs.realpath(`/proc/${browserPid}/exe`), fs.readFile(`/proc/${helperPid}/stat`,'utf8'), fs.readFile(`/proc/${browserPid}/environ`,'utf8'), fs.readFile(`/proc/${helperPid}/cmdline`,'utf8'), fs.readFile('/proc/self/uid_map','utf8'),
  ]);
  const env = Object.fromEntries(environment.split('\0').filter(v=>v.includes('=')).map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
  const parent = Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[1]);
  const nativeRoot = await fs.realpath('/usr/lib/bashkitten/browser');
  if (browser.uid !== uid || helper.uid !== uid || profileStat.uid !== uid || !profileStat.isDirectory() || profileStat.isSymbolicLink() || (profileStat.mode & 0o077) || root !== expected ||
      !executable.startsWith(nativeRoot + '/') || parent !== browserPid || !command.split('\0').includes('/usr/lib/bashkitten/src/server/access/guest-browser-relay.mjs') ||
      env.BASHKITTEN_GUEST_BROWSER !== '1' || env.BASHKITTEN_EXECUTION_ROLE !== 'container' || env.BASHKITTEN_MACHINE_ID !== process.env.BASHKITTEN_MACHINE_ID ||
      await fs.realpath(env.BASHKITTEN_DATA_DIR || '') !== await fs.realpath(dataDir) || /^\s*0\s+0\s+4294967295\s*$/.test(uidMap) || !await processStart(browserPid)) throw Error('Guest browser/profile ownership did not match its registered environment');
  return { version: 1, socket: stack.info.socket, origin: stack.origin, credential: stack.guestBrowserToken, browserPid, started: await processStart(browserPid) };
}
export async function handleGuestBrowser(req,res,route,handleBrowserChannel) {
  const prefix='/api/native-guest-browser/'; if(!route.startsWith(prefix))return false;
  const secret=process.env.BASHKITTEN_GUEST_BROWSER_OWNER_TOKEN;
  if(!guestBrowserRole()||!secret||req.method!=='POST'||req.headers.origin||req.headers['x-bashkitten-proxy']||req.socket.remoteAddress||!equal(req.headers.authorization,'Bearer '+secret))throw Object.assign(Error('Native guest browser authorization required'),{status:403});
  const operation=route.slice(prefix.length);if(!['open','poll','result','close','bind'].includes(operation))throw Object.assign(Error('Unknown guest browser operation'),{status:404});
  const cookie=process.env.BASHKITTEN_LOCAL_TOKEN;
  const record={local:true,nativeGuest:true,username:'local',cookie,key:createHash('sha256').update('local\0'+cookie).digest('hex'),origin:process.env.BASHKITTEN_ACCESS_ORIGIN};
  await handleBrowserChannel(req,res,record,'/api/browser-channel/'+operation);return true;
}
