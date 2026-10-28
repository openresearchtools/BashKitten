// SPDX-License-Identifier: AGPL-3.0-only
// A browser-owned, authenticated SOCKS carrier to one machine's Unix socket.
// TLS, cookies, Origin and CSRF travel unchanged to the guest's existing Caddy.
import net from 'node:net';
import fs from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { machineControl } from './index.mjs';

export async function browserTransport(id, component) {
  if (component !== undefined) {
    if (component !== 'files') throw Error('Unsupported machine application');
    return applicationTransport(id, component);
  }
  const endpoint = await machineControl('endpoint', { id });
  const url = new URL(endpoint.url);
  if (url.protocol !== 'https:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username || url.password) throw Error('Invalid machine HTTPS endpoint');
  const socket = await fs.stat(endpoint.socketPath);
  if (!socket.isSocket() || socket.uid !== process.getuid()) throw Error('Machine endpoint is not an owned Unix socket');
  const password = randomBytes(32).toString('hex'), sockets = new Set();
  const same = (a,b) => a.length === b.length && timingSafeEqual(a,b);
  const expectedPassword = Buffer.from(password), expectedUser = Buffer.from('machine');
  const server = net.createServer(client => {
    sockets.add(client); client.once('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    client.setTimeout(10000, () => client.destroy());
    let bytes = Buffer.alloc(0), stage = 0, upstream;
    const fail = () => { bytes.fill(0); client.destroy(); upstream?.destroy(); };
    const consume = count => { const result = bytes.subarray(0,count); bytes = bytes.subarray(count); return result; };
    const input = chunk => {
      bytes = Buffer.concat([bytes,chunk]);
      // Only the bounded SOCKS greeting is buffered; TLS subsequently streams.
      if (bytes.length > 1024) return fail();
      for (;;) {
        if (stage === 0) {
          if (bytes.length < 2 || bytes.length < 2 + bytes[1]) return;
          const hello = consume(2 + bytes[1]);
          if (hello[0] !== 5 || !hello.subarray(2).includes(2)) return fail();
          client.write(Buffer.from([5,2])); stage = 1;
        } else if (stage === 1) {
          if (bytes.length < 2 || bytes.length < 3 + bytes[1]) return;
          const end = 3 + bytes[1] + bytes[2 + bytes[1]];
          if (bytes.length < end) return;
          const auth = consume(end), length = auth[1];
          const valid = auth[0] === 1 && same(auth.subarray(2,2+length),expectedUser) && same(auth.subarray(3+length),expectedPassword);
          auth.fill(0); if (!valid) return fail();
          client.write(Buffer.from([1,0])); stage = 2;
        } else {
          if (bytes.length < 5) return;
          const length = bytes[3] === 1 ? 10 : bytes[3] === 3 ? 7 + bytes[4] : 0;
          if (!length) return fail(); if (bytes.length < length) return;
          const request = consume(length);
          const host = request[3] === 1 ? [...request.subarray(4,8)].join('.') : request.subarray(5,length-2).toString('ascii');
          if (request[0] !== 5 || request[1] !== 1 || request[2] !== 0 || host !== url.hostname || request.readUInt16BE(length-2) !== Number(url.port || 443)) return fail();
          client.pause(); client.removeListener('data', input);
          upstream = net.createConnection(endpoint.socketPath);
          sockets.add(upstream); upstream.once('close', () => { sockets.delete(upstream); client.destroy(); });
          client.once('close', () => upstream.destroy()); upstream.once('error', fail);
          upstream.once('connect', () => {
            client.setTimeout(0); client.write(Buffer.from([5,0,0,1,0,0,0,0,0,0]));
            if (bytes.length) upstream.write(bytes); bytes = Buffer.alloc(0);
            client.pipe(upstream); upstream.pipe(client); client.resume();
          });
          return;
        }
      }
    };
    client.on('data', input);
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const close = () => { for (const socket of sockets) socket.destroy(); server.close(); expectedPassword.fill(0); };
  process.stdin.resume(); process.stdin.once('end', close); process.stdin.once('error',close);
  process.once('SIGTERM',close); process.once('SIGINT',close);
  process.stdout.write(JSON.stringify({ ...endpoint, route: {port:server.address().port, username:'machine',password} }) + '\n');
}

// The same browser-owned pipe lifetime exposes only the fixed guest app socket.
// App grants authenticate every HTTP/socket operation; this carrier supplies no
// Agent cookie, management route or transport to another backend.
async function applicationTransport(id, component) {
  const endpoint = await machineControl('application-endpoint', { id, component });
  const stat = await fs.stat(endpoint.socketPath);
  if (!stat.isSocket() || stat.uid !== process.getuid()) throw Error('Machine application endpoint is not an owned Unix socket');
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => socket.destroy()); return socket; };
  const server = net.createServer(client => {
    track(client); client.pause();
    const upstream = track(net.createConnection(endpoint.socketPath));
    client.once('close', () => upstream.destroy()); upstream.once('close', () => client.destroy());
    upstream.once('connect', () => { client.pipe(upstream); upstream.pipe(client); client.resume(); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const close = () => { for (const socket of sockets) socket.destroy(); server.close(); };
  process.stdin.resume(); process.stdin.once('end', close); process.stdin.once('error', close);
  process.once('SIGTERM', close); process.once('SIGINT', close);
  process.stdout.write(JSON.stringify({ machineId: id, component, url: `https://127.0.0.1:${port}`, port }) + '\n');
}
