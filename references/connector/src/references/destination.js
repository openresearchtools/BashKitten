/* References destination selection; AGPL-3.0-or-later. */
'use strict';
const id = location.hash.slice(1), $ = x => document.getElementById(x);
const send = (action, data={}) => browser.runtime.sendMessage({references:true,id,action,...data});
let context, generation=0, start=0, nextStart=null, timer, parents=[], pages=[];
const destination = () => ({backendId:$('backend').value,projectId:$('project').value,target:$('collection').value});
const option = (value, text) => {const node=document.createElement('option');node.value=value;node.textContent=text;return node;};
async function collections() {
  const version=++generation;
  $('manager').disabled=!$('project').value;
  if(context?.mode==='open'){$('add').disabled=!$('project').value;$('status').textContent='';return;}
  $('add').disabled=true; $('previous').disabled=true; $('next').disabled=true; $('status').textContent='Loading collections…';
  try {
    const result=await send('collections',{destination:destination(),q:$('search').value,start,parent:parents.at(-1)?.id || null});
    if(version!==generation)return;
    const targets=result.targets || result.collections || [];
    $('collection').replaceChildren(option(parents.at(-1)?.id || '', parents.at(-1)?.name || 'Library'));
    $('path').textContent=['Library',...parents.map(x=>x.name)].join(' / ');
    $('up').disabled=!parents.length;
    for(const target of targets) {
      const value=target.id || target.key;
      if(value && target.kind !== 'library' && value !== 'L'+$('project').value) $('collection').append(option(value,target.name || target.label || value));
    }
    nextStart=result.nextStart ?? null;
    $('previous').disabled=!pages.length; $('next').disabled=nextStart===null;
    $('add').disabled=false; $('status').textContent='';
  } catch(error) {if(version===generation)$('status').textContent=error.message;}
}
function projects() {
  const backend=(context.backends || [context]).find(x=>x.backendId===$('backend').value);
  $('project').replaceChildren(...(backend?.projects || []).map(x=>option(x.id,x.name || x.id)));
  const remembered=context.previous?.backendId===$('backend').value ? context.previous.projectId : backend?.selectedProjectId;
  if([...$('project').options].some(x=>x.value===remembered))$('project').value=remembered;
  parents=[]; pages=[]; start=0; collections();
}
$('backend').onchange=projects;
$('project').onchange=()=>{parents=[];pages=[];start=0;collections();};
$('search').oninput=()=>{++generation;$('add').disabled=true;clearTimeout(timer);timer=setTimeout(()=>{pages=[];start=0;collections();},200);};
$('previous').onclick=()=>{if(pages.length){start=pages.pop();collections();}};
$('next').onclick=()=>{if(nextStart!==null){pages.push(start);start=nextStart;collections();}};
$('up').onclick=()=>{parents.pop();pages=[];start=0;collections();};
$('open').onclick=()=>{const selected=$('collection').selectedOptions[0];if(selected?.value && selected.value!==parents.at(-1)?.id){parents.push({id:selected.value,name:selected.textContent});pages=[];start=0;collections();}};
$('cancel').onclick=()=>send('cancel');
$('manager').onclick=async()=>{try{await send('confirm',{destination:destination(),openManager:true});}catch(error){$('status').textContent=error.message;}};
document.querySelector('form').onsubmit=async event=>{event.preventDefault();$('add').disabled=true;try{await send('confirm',{destination:destination()});}catch(error){$('status').textContent=error.message;}};
(async()=>{try{context=await send('context');if(context.mode==='retarget'){$('backend').disabled=true;$('project').disabled=true;$('manager').hidden=true;document.querySelector('h1').textContent='Change collection';document.querySelector('main>p').textContent='Choose a collection in this capture’s project library.';$('add').textContent='Select';}if(context.mode==='open'){$('manager').hidden=true;document.querySelector('main>p').textContent='Choose the project library to open.';document.title='References';document.querySelector('h1').textContent='Open References';$('add').textContent='Open manager';for(const element of [$('search').closest('label'),$('collection').closest('label'),$('path'),...document.querySelectorAll('.pages')])element.hidden=true;}for(const backend of context.backends || [context])$('backend').append(option(backend.backendId,backend.name || backend.backendId));if(context.previous)$('backend').value=context.previous.backendId;projects();}catch(error){$('status').textContent=error.message;$('add').disabled=true;}})();
