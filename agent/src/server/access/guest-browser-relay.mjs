// SPDX-License-Identifier: AGPL-3.0-only
// Guest chrome owns this private stdio relay. Commands still use BrowserControl;
// a service-state change only wakes native reauthorization, never grants access.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { dataDir, writeJson } from '../common.mjs';
import { controlRequest } from '../control.mjs';
import { unixRequest } from './io.mjs';
import { processStart, serverFile } from '../instance.mjs';

process.umask(0o077);
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
const iterator=lines[Symbol.asyncIterator]();
const file=path.join(dataDir,'run','guest-browser-status.json');
const shutdown=new AbortController();
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
let active, watcher, refreshTimer, candidate, revision=0, wake;
async function request(state,operation,body,signal=state.abort.signal){
  const {link}=state;
  const response=await unixRequest(link.socket,'/api/native-guest-browser/'+operation,{method:'POST',headers:{host:new URL(link.origin).host,authorization:'Bearer '+link.credential,'content-type':'application/json'},body:JSON.stringify(body),timeout:operation==='poll'?30000:10000,signal});
  const value=JSON.parse(response.body);if(response.status!==200)throw Error(value.error||'Guest browser channel closed');return value;
}
async function connection(link,registration){
  const state={link,abort:new AbortController(),pending:new Map()};active=state;
  const stopped=()=>state.abort.abort();shutdown.signal.addEventListener('abort',stopped,{once:true});
  try {
    const opened=await request(state,'open',{clientId:registration.clientId||randomUUID(),name:'Container browser',platform:'linux',capabilities:registration.capabilities});
    state.channelId=opened.channelId;if(!state.channelId)throw Error('Guest browser channel unavailable');
    await writeJson(file,{connected:true,pid:registration.browserPid,error:null});send({ready:true});
    const cancelled=new Promise((_,reject)=>state.abort.signal.addEventListener('abort',()=>reject(Error('Guest browser connection changed')),{once:true}));
    const poll=(async()=>{while(!state.abort.signal.aborted){
      if(await processStart(link.browserPid)!==link.started)throw Error('Guest browser owner exited');
      const response=await request(state,'poll',{channelId:state.channelId});
      if(response.closed)throw Error('Guest browser channel closed');
      if(!Array.isArray(response.commands)||response.commands.length>64)throw Error('Invalid guest browser command batch');
      await Promise.all(response.commands.map(async command=>{
        if(typeof command.id!=='string'||state.pending.has(command.id))throw Error('Invalid guest browser command identity');
        const reply=new Promise((resolve,reject)=>state.pending.set(command.id,{resolve,reject}));send(command);
        const value=await reply;await request(state,'result',{channelId:state.channelId,id:command.id,...(value.error?{error:value.error}:{result:value.result})});
      }));
    }})();
    await Promise.race([poll,cancelled]);
  } finally {
    state.abort.abort();for(const entry of state.pending.values())entry.reject(Error('Guest browser connection ended'));state.pending.clear();
    if(state.channelId)await request(state,'close',{channelId:state.channelId},AbortSignal.timeout(1500)).catch(()=>{});
    if(active===state)active=null;
    shutdown.signal.removeEventListener('abort',stopped);
  }
}
async function run(){
  const first=await iterator.next();if(first.done)throw Error('Missing native guest browser registration');
  const registration=JSON.parse(first.value);
  if(registration.version!==1||registration.browserPid!==process.ppid)throw Error('Guest browser parent changed');
  let refreshTask=Promise.resolve();
  function refresh(){
    refreshTask=refreshTask.catch(()=>{}).then(async()=>{
      if(shutdown.signal.aborted)return;
      // The file contains no issuing authority for this path. Only the live
      // controller validates our parent/profile and returns a fresh private link.
      const next=await controlRequest('guest-browser-connect',{browserPid:registration.browserPid,helperPid:process.pid,profile:registration.profile});
      const current=active?.link||candidate;
      if(current?.credential===next.credential&&current.socket===next.socket)return;
      candidate=next;revision++;active?.abort.abort();wake?.();
    }).catch(async error=>{
      if(!active&&!shutdown.signal.aborted)await writeJson(file,{connected:false,pid:registration.browserPid,error:error.message||'Guest browser authorization failed'});
    });
    return refreshTask;
  }
  watcher=fs.watch(dataDir,(_event,name)=>{
    if(name!==path.basename(serverFile))return;
    clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,100);
  });
  watcher.on('error',()=>shutdown.abort());
  await refresh();
  const input=(async()=>{for await(const line of{[Symbol.asyncIterator]:()=>iterator}){
    const value=JSON.parse(line);const pending=active?.pending.get(value.id);
    // An already dispatched command can finish after service revocation. Its
    // response has no destination and is never carried into the new channel.
    if(pending){active.pending.delete(value.id);pending.resolve(value);}
  }throw Error('Native guest browser closed');})();
  const connect=(async()=>{let consumed=0;while(!shutdown.signal.aborted){
    if(!candidate||revision===consumed)await new Promise((resolve,reject)=>{
      const stop=()=>{wake=null;reject(Error('Guest browser stopped'));};
      wake=()=>{shutdown.signal.removeEventListener('abort',stop);wake=null;resolve();};
      shutdown.signal.addEventListener('abort',stop,{once:true});
      if(shutdown.signal.aborted)stop();
    });
    if(!candidate)continue;
    const selected=candidate;consumed=revision;candidate=null;
    try{await connection(selected,registration);}catch{}
    await writeJson(file,{connected:false,pid:registration.browserPid,error:'Guest browser control disconnected; awaiting owned service restart'});
    send({disconnected:true});
  }})();
  await Promise.race([input,connect]);
}
for(const signal of['SIGINT','SIGTERM'])process.once(signal,()=>shutdown.abort());
try{await run();}catch{send({closed:true});process.exitCode=1;}
finally{
  shutdown.abort();watcher?.close();clearTimeout(refreshTimer);
  await writeJson(file,{connected:false,pid:process.ppid,error:'Guest browser control disconnected'}).catch(()=>{});
  lines.close();process.stdin.destroy();
}
