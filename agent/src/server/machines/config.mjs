// SPDX-License-Identifier: AGPL-3.0-or-later
// External-rootfs/Podman ownership adapted from BuzzardOS; see machines/NOTICE.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { dataDir, privateDir, readJson, writeJson } from '../common.mjs';

export const packageRoot = fileURLToPath(new URL('../../../machines/', import.meta.url));
export const machineRoot = path.join(dataDir, 'machines');
// Keep Unix names below the kernel pathname limit even for long data-drive roots.
// Only temporary endpoints live here; rootfs/config/image storage stays in dataDir.
export const runtimeRoot = path.join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`, 'bashkitten', createHash('sha256').update(dataDir).digest('hex').slice(0,12), 'm');
// Podman's pause/ns_handles state follows XDG_RUNTIME_DIR, independently of
// storage.conf. Never join the host user's shared rootless Podman namespace.
export const podmanRuntime = path.join(runtimeRoot, 'podman');
export const storageRoot = path.join(dataDir, 'podman');
export const helper = name => path.join(packageRoot, 'bin', name);
export const daemonSocket = path.join(dataDir, 'run', 'machines.sock');
export const containerName = id => 'bashkitten-' + validId(id).replaceAll('-', '');
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const displayCommand = config => config.display.command ?? 'exec /usr/bin/xfce4-session';
export const displayAutostart = config => config.display?.startup === true;
export const userNamespace = '--userns=keep-id:uid=1000,gid=1000';
export const machineLabel = 'org.openresearchtools.bashkitten.machine-id';
export function validId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw Error('Invalid machine ID');
  return id;
}
export function locations(id) {
  validId(id);
  const directory = path.join(machineRoot, id), runtime = path.join(runtimeRoot, id.replaceAll('-', ''));
  if (Buffer.byteLength(path.join(runtime, 'exchange/agent/control.sock')) > 107) throw Error('The configured BashKitten data path is too long for native Unix sockets; select a shorter data directory');
  return { directory, runtime, rootfs: path.join(directory, 'rootfs'), config: path.join(directory, 'launch.json'),
    state: path.join(directory, 'state.json'), containerfile: path.join(directory, 'Containerfile'),
    anchor: path.join(runtime, 'anchor'), exchange: path.join(runtime, 'exchange'),
    display: path.join(runtime, 'display'), guestDisplay: path.join(runtime, 'display', 'guest'), settings: path.join(runtime, 'settings'),
    operation: path.join(directory, 'operation.json'), output: path.join(directory, 'operation.log') };
}
export async function load(id) {
  const files = locations(id);
  const config = await readJson(files.config);
  if (config.id !== id) throw Error('Machine identity does not match its directory');
  return { files, config, state: await readJson(files.state, { state: 'new' }) };
}
export async function prepareStorage() {
  const runtimeParent = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
  const runtimeStat = await fs.stat(runtimeParent);
  if (!runtimeStat.isDirectory() || runtimeStat.uid !== process.getuid() || runtimeStat.mode & 0o077) throw Error('A private owned XDG runtime directory is required');
  const existing = await fs.lstat(podmanRuntime).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isDirectory() || existing.uid !== process.getuid())) throw Error('Private Podman runtime directory ownership changed');
  for (const dir of [machineRoot, runtimeRoot, podmanRuntime, storageRoot, path.join(storageRoot, 'graph'), path.join(storageRoot, 'run'), path.join(storageRoot, 'config')]) await privateDir(dir);
  const q = JSON.stringify;
  const config = path.join(storageRoot, 'config');
  // Explicit paths prevent adopting host containers or silently finding distro helpers.
  const files = {
    'storage.conf': `[storage]\ndriver = "overlay"\ngraphroot = ${q(path.join(storageRoot, 'graph'))}\nrunroot = ${q(path.join(storageRoot, 'run'))}\n[storage.options.overlay]\nmount_program = ${q(helper('fuse-overlayfs'))}\n`,
    'containers.conf': `[engine]\nruntime = "bashkitten"\nconmon_path = [${q(helper('conmon'))}]\nhelper_binaries_dir = [${q(path.join(packageRoot, 'bin'))}]\ninit_path = ${q(helper('catatonit'))}\nevents_logger = "none"\n[engine.runtimes]\nbashkitten = [${q(helper('crun'))}]\n[network]\nnetwork_backend = "netavark"\nnetwork_config_dir = ${q(path.join(storageRoot, 'networks'))}\n[containers]\nlog_driver = "k8s-file"\npids_limit = 0\n`,
    'registries.conf': 'unqualified-search-registries = []\n',
    'policy.json': JSON.stringify({ default: [{ type: 'insecureAcceptAnything' }] }) + '\n',
  };
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(config, name), text, { mode: 0o600 });
  try { await fs.writeFile(path.join(config,'auth.json'),'{}\n',{flag:'wx',mode:0o600}); }
  catch(error) { if(error.code!=='EEXIST')throw error; }
}
export const podmanEnvironment = (overrides = {}) => ({ ...Object.fromEntries(Object.entries({...process.env,...overrides}).filter(([key]) => !/^(CONTAINERS?_|PODMAN_CONNECTIONS_CONF$|REGISTRY_AUTH_FILE$)/.test(key))),
  PATH: [path.join(packageRoot,'bin'),overrides.PATH ?? process.env.PATH].filter(Boolean).join(path.delimiter),
  XDG_RUNTIME_DIR: podmanRuntime,
  BASHKITTEN_DATA_DIR: dataDir,
  // Only the engine receives the private runtime root. Its cgroup control still
  // uses the real host user bus; media helpers retain their original environment.
  DBUS_SESSION_BUS_ADDRESS: overrides.DBUS_SESSION_BUS_ADDRESS ?? process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${path.join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`, 'bus')}`,
  CONTAINERS_CONF: path.join(storageRoot, 'config/containers.conf'),
  CONTAINERS_STORAGE_CONF: path.join(storageRoot, 'config/storage.conf'),
  CONTAINERS_REGISTRIES_CONF: path.join(storageRoot, 'config/registries.conf'),
  CONTAINERS_REGISTRIES_CONF_DIR: path.join(storageRoot, 'config/registries.d'),
  CONTAINERS_POLICY_JSON: path.join(storageRoot, 'config/policy.json'),
  REGISTRY_AUTH_FILE: path.join(storageRoot,'config/auth.json'),
});
export function mount(source, destination, readOnly = false) {
  const q = value => /[,"\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  return `type=bind,src=${q(source)},dst=${q(destination)}${readOnly ? ',ro=true' : ''}`;
}
export async function defaults(id, name) {
  const p = locations(id);
  return { schema: 1, id, name, autostart: false, rootfs: p.rootfs, containerfile: p.containerfile,
    launch: { executable: helper('podman'), cwd: p.directory, environment: {}, arguments: [
      'create', '--name', containerName(id), '--label', `${machineLabel}=${id}`, '--systemd=always', '--pids-limit=-1',
      // The guest-root FUSE broker duplicates the UID1000 libfuse socket with
      // pidfd_getfd, whose cross-UID check needs SYS_PTRACE in this user namespace.
      userNamespace, '--group-add=keep-groups', '--user=0', '--device=/dev/fuse', '--cap-add=SYS_ADMIN', '--cap-add=SYS_PTRACE', '--env=container=podman', '--env=BASHKITTEN_MACHINE_ID=' + id,
      '--mount', mount(p.rootfs, '/'), '--mount', mount(p.exchange, '/run/bashkitten-host'),
      '--mount', mount(p.settings, '/run/bashkitten-settings', true),
      '--mount', mount(p.guestDisplay, '/run/bashkitten-display'),
      '--rootfs', p.anchor, '/usr/lib/bashkitten/machines/bin/bashkitten-init',
    ] },
    display: { mode: 'auto', renderNode: null, formats: [], command: 'exec /usr/bin/xfce4-session', startup: true },
    integrations: { ports: [], gpus: [], media: Object.fromEntries(['guest_audio_output', 'host_microphone', 'host_camera'].map(name => [name, { enabled: false, node: null }])) },
  };
}
export function validate(config, id) {
  const p = locations(id);
  if (config.schema !== 1 || config.id !== id || config.rootfs !== p.rootfs || config.containerfile !== p.containerfile) throw Error('Machine paths and identity are fixed; edit launch arguments without moving the rootfs');
  if (typeof config.name !== 'string' || !config.name.trim() || /[\x00-\x1f]/.test(config.name)) throw Error('Enter a machine name without control characters');
  if (typeof config.autostart !== 'boolean') throw Error('Startup must be On or Off');
  const c = config.launch;
  if (!c || !path.isAbsolute(c.executable || '') || !path.isAbsolute(c.cwd || '') || !Array.isArray(c.arguments) || c.arguments.some(a => typeof a !== 'string' || a.includes('\0'))) throw Error('Launch needs an absolute executable, working directory and argument array');
  if (Object.keys(c.environment || {}).some(key => /^(CONTAINERS?_|PODMAN_CONNECTIONS_CONF$|REGISTRY_AUTH_FILE$|BASHKITTEN_DATA_DIR$|BASHKITTEN_GUARD(?:ED|_PID)$|XDG_RUNTIME_DIR$)/.test(key))) throw Error('Keep the private machine storage and control environment');
  if (!c.environment || typeof c.environment !== 'object' || Array.isArray(c.environment) || Object.entries(c.environment).some(([k,v]) => !/^[A-Za-z_][A-Za-z_0-9]*$/.test(k) || typeof v !== 'string' || v.includes('\0'))) throw Error('Launch environment must contain valid string variables');
  const args = c.arguments;
  if (args.some(a => /^--(?:root|runroot|storage-driver|storage-opt|connection|url|remote|namespace)(?:=|$)/.test(a))) throw Error('Keep the private local Podman storage and engine');
  if (args[0] !== 'create' || args.filter(a => a === '--name').length !== 1 || args[args.indexOf('--name') + 1] !== containerName(id)) throw Error('The native command must create this machine with its stable --name');
  if (!args.some((a,i) => a === '--label' && args[i+1] === `${machineLabel}=${id}`)) throw Error('Keep the machine ownership label');
  if (!args.includes(userNamespace) || args.some(a => (a.startsWith('--userns') && a !== userNamespace) || a.startsWith('--uidmap') || a.startsWith('--gidmap'))) throw Error('Changing the UID/GID map requires migrating existing rootfs ownership; keep the saved keep-id map');
  if (args.filter(a => a === '--rootfs').length !== 1 || args[args.indexOf('--rootfs') + 1] !== p.anchor) throw Error('Keep the empty native rootfs anchor');
  for (const value of [mount(p.rootfs, '/'), mount(p.exchange, '/run/bashkitten-host'), mount(p.settings, '/run/bashkitten-settings', true), mount(p.guestDisplay, '/run/bashkitten-display')]) {
    if (!args.some((a,i) => a === '--mount' && args[i+1] === value)) throw Error('Keep each allocated private endpoint and external rootfs mount');
  }
  if (!['auto', 'software'].includes(config.display?.mode) || config.display.renderNode !== null && !/^\/dev\/dri\/renderD[0-9]+$/.test(config.display.renderNode || '')) throw Error('Choose auto/software display and an actual DRM render node');
  if (typeof displayCommand(config) !== 'string' || !displayCommand(config).trim() || displayCommand(config).includes('\0')) throw Error('Enter a valid Display launch command');
  if (config.display.startup !== undefined && typeof config.display.startup !== 'boolean') throw Error('Choose whether Display starts with this container');
  if (!Array.isArray(config.display.formats) || config.display.formats.some(f => !Number.isInteger(f.fourcc) || f.fourcc < 0 || f.fourcc > 0xffffffff || !/^[0-9]+$/.test(String(f.modifier)))) throw Error('Invalid native display format list');
  if (!Array.isArray(config.integrations?.ports) || typeof config.integrations.media !== 'object') throw Error('Invalid integration settings');
  if (!Array.isArray(config.integrations.gpus) || config.integrations.gpus.some(gpu => typeof gpu !== 'string' || !/^(all|[0-9]+|GPU-[A-Za-z0-9-]+)$/.test(gpu))) throw Error('NVIDIA GPU choices must be all, a numeric index or GPU UUID');
  for (const port of config.integrations.ports) {
    if (typeof port.enabled !== 'boolean' || !['tcp','udp'].includes(port.protocol) || !['host-to-guest','guest-to-host'].includes(port.direction) || ![port.hostPort,port.guestPort].every(v => Number.isInteger(v) && v > 0 && v <= 65535) || ![port.hostAddress,port.guestAddress].every(v => typeof v === 'string' && /^[0-9a-fA-F.:]+$/.test(v))) throw Error('Invalid port mapping');
  }
  for (const key of ['guest_audio_output', 'host_microphone', 'host_camera']) {
    const value = config.integrations.media[key];
    if (!value || typeof value.enabled !== 'boolean' || value.node !== null && (typeof value.node !== 'string' || /[\x00-\x1f]/.test(value.node))) throw Error('Invalid media selection');
  }
  return config;
}
export function definition(config) {
  const { command, startup, ...display } = config.display || {};
  return digest({ launch: config.launch, display, integrations: config.integrations });
}
export async function prepareRuntime(id) {
  const p = locations(id);
  for (const dir of [p.runtime, p.anchor, p.exchange, p.settings, p.display, p.guestDisplay]) await privateDir(dir);
  return p;
}
