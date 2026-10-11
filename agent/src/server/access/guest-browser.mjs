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
async function registeredGuestProfile(profile, env, uid) {
  const home = await fs.realpath(process.env.HOME);
  if (await fs.realpath(env.HOME || '') !== home ||
      (env.XDG_CONFIG_HOME || '') !== (process.env.XDG_CONFIG_HOME || '') ||
      (env.MOZ_LEGACY_HOME || '') !== (process.env.MOZ_LEGACY_HOME || '')) return false;
  // Match the product's nsXREDirProvider selection, then require the exact
  // profile registered there. Never accept arbitrary owned/private directories.
  const legacy = path.join(home,'.bashkitten','bashkitten');
  const legacyExists = await fs.stat(legacy).then(() => true, error => { if(error.code==='ENOENT')return false;throw error; });
  const configHome = path.isAbsolute(process.env.XDG_CONFIG_HOME || '') ? process.env.XDG_CONFIG_HOME : path.join(home,'.config');
  const directory = legacyExists || process.env.MOZ_LEGACY_HOME?.startsWith('1') ? legacy : path.join(configHome,'bashkitten','bashkitten');
  const registry = path.join(directory,'profiles.ini');
  const [root, base, info] = await Promise.all([fs.realpath(profile),fs.realpath(directory),fs.lstat(registry)]);
  if (!root.startsWith(base + path.sep) || info.uid!==uid || !info.isFile() || info.isSymbolicLink() || info.mode & 0o077) return false;
  const profiles=[];let current;
  for (const line of (await fs.readFile(registry,'utf8')).split(/\r?\n/)) {
    const section=line.trim().match(/^\[([^\]]+)\]$/);
    if(section) {current=/^Profile\d+$/.test(section[1])?{}:null;if(current)profiles.push(current);continue;}
    const entry=line.match(/^\s*(Path|IsRelative)\s*=(.*)$/);
    if(current&&entry)current[entry[1]]=entry[2].trim();
  }
  for(const item of profiles) {
    if(!item.Path || !['0','1'].includes(item.IsRelative))continue;
    const candidate=item.IsRelative==='1'?path.resolve(directory,item.Path):item.Path;
    if(!path.isAbsolute(candidate) || path.resolve(candidate)!==path.resolve(profile))continue;
    return await fs.realpath(candidate)===root;
  }
  return false;
}
export async function guestBrowserBootstrap(stack, value) {
  if (!guestBrowserRole() || !stack.ready || !stack.guestBrowserToken) throw Error('Managed guest browser is unavailable');
  const { browserPid, helperPid, profile } = value;
  if (!Number.isInteger(browserPid) || !Number.isInteger(helperPid) || browserPid < 2 || helperPid < 2 || typeof profile !== 'string') throw Error('Invalid guest browser owner');
  const uid = process.getuid();
  const [browser, helper, profileStat, executable, stat, environment, command, uidMap] = await Promise.all([
    fs.stat(`/proc/${browserPid}`), fs.stat(`/proc/${helperPid}`), fs.lstat(profile),
    fs.realpath(`/proc/${browserPid}/exe`), fs.readFile(`/proc/${helperPid}/stat`,'utf8'), fs.readFile(`/proc/${browserPid}/environ`,'utf8'), fs.readFile(`/proc/${helperPid}/cmdline`,'utf8'), fs.readFile('/proc/self/uid_map','utf8'),
  ]);
  const env = Object.fromEntries(environment.split('\0').filter(v=>v.includes('=')).map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
  const parent = Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[1]);
  const nativeRoot = await fs.realpath('/usr/lib/bashkitten/browser');
  if (browser.uid !== uid || helper.uid !== uid || profileStat.uid !== uid || !profileStat.isDirectory() || profileStat.isSymbolicLink() || (profileStat.mode & 0o077) ||
      !executable.startsWith(nativeRoot + '/') || parent !== browserPid || !command.split('\0').includes('/usr/lib/bashkitten/src/server/access/guest-browser-relay.mjs') ||
      env.BASHKITTEN_GUEST_BROWSER !== '1' || env.BASHKITTEN_EXECUTION_ROLE !== 'container' || env.BASHKITTEN_MACHINE_ID !== process.env.BASHKITTEN_MACHINE_ID ||
      await fs.realpath(env.BASHKITTEN_DATA_DIR || '') !== await fs.realpath(dataDir) || !await registeredGuestProfile(profile,env,uid) ||
      /^\s*0\s+0\s+4294967295\s*$/.test(uidMap) || !await processStart(browserPid)) throw Error('Guest browser/profile ownership did not match its registered environment');
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
