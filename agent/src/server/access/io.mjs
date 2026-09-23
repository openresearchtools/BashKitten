import http from 'node:http';
import { spawn } from 'node:child_process';

export function unixRequest(socketPath, route, { method = 'GET', headers = {}, body, limit = Infinity, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: route, method, headers }, res => {
      let bytes = 0; const chunks = [];
      res.on('data', value => { bytes += value.length; if (bytes > limit) res.destroy(Error('Local service response exceeded its limit')); else chunks.push(value); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(Error('Local service did not respond')));
    req.end(body);
  });
}

// Commands handling enrollment secrets never inherit the public log stream.
export function command(file, args, { env = process.env, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', failed = false;
    const timer = setTimeout(() => { failed = true; child.kill('SIGKILL'); }, timeout);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code || failed) reject(Error(`${file.split('/').pop()} command failed (${code ?? 'timeout'})`)); else resolve(output); });
  });
}
