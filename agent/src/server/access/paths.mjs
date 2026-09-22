import path from 'node:path';
import { dataDir } from '../common.mjs';
import { bundledRoot } from '../rpc/runtime.mjs';

export const accessDir = path.join(dataDir, 'access');
export const runDir = path.join(dataDir, 'run');
export const authBin = process.env.BASHKITTEN_AUTH_BIN || path.join(bundledRoot, 'auth/bin');
export const binary = name => path.join(authBin, name);
export const paths = {
  users: path.join(accessDir, 'users.yml'), config: path.join(accessDir, 'authelia.yml'),
  database: path.join(accessDir, 'authelia.sqlite3'), pending: path.join(accessDir, 'enrollment.json'),
  complete: path.join(accessDir, 'initialized.json'), qr: path.join(accessDir, 'totp.png'),
  auth: path.join(runDir, 'auth.sock'), backend: path.join(runDir, 'web.sock'),
  admin: path.join(runDir, 'caddy.sock'), caddy: path.join(accessDir, 'Caddyfile'),
  storage: path.join(accessDir, 'caddy'), identity: path.join(accessDir, 'identity.json'),
  backendInfo: path.join(runDir, 'backend.json'), group: path.join(runDir, 'access.json'),
};
