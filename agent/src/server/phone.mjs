// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir, sessionDir, readJson, writeJson, createJson, privateDir, digest, readMeta, workerRequest } from './common.mjs';
import { savedSession } from './rpc/rpc.mjs';
import { updateNotification } from './rpc/notification-store.mjs';

const root = path.join(dataDir, 'phone');
const modes = ['off', 'call-in', 'messages', 'calls'];
const registrationPath = id => path.join(root, 'registrations', digest(id) + '.json');
const policyPath = id => path.join(sessionDir(id), 'phone.json');
const eventsPath = path.join(dataDir, 'notifications');
async function eventFiles(directory) {
  try { return await fs.readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function projectTitle(meta) { const catalogue=await readJson(path.join(dataDir,'projects.json'),{projects:[],chats:{}}); return catalogue.projects.find(p=>p.id===catalogue.chats[meta.id])?.name || ''; }
const textOf = message => typeof message?.content === 'string' ? message.content : (message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
export async function phonePolicy(sessionId) { return readJson(policyPath(sessionId), { mode: 'off' }); }
export async function savePhonePolicy(sessionId, input, registration) {
  await readMeta(sessionId);
  if (!modes.includes(input?.mode)) throw Error('Unknown Phone delivery mode');
  const previous = await phonePolicy(sessionId);
  if (input.mode !== 'off' && (!registration || registration.revoked)) throw Error('Connect this backend to a phone first');
  const policy = { mode: input.mode, phoneId: registration?.phoneId || previous.phoneId, backendId: registration?.backendId || previous.backendId, generation: registration?.generation || previous.generation, changedAt: Date.now() };
  await writeJson(policyPath(sessionId), policy);
  if (previous.phoneId && (policy.mode !== previous.mode || policy.generation !== previous.generation)) await phoneWithdrawal(previous, sessionId);
  return policy;
}
export async function phoneRegistration(phoneId) { return readJson(registrationPath(phoneId), null); }
export async function registerPhone({ phoneId, backendId, generation, name, defaults = {} }) {
  if (![phoneId, backendId, generation].every(v => typeof v === 'string' && v.length && !/[\x00-\x1f]/.test(v))) throw Error('Invalid phone registration identity');
  const previous = await phoneRegistration(phoneId);
  if (previous && previous.backendId !== backendId && previous.generation === generation) throw Error('A new backend binding requires a new registration generation');
  const value = { phoneId, backendId, generation, name: String(name || 'BashKitten'), defaults: { ordinaryDefault: 'off', callDefault: 'calls', ...previous?.defaults, ...defaults }, enabled: previous?.enabled || { telephony: false, messages: false }, createdAt: previous?.createdAt || Date.now(), revoked: false };
  await writeJson(registrationPath(phoneId), value); await writeJson(path.join(root, 'selected.json'), { phoneId }); return value;
}
export async function phoneStatus() {
  const directory=path.join(root,'registrations');await privateDir(directory);const registrations=[];
  for(const name of await fs.readdir(directory)){
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    const value=await readJson(path.join(directory,name),null);if(!value||value.revoked)continue;
    const seen=await readJson(path.join(root,'seen',name),{});
    registrations.push({name:'Phone',telephony:value.enabled?.telephony===true,messages:value.enabled?.messages===true,lastSeenAt:seen.at||null,connected:Date.now()-(seen.at||0)<60000});
  }
  return {registrations};
}
export async function requirePhoneIdentity(identity){
  const registration=identity&&await phoneRegistration(identity.phoneId);
  if(!registration||registration.revoked||registration.backendId!==identity.backendId||registration.generation!==identity.generation)throw Error('Phone registration changed');
  return registration;
}
export async function selectedPhone() { const selected = await readJson(path.join(root, 'selected.json'), null); return selected ? phoneRegistration(selected.phoneId) : null; }
export async function initializePhonePolicy(sessionId) { const registration = await selectedPhone(); if (registration && !registration.revoked && registration.defaults?.ordinaryDefault !== 'off') await savePhonePolicy(sessionId, { mode: registration.defaults.ordinaryDefault }, registration); }
export async function disablePhone(phoneId) { const value = await phoneRegistration(phoneId); if(value) { await writeJson(registrationPath(phoneId),{...value,enabled:{telephony:false,messages:false}}); await phoneWithdrawal(value, null); } }
export async function revokePhone(phoneId) { const value = await phoneRegistration(phoneId); if (value) await writeJson(registrationPath(phoneId), { ...value, revoked: true }); }
async function authorizedPolicy(meta) {
  const policy = await phonePolicy(meta.id);
  if (policy.mode === 'off' || !policy.phoneId) return null;
  const registration = await phoneRegistration(policy.phoneId);
  if (!registration || registration.revoked || registration.generation !== policy.generation || registration.backendId !== policy.backendId) return null;
  return policy;
}
export async function phoneEvent(meta, identity, input) {
  const policy = await authorizedPolicy(meta);
  if (!policy || !['messages', 'calls'].includes(policy.mode)) return null;
  const registration = await phoneRegistration(policy.phoneId);
  if (!(policy.mode === 'calls' ? registration.enabled?.telephony : registration.enabled?.messages)) return null;
  const key = digest(`${meta.id}:${identity}`);
  return { key, eventId: key, phoneId: policy.phoneId, backendId: policy.backendId, generation: policy.generation,
    sessionId: meta.id, nativeSessionId: meta.piSessionId, title: meta.title, projectTitle: await projectTitle(meta),
    route: policy.mode, createdAt: Date.now(), ...(policy.mode==='calls'?{expiresAt:Date.now()+5*60*1000}:{}), ...input };
}
export async function putPhoneEvent(meta, identity, input) {
  const event = await phoneEvent(meta, identity, input); if (!event) return null;
  // Shared settled-turn/question outbox, independent from ordinary notification eligibility.
  const file = path.join(eventsPath, event.key + '.json');
  await updateNotification(file, current => current ? null : { id: meta.id, turn: input.entryId, state: 'suppressed', phone: event, phoneState: 'pending' });
  return event;
}
export async function pendingPhoneEvents(phoneId) {
  const registration = await phoneRegistration(phoneId);
  if (!registration || registration.revoked) throw Error('Phone is not registered');
  const seenFile=path.join(root,'seen',digest(phoneId)+'.json'),seen=await readJson(seenFile,{});
  if(Date.now()-(seen.at||0)>15000)await writeJson(seenFile,{at:Date.now()});
  const result = [];
  for (const name of await eventFiles(eventsPath)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = path.join(eventsPath, name), record = await readJson(file, null), event = record?.phone;
    if (!event || event.phoneId !== phoneId || record.phoneState !== 'pending') continue;
    const policy = await phonePolicy(event.sessionId);
    if(event.kind==='question'){
      const state=await readJson(path.join(sessionDir(event.sessionId),'questions.json'),{records:[]});
      const question=state.records.find(item=>item.questionId===event.questionId&&item.revision===event.revision);
      if(!question||state.stopped||question.status!=='pending'||question.deadline<=Date.now()){await phoneQuestionResolved(await readMeta(event.sessionId),{...question,questionId:event.questionId,revision:event.revision,status:state.stopped?'cancelled':question?.deadline<=Date.now()?'expired':question?.status||'cancelled'});continue;}
    }
    if (!(event.route === 'calls' ? registration.enabled?.telephony : registration.enabled?.messages) || policy.mode !== event.route || policy.generation !== event.generation || registration.generation !== event.generation) {
      await updateNotification(file, latest => latest?.phoneState === 'pending' ? { ...latest, phoneState: 'withdrawn' } : null); continue;
    }
    result.push(event);
  }
  return result;
}
export async function acknowledgePhoneEvent(phoneId, eventId, status) {
  if (!/^[a-f0-9]{64}$/.test(eventId) || !['notified','ringing','attached','voicemail','duplicate','failed','withdrawn','resolved'].includes(status)) throw Error('Invalid phone delivery acknowledgement');
  await updateNotification(path.join(eventsPath, eventId + '.json'), record => {
    if (!record?.phone || record.phone.phoneId !== phoneId) throw Error('Phone event does not belong to this registration');
    if (record.phoneState !== 'pending') return null;
    return { ...record, phoneState: status, phoneDeliveredAt: Date.now() };
  });
}
export async function phoneQuestionResolved(meta, question) {
  const key = digest(`${meta.id}:question:${question.questionId}:${question.revision}`), file = path.join(eventsPath, key + '.json');
  const record = await updateNotification(file, current => ({ ...current, id:meta.id, phoneState: 'resolved', questionStatus: question.status }));
  if (record?.phone) await createJson(path.join(eventsPath, digest(key + ':resolved') + '.json'), {phoneControlState:'pending', phoneControl:{phoneId:record.phone.phoneId,backendId:record.phone.backendId,generation:record.phone.generation,sessionId:record.phone.sessionId,eventId:digest(key + ':resolved'),resolvedEventId:key,status:question.status}});
}
export async function liveAssistantMessage(meta, message) {
  if (message?.role !== 'assistant' || ['error','aborted'].includes(message.stopReason)) return;
  const text = textOf(message); if (!text.trim()) return;
  const live = await readJson(path.join(sessionDir(meta.id), 'phone-live.json'), null);
  if (!live || live.expiresAt < Date.now()) return;
  const policy = await authorizedPolicy(meta); if (!policy || policy.phoneId !== live.phoneId) return;
  const registration = await phoneRegistration(live.phoneId);
  if (!registration?.enabled?.telephony || registration.generation !== live.generation) return;
  // References only; playback reads native Pi history. No duplicate transcript store.
  await createJson(path.join(root,'live',digest(`${meta.id}:${message.timestamp}:${digest(text)}`)+'.json'),
    { phoneId: live.phoneId, backendId: policy.backendId, generation: policy.generation, sessionId: meta.id,
      nativeSessionId: meta.piSessionId, timestamp: message.timestamp, textDigest: digest(text), expiresAt: live.expiresAt });
}

/** Narrow authenticated phone owner; host supplies existing worker/session operations. */
export class PhoneBackend {
  constructor({ listSessions, createSession, ensureWorker, running }) { Object.assign(this,{listSessions,createSession,ensureWorker,running}); this.operations=Promise.resolve(); }
  async command(action, value, identity) {
    const registration = await phoneRegistration(identity.phoneId);
    if (!registration || registration.revoked || registration.generation !== identity.generation || registration.backendId !== identity.backendId) throw Error('Phone registration is no longer authorized');
    if (value.backendId && value.backendId !== registration.backendId) throw Error('Phone backend identity does not match');
    if (!['phone.settings','phone.reply'].includes(action) && !registration.enabled?.telephony) throw Error('Telephony is off');
    if (action === 'phone.reply' && !(value.source === 'notification' ? registration.enabled?.messages : registration.enabled?.telephony)) throw Error('This Phone delivery route is off');
    if (action === 'phone.chats') {
      const count = Number(value.recent ?? 5); if (!Number.isInteger(count) || count<1 || count>9) throw Error('Choose 1–9 recent chats');
      const result=[]; for(const chat of await this.listSessions()){const policy=await phonePolicy(chat.id);if(policy.mode!=='off'&&policy.phoneId===registration.phoneId&&policy.generation===registration.generation)result.push({...chat,projectTitle:await projectTitle(chat)});}
      return { chats:result.sort((a,b)=>b.modified-a.modified).slice(0,count) };
    }
    if (action === 'phone.settings') {
      const defaults=value.settings||{};
      if(!modes.includes(defaults.ordinaryDefault)||!['call-in','messages','calls'].includes(defaults.callDefault))throw Error('Invalid Phone defaults');
      await writeJson(registrationPath(registration.phoneId),{...registration,enabled:{telephony:defaults.telephony===true,messages:defaults.messages===true},defaults:{ordinaryDefault:defaults.ordinaryDefault,callDefault:defaults.callDefault}});return {ok:true};
    }
    if (action === 'phone.new') return this.serial(async()=>{
      const id=String(value.creationId||'');if(!id)throw Error('Call creation identity is missing');
      const file=path.join(root,'created',digest(registration.phoneId+':'+id)+'.json'), existing=await readJson(file,null);
      if(existing)return existing;
      const mode=registration.defaults.callDefault; if(!['call-in','messages','calls'].includes(mode))throw Error('Invalid call chat default');
      const creation = digest(registration.phoneId + ':' + id);
      let meta;
      for (const item of await this.listSessions()) { const saved = await readMeta(item.id); if (saved.phoneCreation === creation) { meta = saved; break; } }
      meta ||= await this.createSession({}, { phoneCreation: creation });
      await savePhonePolicy(meta.id,{mode},registration);
      const result={sessionId:meta.id};await writeJson(file,result);return result;
    });
    const sessionId=String(value.sessionId||''),meta=await readMeta(sessionId),policy=await phonePolicy(sessionId);
    if(policy.mode==='off'||policy.phoneId!==registration.phoneId||policy.generation!==registration.generation)throw Error('This chat is not enabled for the phone');
    if(action==='phone.begin'){
      const running = await this.running(sessionId);
      const state = running?.data || await readJson(path.join(sessionDir(sessionId),'questions.json'), { generation: 0 });
      return { stopGeneration: state.stopGeneration ?? state.generation ?? 0, nativeSessionId: meta.piSessionId || null };
    }
    if(action==='phone.last'){
      const history=await savedSession(meta);const entries=history?.getBranch()||[];
      const entry=entries.findLast(e=>e.type==='message'&&e.message?.role==='assistant'&&!['toolUse','aborted','error'].includes(e.message.stopReason));
      return {text:entry?textOf(entry.message):'',entryId:entry?.id};
    }
    if(action==='phone.live')return this.serial(async()=>{
      const file=path.join(sessionDir(sessionId),'phone-live.json');
      if(value.enabled){
        const current=await requirePhoneIdentity(identity),policy=await authorizedPolicy(meta);
        if(!current.enabled?.telephony||!policy||policy.phoneId!==current.phoneId||policy.generation!==current.generation)throw Error('Live listening is no longer authorized');
        await writeJson(file,{phoneId:current.phoneId,generation:current.generation,callId:value.callId,menuRevision:value.menuRevision,expiresAt:Date.now()+60000});
      }else {
        const current=await readJson(file,null);
        if(current?.phoneId===registration.phoneId&&current.callId===value.callId&&current.menuRevision===value.menuRevision)await fs.rm(file,{force:true});
      }
      return {enabled:Boolean(value.enabled)};
    });
    if(action==='phone.reply')return this.serial(async()=>{
      const text=String(value.text||'').trim(),delivery=String(value.deliveryId||'');if(!text||!delivery)throw Error('Missing reply text or submission identity');
      const current=await phonePolicy(sessionId);if(current.mode==='off'||current.generation!==registration.generation)throw Error('Phone access changed before Send');
      if(value.nativeSessionId && value.nativeSessionId !== (await readMeta(sessionId)).piSessionId)throw Error('The original native Pi session changed; open the chat to review this reply');
      if((await readJson(path.join(sessionDir(sessionId),'lifecycle.json'),{})).stopped)throw Error('Pi is stopped. Resume it in the app before replying.');
      await this.ensureWorker(sessionId);
      const phoneAuthorization = { phoneId: registration.phoneId, backendId: registration.backendId, generation: registration.generation, source: value.source };
      if(value.questionId)return workerRequest(sessionId,'/questions/answer',{questionId:value.questionId,revision:value.revision,source:value.source,deliveryId:delivery,text,lateConfirmed:value.lateConfirmed===true,phoneAuthorization});
      const stopGeneration = value.source === 'notification' ? (await workerRequest(sessionId, '/status')).data.stopGeneration : value.stopGeneration;
      if (!Number.isSafeInteger(stopGeneration)) throw Error('Call submission has no Stop generation');
      const agentDelivery='phone:'+digest(registration.phoneId+':'+sessionId+':'+delivery);
      const saved=await readMeta(sessionId);
      if((saved.messages||[]).some(m=>m.agentDelivery===agentDelivery))return {deliveryStatus:'accepted',duplicate:true};
      const accepted = await workerRequest(sessionId,'/message',{text,wire:text,attachments:[],phoneDelivery:true,phoneAuthorization,stopGeneration,agentSource:{kind:'phone',source:value.source,phoneId:registration.phoneId},agentDelivery,kind:(await this.running(sessionId))?.data?.busy?'steer':'queue'});
      return {deliveryStatus: accepted.held ? 'held' : 'accepted'};
    });
    throw Error('Unknown Phone operation');
  }
  serial(work){const result=this.operations.then(work);this.operations=result.catch(()=>{});return result;}
}

export async function pendingPhoneLive(phoneId) {
  const directory=path.join(root,'live');const result=[];
  for(const name of await eventFiles(directory)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const file=path.join(directory,name),value=await readJson(file,null);if(!value||value.phoneId!==phoneId)continue;if(value.expiresAt<Date.now()){await fs.rm(file,{force:true});continue;}
    const meta=await readMeta(value.sessionId),policy=await authorizedPolicy(meta);if(!policy||policy.generation!==value.generation){await fs.rm(file,{force:true});continue;}
    const history=await savedSession(meta),entries=history?.getEntries()||[],entryOrder=entries.findIndex(e=>e.type==='message'&&e.message?.role==='assistant'&&e.message.timestamp===value.timestamp&&digest(textOf(e.message))===value.textDigest);if(entryOrder<0)continue;
    const entry=entries[entryOrder];result.push({...value,key:name.slice(0,-5),entryId:entry.id,text:textOf(entry.message),title:meta.title,entryOrder});
  }
  // Hash-named outbox files do not carry playback order. Equal timestamps use
  // the native append-only history position, without creating another cursor.
  return result.sort((a,b)=>a.timestamp-b.timestamp||a.sessionId.localeCompare(b.sessionId)||a.entryOrder-b.entryOrder).map(({entryOrder,...value})=>value);
}
export async function acknowledgePhoneLive(phoneId,key){if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid live event');const file=path.join(root,'live',key+'.json'),value=await readJson(file,null);if(value?.phoneId===phoneId)await fs.rm(file,{force:true});}

export async function validatePhoneDelivery(sessionId, auth) {
  if (!auth || !['notification','call','voicemail'].includes(auth.source) || ![auth.phoneId,auth.backendId,auth.generation].every(value => typeof value==='string' && value.length)) return false;
  const policy=await phonePolicy(sessionId), registration=await phoneRegistration(auth.phoneId);
  return !!registration && !registration.revoked && registration.generation===auth.generation && registration.backendId===auth.backendId &&
    policy.phoneId===auth.phoneId && policy.generation===auth.generation && policy.backendId===auth.backendId &&
    (auth.source==='notification' ? policy.mode==='messages' && registration.enabled?.messages : policy.mode!=='off' && registration.enabled?.telephony);
}
async function phoneWithdrawal(policy, sessionId) {
  if(!policy.phoneId)return;
  const eventId=digest(`phone-policy:${policy.phoneId}:${sessionId || ''}:${randomUUID()}`);
  await createJson(path.join(eventsPath,eventId+'.json'),{phoneControlState:'pending',phoneControl:{eventId,phoneId:policy.phoneId,backendId:policy.backendId,generation:policy.generation,sessionId}});
}
export async function pendingPhoneUpdates(phoneId){const result=[];for(const name of await eventFiles(eventsPath)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const value=await readJson(path.join(eventsPath,name),null);if(value?.phoneControlState==='pending'&&value.phoneControl?.phoneId===phoneId)result.push(value.phoneControl);}return result;}
export async function acknowledgePhoneUpdate(phoneId,eventId){if(!/^[a-f0-9]{64}$/.test(eventId))throw Error('Invalid phone update');const file=path.join(eventsPath,eventId+'.json'),value=await readJson(file,null);if(value?.phoneControl?.phoneId!==phoneId)throw Error('Phone update registration changed');await writeJson(file,{...value,phoneControlState:'sent'});}
