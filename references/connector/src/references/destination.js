/* References destination selection; AGPL-3.0-or-later. */
'use strict';
const id = location.hash.slice(1), $ = x => document.getElementById(x);
const send = (action, data={}) => browser.runtime.sendMessage({references:true,id,action,...data});
let context, generation=0, start=0, nextStart=null, timer, parents=[];
const destination = () => ({backendId:$('backend').value,projectId:$('project').value,target:$('collection').value});
const option = (value, text) => {const node=document.createElement('option');node.value=value;node.textContent=text;return node;};
async function collections() {
  const version=++generation;
  $('add').disabled=true; $('status').textContent='Loading collections…';
  try {
    const result=await send('collections',{destination:destination(),q:$('search').value,start,parent:parents.at(-1)?.id || null});
    if(version!==generation)return;
    const targets=result.targets || result.collections || [];
    $('collection').replaceChildren(option(parents.at(-1)?.id || '', parents.at(-1)?.name || 'Library'));
    $('path').textContent=['Library',...parents.map(x=>x.name)].join(' / ');
    $('up').disabled=!parents.length;
    for(const target of targets) {
      const value=target.id || target.key;
      if(value && !String(value).startsWith('L')) $('collection').append(option(value,target.name || target.label || value));
    }
    nextStart=result.nextStart ?? (targets.length===100 ? start+100 : null);
    $('previous').disabled=start===0; $('next').disabled=nextStart===null;
    $('add').disabled=false; $('status').textContent='';
  } catch(error) {if(version===generation)$('status').textContent=error.message;}
}
function projects() {
  const backend=(context.backends || [context]).find(x=>x.backendId===$('backend').value);
  $('project').replaceChildren(...(backend?.projects || []).map(x=>option(x.id,x.name || x.id)));
  const remembered=context.previous?.backendId===$('backend').value ? context.previous.projectId : backend?.selectedProjectId;
  if([...$('project').options].some(x=>x.value===remembered))$('project').value=remembered;
  parents=[]; start=0; collections();
}
$('backend').onchange=projects;
$('project').onchange=()=>{parents=[];start=0;collections();};
$('search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{start=0;collections();},200);};
$('previous').onclick=()=>{start=Math.max(0,start-100);collections();};
$('next').onclick=()=>{if(nextStart!==null){start=nextStart;collections();}};
$('up').onclick=()=>{parents.pop();start=0;collections();};
$('open').onclick=()=>{const selected=$('collection').selectedOptions[0];if(selected?.value && selected.value!==parents.at(-1)?.id){parents.push({id:selected.value,name:selected.textContent});start=0;collections();}};
$('cancel').onclick=()=>send('cancel');
document.querySelector('form').onsubmit=async event=>{event.preventDefault();$('add').disabled=true;try{await send('confirm',{destination:destination()});}catch(error){$('status').textContent=error.message;}};
(async()=>{try{context=await send('context');for(const backend of context.backends || [context])$('backend').append(option(backend.backendId,backend.name || backend.backendId));if(context.previous)$('backend').value=context.previous.backendId;projects();}catch(error){$('status').textContent=error.message;$('add').disabled=true;}})();
