// SPDX-License-Identifier: AGPL-3.0-or-later
// Separate PipeWire graphs and GStreamer loopback bridges adapted from BuzzardOS.
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { locations } from './config.mjs';
import { run } from './process.mjs';
import { readJson } from '../common.mjs';
const ports={guest_audio_output:47130,host_microphone:47131,host_camera:47132};
const classes={guest_audio_output:'Audio/Sink',host_microphone:'Audio/Source',host_camera:'Video/Source'};
const running=new Map();
const pipewireGraph=async()=>JSON.parse((await run('/usr/bin/pw-dump',[],{maxOutputBytes:32*1024*1024,signal:AbortSignal.timeout(5000)})).stdout);
async function trackedMicrophone(pid,target,job) {
  for(const until=Date.now()+5000;Date.now()<until;) {
    job.check();
    const graph=await pipewireGraph();
    const device=graph.find(n=>n.type==='PipeWire:Interface:Node'&&n.info?.props?.['node.name']===target&&n.info?.props?.['media.class']==='Audio/Source');
    if(device&&graph.some(n=> {
      const p=n.info?.props;
      return n.type==='PipeWire:Interface:Node'&&n.info?.state==='running'&&p?.['pulse.corked']!==true&&p?.['pulse.corked']!=='true'&&p?.['client.api']==='pipewire-pulse'&&p?.['application.id']==='com.bashkitten.browser'&&Number(p?.['application.process.id'])===pid&&p?.['target.object']===target&&graph.some(link=>link.type==='PipeWire:Interface:Link'&&link.info?.state==='active'&&Number(link.info?.['output-node-id'])===device.id&&Number(link.info?.['input-node-id'])===n.id);
    }))return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Host microphone did not become a desktop-visible recording stream');
}
export function integrationArguments(config) {
  const args=[],reverse=[];
  for (const gpu of config.integrations.gpus || []) args.push('--gpus',gpu);
  for(const port of config.integrations.ports.filter(p=>p.enabled)) {
    if(port.direction==='host-to-guest')args.push('--publish',`${port.hostAddress.includes(':')?'['+port.hostAddress+']':port.hostAddress}:${port.hostPort}:${port.guestPort}/${port.protocol}`);
    else reverse.push(port.protocol==='tcp'?'-T':'-U',`${port.guestAddress}/${port.guestPort}:${port.hostPort}`);
  }
  if(reverse.length)args.push('--network=pasta:'+reverse.join(','));
  for(const [name,port]of Object.entries(ports))if(config.integrations.media[name].enabled)args.push('--publish',`127.0.0.1::${port}/tcp`);
  if(config.display.mode==='auto'&&config.display.renderNode)args.push('--device',config.display.renderNode);
  return args;
}
export async function mediaDevices() {
  const data=await pipewireGraph(),defaults={};
  for(const obj of data)if(obj.type==='PipeWire:Interface:Metadata'&&obj.props?.['metadata.name']==='default')for(const m of obj.metadata||[]) {
    try {defaults[m.key]=(typeof m.value==='string'?JSON.parse(m.value):m.value)?.name;}catch{}
  }
  return data.filter(obj=>obj.type==='PipeWire:Interface:Node'&&Object.values(classes).includes(obj.info?.props?.['media.class'])).map(obj=>{
    const p=obj.info.props,kind=Object.keys(classes).find(k=>classes[k]===p['media.class']);
    return {kind,node:p['node.name'],serial:String(p['object.serial']),description:p['node.description']||p['node.nick']||p['node.name'],
      default:defaults[kind==='guest_audio_output'?'default.audio.sink':kind==='host_microphone'?'default.audio.source':'default.video.source']===p['node.name'],
      videoDevice:/^\/dev\/video[0-9]+$/.test(p['api.v4l2.path']||'')?p['api.v4l2.path']:null};
  });
}
export async function stopMedia(id) {
  const channels=running.get(id)||[];running.delete(id);
  for(const channel of channels)if(channel.child.exitCode===null&&channel.child.signalCode===null) {
    channel.child.kill('SIGTERM');
    await Promise.race([new Promise(resolve=>channel.child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);
    if(channel.child.exitCode===null&&channel.child.signalCode===null)channel.child.kill('SIGKILL');
  }
}
export const mediaStatus=id=>(running.get(id)||[]).map(c=>({name:c.name,running:c.child.exitCode===null&&c.child.signalCode===null,error:c.error}));
export async function startMedia(config,info,job) {
  await stopMedia(config.id);
  const enabled=Object.entries(config.integrations.media).filter(([,v])=>v.enabled);
  if(!enabled.length)return;
  const devices=await mediaDevices(),channels=[];running.set(config.id,channels);
  try {
    for(const [name,settings]of enabled) {
      let guestReady=false;
      for(const until=Date.now()+10000;Date.now()<until;) {
        job.check();
        const status=await readJson(path.join(locations(config.id).exchange,'integration-status.json'),null);
        if(status?.media?.[name]?.running){guestReady=true;break;}
        if(status?.error)throw Error(status.error);
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!guestReady)throw Error(`Guest ${name} endpoint did not become ready`);
      const mapped=info.NetworkSettings?.Ports?.[`${ports[name]}/tcp`];
      const port=mapped?.find(p=>p.HostIp==='127.0.0.1')?.HostPort;
      if(!/^[0-9]+$/.test(port||''))throw Error(`The ${name} loopback endpoint is unavailable`);
      const candidates=devices.filter(d=>d.kind===name),device=settings.node?candidates.find(d=>d.node===settings.node):(candidates.find(d=>d.default)||candidates[0]);
      if(!device&&!(name==='guest_audio_output'&&!settings.node))throw Error(`Selected ${name} device is unavailable`);
      let args;
      if(name==='guest_audio_output') args=['tcpclientsrc','host=127.0.0.1',`port=${port}`,'!','gdpdepay','!','queue','max-size-buffers=8','leaky=downstream','!','pipewiresink','client-name=BashKitten Guest Audio',...(device?[`target-object=${device.serial}`]:[]),'sync=true'];
      else if(name==='host_microphone')args=['pulsesrc','client-name=BashKitten Microphone',`device=${device.node}`,'do-timestamp=true','buffer-time=40000','latency-time=10000','stream-properties=props,application.id=com.bashkitten.browser,application.name=BashKitten,media.role=communication','!','audioconvert','!','audioresample','!','audio/x-raw,format=S16LE,rate=48000,channels=2','!','tee','name=bk_microphone','bk_microphone.','!','queue','max-size-buffers=8','max-size-bytes=0','max-size-time=0','leaky=downstream','!','fakesink','sync=false','async=false','bk_microphone.','!','queue','max-size-buffers=32','max-size-bytes=0','max-size-time=0','leaky=downstream','!','gdppay','!','tcpclientsink','host=127.0.0.1',`port=${port}`,'sync=false','async=false'];
      else args=[...(device.videoDevice?['v4l2src',`device=${device.videoDevice}`,'do-timestamp=true','!','decodebin']:['pipewiresrc','client-name=BashKitten Host Camera','do-timestamp=true',`target-object=${device.serial}`]),'!','videoconvert','!','videoscale','!','video/x-raw,format=BGRA,width=640,height=480','!','gdppay','!','tcpclientsink','host=127.0.0.1',`port=${port}`,'sync=false','async=false'];
      const file=await fs.open(path.join(locations(config.id).directory,'media.log'),'a',0o600);
      const child=spawn('/usr/bin/gst-launch-1.0',['-q',...args],{stdio:['ignore','ignore',file.fd]});
      const channel={name,child,error:null};channels.push(channel);
      child.on('error',e=>{channel.error=e.message;});
      child.on('exit',(code,signal)=>{channel.error=`Media bridge stopped (${signal||code})`;});
      await Promise.all([file.close(),new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);})]);
      await new Promise(resolve=>setTimeout(resolve,150));job.check();
      if(channel.error)throw Error(channel.error);
      if(name==='host_microphone')await trackedMicrophone(child.pid,device.node,job);
    }
  } catch(error) {await stopMedia(config.id);throw error;}
}
