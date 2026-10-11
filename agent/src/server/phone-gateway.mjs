// SPDX-License-Identifier: AGPL-3.0-only
import net from 'node:net';
import { watch } from 'node:fs';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { dataDir, privateDir } from './common.mjs';

const signature=(key,value)=>createHmac('sha256',key).update(`${value.id}\n${value.nonce}\n${value.time}\n${value.payload}`).digest('hex');
const proof=key=>createHmac('sha256',key).update('bashkitten-phone-frame-v1').digest();
function seal(key,payload,id=randomUUID(),nonce=randomUUID()){const value={id,nonce,time:Date.now(),payload:JSON.stringify(payload)};return {...value,mac:signature(key,value)};}
function open(key,value){
  if(!value||typeof value.payload!=='string'||!Number.isSafeInteger(value.time)||Math.abs(Date.now()-value.time)>30000||!/^[a-f0-9]{64}$/.test(value.mac||''))throw Error('Expired phone gateway message');
  if(!timingSafeEqual(Buffer.from(signature(key,value),'hex'),Buffer.from(value.mac,'hex')))throw Error('Phone gateway authentication failed');
  return JSON.parse(value.payload);
}
function write(socket,key,value){const data=Buffer.from(JSON.stringify(value)),prefix=Buffer.alloc(4);prefix.writeUInt32BE(data.length);socket.end(Buffer.concat([proof(key),prefix,data]));}
function read(socket,key){return new Promise((resolve,reject)=>{
  let buffer=Buffer.alloc(0),length=null,authenticated=false,finished=false;
  const fail=error=>{if(!finished){finished=true;reject(error);}};
  socket.on('data',chunk=>{
    if(finished)return;buffer=Buffer.concat([buffer,chunk]);
    if(!authenticated&&buffer.length>=32){if(!timingSafeEqual(buffer.subarray(0,32),proof(key))){socket.destroy(Error('Unauthorized phone peer'));return;}buffer=buffer.subarray(32);authenticated=true;}
    if(authenticated&&length===null&&buffer.length>=4){length=buffer.readUInt32BE(0);if(length===0){socket.destroy(Error('Empty phone frame'));return;}}
    if(length!==null&&buffer.length>=length+4){if(buffer.length!==length+4){socket.destroy(Error('Multiple phone frames'));return;}try{const value=JSON.parse(buffer.subarray(4).toString());finished=true;resolve(value);}catch(error){fail(error);}finally{buffer.fill(0);}}
  });
  socket.on('error',fail);socket.on('end',()=>{if(!finished)fail(Error('Interrupted phone message'));});socket.on('close',()=>fail(Error('Phone connection closed')));
});}
export class PhoneGateway {
  constructor({dispatch,speech}){this.dispatch=dispatch;this.speech=speech;this.epoch=0;this.pending=new Map();this.sockets=new Set();this.delivery=Promise.resolve();}
  current(context){return this.context===context&&context.epoch===this.epoch;}
  require(context){if(!this.current(context))throw Error('Phone gateway generation changed');}
  async connect(value){
    await this.close();
    if(!Number.isInteger(value.port)||value.port<1||value.port>65535||!/^[a-f0-9]{64}$/.test(value.key||'')||typeof value.phoneId!=='string'||!value.phoneId)throw Error('Invalid private phone gateway bootstrap');
    const context={key:Buffer.from(value.key,'hex'),nativePort:value.port,epoch:this.epoch,seen:new Map(),identity:{phoneId:value.phoneId,backendId:'local',generation:value.generation}};
    this.context=context;
    this.server=net.createServer({allowHalfOpen:true},socket=>{
      this.sockets.add(socket);socket.on('close',()=>this.sockets.delete(socket));socket.setTimeout(30000,()=>socket.destroy(Error('Phone handshake timed out')));
      read(socket,context.key).then(async envelope=>{
        this.require(context);const request=open(context.key,envelope);for(const [key,at]of context.seen)if(at<Date.now()-30000)context.seen.delete(key);
        if(context.seen.has(envelope.id+':'+envelope.nonce))throw Error('Replayed phone request');context.seen.set(envelope.id+':'+envelope.nonce,Date.now());socket.setTimeout(0);
        const requestId=request.value?.requestId||request.value?.captureId;
        const cancelled=()=>{if(requestId&&this.current(context)){this.pending.get(requestId)?.abort();this.speech.cancel(requestId);}};
        socket.once('close',cancelled);
        try{const result=await this.handle(context,request);this.require(context);socket.off('close',cancelled);write(socket,context.key,seal(context.key,{ok:true,...result},envelope.id,envelope.nonce));}
        catch(error){socket.off('close',cancelled);if(this.current(context)&&!socket.destroyed)write(socket,context.key,seal(context.key,{ok:false,error:error.message},envelope.id,envelope.nonce));else socket.destroy();}
      }).catch(()=>socket.destroy());
    });
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});this.require(context);
    const native=await this.native(context,'ready',{});this.require(context);if(!native.ok)throw Error('Phone native owner did not authenticate readiness');
    await this.dispatch('phone.register',{...context.identity,name:'Local'},context.identity);this.require(context);
    for(const directory of [path.join(dataDir,'notifications'),path.join(dataDir,'phone/live')]){
      await privateDir(directory);this.require(context);
      const observer=watch(directory,(_event,name)=>{
        // Atomic writes publish a final JSON filename. Directory permission and
        // temporary-file changes do not represent a new outbox entry.
        if(name===null||/^[a-f0-9]{64}\.json$/.test(String(name)))this.flush(context);
      });
      observer.on('error',()=>{});(context.watchers||=[]).push(observer);
    }
    this.flush(context);return {port:this.server.address().port,generation:value.generation,backendId:'local'};
  }
  async handle(context,request){
    this.require(context);const {action,value={},audio}=request;
    if(typeof action!=='string')throw Error('Missing phone action');
    if(action==='phone.cancel'){this.pending.get(value.requestId)?.abort();await this.speech.request('phone.speech.cancel',value);this.require(context);return {result:{ok:true}};}
    if(action.startsWith('phone.speech.')){
      if(audio!==undefined){const controller=new AbortController(),id=value.requestId||value.captureId;this.pending.set(id,controller);let input=Buffer.from(audio,'base64'),output;try{output=await this.speech.audio(action,input,value,controller.signal);this.require(context);return {audio:output.toString('base64')};}finally{input.fill(0);output?.fill(0);if(this.pending.get(id)===controller)this.pending.delete(id);}}
      const result=await this.speech.request(action,value);this.require(context);return {result};
    }
    if(!['phone.settings','phone.chats','phone.new','phone.begin','phone.last','phone.live','phone.reply'].includes(action))throw Error('Unsupported private phone operation');
    const result=await this.dispatch(action,value,context.identity);this.require(context);return {result};
  }
  async native(context,action,value){
    this.require(context);const envelope=seal(context.key,{action,value});
    const socket=net.createConnection({host:'127.0.0.1',port:context.nativePort,allowHalfOpen:true});this.sockets.add(socket);socket.on('close',()=>this.sockets.delete(socket));socket.setTimeout(30000,()=>socket.destroy(Error('Phone native owner did not respond')));
    const response=read(socket,context.key);socket.once('connect',()=>write(socket,context.key,envelope));
    const reply=await response;this.require(context);if(reply.id!==envelope.id||reply.nonce!==envelope.nonce)throw Error('Phone response identity mismatch');return open(context.key,reply);
  }
  flush(context){
    if(!this.current(context))return;
    context.dirty=true;
    if(context.flushing)return;
    context.flushing=true;
    const run=this.delivery.then(async()=>{
      // Many filesystem notifications can describe one atomic write. Retain a
      // single rescan rather than an unbounded queue of delivery promises.
      while(this.current(context)&&context.dirty){
        context.dirty=false;
        const result=await this.dispatch('phone.pending',{},context.identity);this.require(context);
        for(const update of result.updates||[]){const answer=await this.native(context,update.resolvedEventId?'resolved':'withdraw',update);this.require(context);if(!answer.ok)throw Error(answer.error||'Phone state update failed');await this.dispatch('phone.update-ack',{eventId:update.eventId},context.identity);this.require(context);}
        for(const message of result.live||[]){await this.native(context,'live',message);this.require(context);await this.dispatch('phone.live-ack',{key:message.key},context.identity);this.require(context);}
        for(const event of result.events||[]){const answer=await this.native(context,'deliver',event);this.require(context);await this.dispatch('phone.ack',{eventId:event.eventId,state:answer.ok?answer.result.state:'failed'},context.identity);this.require(context);}
      }
    });
    this.delivery=run.catch(()=>{}).finally(()=>{
      context.flushing=false;
      if(this.current(context)&&context.dirty)this.flush(context);
    });
  }
  async disable(){const context=this.context;try{if(context){await this.dispatch('phone.disable',{},context.identity);this.require(context);}}finally{await this.close();}}
  async close(){
    const old=this.context;this.context=null;this.epoch++;if(old)old.dirty=false;for(const observer of old?.watchers||[])observer.close();
    for(const controller of this.pending.values())controller.abort();this.pending.clear();for(const socket of this.sockets)socket.destroy();this.sockets.clear();
    if(this.server){this.server.close();this.server=null;}this.speech.close();old?.key.fill(0);
  }
}
