/* References project selection; AGPL-3.0-or-later. */
'use strict';
const id = location.hash.slice(1), $ = x => document.getElementById(x);
const send = (action, data={}) => browser.runtime.sendMessage({references:true,id,action,...data});
let context;
const destination = (openManager=false) => ({backendId:$('backend').value,
  ...($('project').value || !openManager ? {projectId:$('project').value} : {}),target:''});
const option = (value, text) => {const node=document.createElement('option');node.value=value;node.textContent=text;return node;};
function selection() {
  $('manager').disabled=!$('backend').value;
  $('add').disabled=!$('backend').value || !$('project').value;
  $('status').textContent=!$('backend').value ? 'Choose a backend to continue.'
    : $('project').value ? '' : $('project').options.length
      ? 'Choose a References project to continue.'
      : 'No References projects yet. Open manager to create one.';
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
$('manager').onclick=async()=>{try{await send('confirm',{destination:destination(true),openManager:true});}catch(error){$('status').textContent=error.message;}};
document.querySelector('form').onsubmit=async event=>{
  event.preventDefault();
  if(!$('backend').value || !$('project').value){selection();return;}
  $('add').disabled=true;
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
