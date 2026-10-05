import path from 'node:path';
import { dataDir } from '../common.mjs';
import { bundledRoot } from '../rpc/runtime.mjs';

export const accessDir = path.join(dataDir, 'access');
// Remote reset may remove this whole directory. Local CA/session keys stay outside it.
export const remoteDir = path.join(accessDir, 'remote');
export const runDir = path.join(dataDir, 'run');
export const authBin = process.env.BASHKITTEN_AUTH_BIN || path.join(bundledRoot, 'auth/bin');
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
