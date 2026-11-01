/* References project selection; AGPL-3.0-or-later. */
'use strict';
const $ = x => document.getElementById(x);
const port = browser.runtime.connect({name:'references-destination'}), requests = new Map();
const send = (action, data={}) => new Promise((resolve,reject) => {
  const requestId=crypto.randomUUID();
  requests.set(requestId,{resolve,reject});
  port.postMessage({requestId,action,...data});
});
port.onMessage.addListener(message => {
  const request=requests.get(message.requestId);
  if(request){requests.delete(message.requestId);message.error?request.reject(new Error(message.error)):request.resolve(message.result);}
  else if(message.error){captureError=message.captureUnavailable?message.error:captureError;$('status').textContent=message.error;if(captureError)$('add').disabled=true;}
});
port.onDisconnect.addListener(() => {
  for(const request of requests.values())request.reject(new Error('References popup closed'));
  requests.clear();
});
let context, captureError='';
const destination = (openManager=false) => ({backendId:$('backend').value,
  ...($('project').value || !openManager ? {projectId:$('project').value} : {}),target:''});
const option = (value, text) => {const node=document.createElement('option');node.value=value;node.textContent=text;return node;};
function selection() {
  $('manager').disabled=!$('backend').value;
  $('add').disabled=!!captureError || !$('backend').value || !$('project').value;
  $('status').textContent=captureError || (!$('backend').value ? 'Choose a backend to continue.'
    : $('project').value ? '' : $('project').options.length
      ? 'Choose a References project to continue.'
      : 'No References projects yet. Open manager to create one.');
}
function projects() {
  const backend=(context.backends || [context]).find(x=>x.backendId===$('backend').value);
  $('project').replaceChildren(...(backend?.projects || []).map(x=>option(x.id,x.name || x.id)));
  const remembered=context.previous?.backendId===$('backend').value ? context.previous.projectId : backend?.selectedProjectId;
  if([...$('project').options].some(x=>x.value===remembered))$('project').value=remembered;
  selection();
}
$('backend').onchange=projects;
$('project').onchange=selection;
const close = async()=>{try{await send('cancel');}catch{}finally{window.close();}};
$('close').onclick=close;
$('cancel').onclick=close;
$('manager').onclick=async()=>{try{await send('confirm',{destination:destination(true),openManager:true});window.close();}catch(error){$('status').textContent=error.message;}};
document.querySelector('form').onsubmit=async event=>{
  event.preventDefault();
  if(!$('backend').value || !$('project').value){selection();return;}
  $('add').disabled=true;
  try {await send('confirm',{destination:destination()});window.close();}
  catch(error){$('status').textContent=error.message;$('add').disabled=false;}
};
(async()=>{
  try {
    context=await send('context');
    captureError=context.captureError || captureError;
    $('manager').hidden=false;
    const backends=context.backends || [context];
    $('backendField').hidden=backends.length===1;
    for(const backend of backends)$('backend').append(option(backend.backendId,backend.name || backend.backendId));
    if(context.previous)$('backend').value=context.previous.backendId;
    projects();
  } catch(error) {$('status').textContent=error.message;$('add').disabled=true;}
})();
document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();void close();}});
