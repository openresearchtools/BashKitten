/* References project selection; AGPL-3.0-or-later. */
'use strict';
const id = location.hash.slice(1), $ = x => document.getElementById(x);
const send = (action, data={}) => browser.runtime.sendMessage({references:true,id,action,...data});
let context;
const destination = () => ({backendId:$('backend').value,projectId:$('project').value,target:''});
const option = (value, text) => {const node=document.createElement('option');node.value=value;node.textContent=text;return node;};
function selection() {
  $('manager').disabled=!$('project').value;
  $('add').disabled=!$('project').value;
  $('status').textContent=$('project').value ? '' : 'Choose a References project to continue.';
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
$('cancel').onclick=()=>send('cancel');
$('manager').onclick=async()=>{try{await send('confirm',{destination:destination(),openManager:true});}catch(error){$('status').textContent=error.message;}};
document.querySelector('form').onsubmit=async event=>{
  event.preventDefault(); $('add').disabled=true;
  try {await send('confirm',{destination:destination()});}
  catch(error){$('status').textContent=error.message;$('add').disabled=false;}
};
(async()=>{
  try {
    context=await send('context');
    $('manager').hidden=false;
    const backends=context.backends || [context];
    $('backendField').hidden=backends.length===1;
    for(const backend of backends)$('backend').append(option(backend.backendId,backend.name || backend.backendId));
    if(context.previous)$('backend').value=context.previous.backendId;
    projects();
  } catch(error) {$('status').textContent=error.message;$('add').disabled=true;}
})();
