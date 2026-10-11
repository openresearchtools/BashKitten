// SPDX-License-Identifier: AGPL-3.0-only
// Private TLS transport only. Guest Caddy retains its own TLS/auth/CSRF context.
import net from 'node:net';
import fs from 'node:fs/promises';
import { socketRequest } from '/usr/lib/bashkitten/src/server/common.mjs';
const socket='/run/bashkitten-host/agent-https.sock';
await fs.rm(socket,{force:true});
const clients=new Set();
const server=net.createServer(async client=>{
  clients.add(client);client.on('error',()=>{});client.once('close',()=>clients.delete(client));
  try{
    const session=await socketRequest('/run/bashkitten-host/agent/control.sock','/local-session',{},5000);
    const url=new URL(session.url);
    if(url.protocol!=='https:'||url.hostname!=='127.0.0.1'||!url.port)throw Error('Invalid guest local listener');
    if(client.destroyed)return;
    const upstream=net.createConnection({host:'127.0.0.1',port:Number(url.port)});
    upstream.on('error',()=>client.destroy());client.once('close',()=>upstream.destroy());
    client.pipe(upstream).pipe(client);
  }catch{client.destroy();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
await fs.chmod(socket,0o600);
process.on('SIGTERM',()=>{for(const client of clients)client.destroy();server.close(()=>process.exit(0));});
