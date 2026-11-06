import path from 'node:path';
import { dataDir } from '../common.mjs';
import { bundledRoot } from '../rpc/runtime.mjs';

export const accessDir = path.join(dataDir, 'access');
// Remote reset may remove this whole directory. Local CA/session keys stay outside it.
export const remoteDir = path.join(accessDir, 'remote');
export const runDir = path.join(dataDir, 'run');
export const authBin = process.env.TASKARIAN_AUTH_BIN || path.join(bundledRoot, 'auth/bin');
export const binary = name => path.join(authBin, name);
export const paths = {
  control: path.join(runDir, 'control.sock'),
  users: path.join(remoteDir, 'users.yml'), config: path.join(remoteDir, 'authelia.yml'),
  database: path.join(remoteDir, 'authelia.sqlite3'), pending: path.join(remoteDir, 'enrollment.json'),
  complete: path.join(remoteDir, 'initialized.json'), qr: path.join(remoteDir, 'totp.png'),
  auth: path.join(runDir, 'auth.sock'), backend: path.join(runDir, 'web.sock'),
  sessionSocket: path.join(runDir, 'sessions.sock'), sessionConfig: path.join(remoteDir, 'valkey.conf'),
  sessionStore: path.join(remoteDir, 'sessions'), tunnel: path.join(runDir, 'remote.sock'),
  admin: path.join(runDir, 'caddy.sock'), caddy: path.join(accessDir, 'Caddyfile'),
  caddyJson: path.join(accessDir, 'caddy.json'), remoteStorage: path.join(remoteDir, 'caddy'),
  share: path.join(accessDir, 'share.json'), remoteKeys: path.join(remoteDir, 'keys.json'),
  remoteCertificate: path.join(remoteDir, 'client.pem'), connectionQr: path.join(remoteDir, 'connection.png'),
  storage: path.join(accessDir, 'caddy'), identity: path.join(accessDir, 'identity.json'),
  backendInfo: path.join(runDir, 'backend.json'), group: path.join(runDir, 'access.json'),
};

// Fixed names are selected only through private native administration. Tor keeps
// its existing paths so an upgrade does not replace any enrolled authority.
export const sharingKinds = Object.freeze(['tor', 'cloudflare', 'tailcat', 'tailscale']);
export function sharingScope(kind = 'tor') {
  if (!sharingKinds.includes(kind)) throw Error('Unknown sharing instance');
  if (kind === 'tor') return { kind, accessDir, remoteDir, runDir, paths };
  const directory = path.join(accessDir, 'shares', kind);
  const runtime = path.join(runDir, 'shares', kind);
  const scoped = { ...paths };
  for (const [key, file] of Object.entries(paths)) {
    if (file.startsWith(remoteDir + path.sep)) scoped[key] = path.join(directory, path.relative(remoteDir, file));
    else if (file.startsWith(runDir + path.sep) && !['control', 'backend', 'backendInfo'].includes(key)) scoped[key] = path.join(runtime, path.relative(runDir, file));
    else if (file.startsWith(accessDir + path.sep)) scoped[key] = path.join(directory, path.relative(accessDir, file));
  }
  scoped.share = path.join(directory, 'share.json');
  scoped.storage = path.join(directory, 'caddy');
  scoped.remoteStorage = scoped.storage;
  return { kind, accessDir: directory, remoteDir: directory, runDir: runtime, paths: scoped };
}
