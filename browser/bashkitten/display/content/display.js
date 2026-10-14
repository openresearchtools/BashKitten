/* SPDX-License-Identifier: AGPL-3.0-only */
"use strict";
const { BashKittenDisplay } = ChromeUtils.importESModule("resource:///modules/BashKittenDisplay.sys.mjs");
const surface = document.getElementById("surface"), status = document.getElementById("status");
async function initialize() {
let receiver, generation = 1, resizeFrame = 0, lastSize = "", closed = false;
const initial = await BashKittenDisplay.prepare(document);
let state = initial.state, serviceRunning = initial.running, interactive = initial.interactive, attachment = 0, clipboardEpoch = 0;
let changing = false, rendererClosed = Promise.resolve(), resolveRendererClosed;
const pointerIds = new Set();
// DOM code maps to the kernel evdev codes used by wl_keyboard. Layout and
// modifiers are resolved by the private XKB map, never text synthesized by JS.
const keys = { Escape:1, Digit1:2,Digit2:3,Digit3:4,Digit4:5,Digit5:6,Digit6:7,Digit7:8,Digit8:9,Digit9:10,Digit0:11,Minus:12,Equal:13,Backspace:14,Tab:15,
KeyQ:16,KeyW:17,KeyE:18,KeyR:19,KeyT:20,KeyY:21,KeyU:22,KeyI:23,KeyO:24,KeyP:25,BracketLeft:26,BracketRight:27,Enter:28,ControlLeft:29,
KeyA:30,KeyS:31,KeyD:32,KeyF:33,KeyG:34,KeyH:35,KeyJ:36,KeyK:37,KeyL:38,Semicolon:39,Quote:40,Backquote:41,ShiftLeft:42,Backslash:43,
KeyZ:44,KeyX:45,KeyC:46,KeyV:47,KeyB:48,KeyN:49,KeyM:50,Comma:51,Period:52,Slash:53,ShiftRight:54,NumpadMultiply:55,AltLeft:56,Space:57,CapsLock:58,
F1:59,F2:60,F3:61,F4:62,F5:63,F6:64,F7:65,F8:66,F9:67,F10:68,NumLock:69,ScrollLock:70,Numpad7:71,Numpad8:72,Numpad9:73,NumpadSubtract:74,
Numpad4:75,Numpad5:76,Numpad6:77,NumpadAdd:78,Numpad1:79,Numpad2:80,Numpad3:81,Numpad0:82,NumpadDecimal:83,IntlBackslash:86,F11:87,F12:88,
NumpadEnter:96,ControlRight:97,NumpadDivide:98,PrintScreen:99,AltRight:100,Home:102,ArrowUp:103,PageUp:104,ArrowLeft:105,ArrowRight:106,End:107,
ArrowDown:108,PageDown:109,Insert:110,Delete:111,Pause:119,MetaLeft:125,MetaRight:126,ContextMenu:127 };
function send(value) {
  if (!interactive && (["pointer", "button", "wheel", "key"].includes(value.type) || value.type === "focus" && value.focused)) return;
  if (receiver && !closed) {
    try { receiver.input(JSON.stringify(value)); } catch (e) { fail(e.message); }
  }
}
function update() {
  surface.tabIndex = interactive && state === "running" ? 0 : -1;
  surface.classList.toggle("observe", !interactive);
  for (const button of ["copy", "paste"]) document.getElementById(button).disabled = !interactive || state !== "running";
  if (!closed) BashKittenDisplay.update(document, state, interactive, serviceRunning);
}
function releaseInput() {
  // The gateway releases this presenter's held keys/buttons. XTest/agent input
  // belongs to the guest and is never disabled by this viewport preference.
  send({type:"focus", focused:false});
  for (const id of pointerIds) if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
  pointerIds.clear();
}
function fail(message) {
  state = "error"; clipboardEpoch++;
  status.textContent = message; status.hidden = false;
  receiver?.close(); update();
}
function resize() {
  resizeFrame=0; if (document.hidden || closed || !receiver || state === "stopping") return;
  const r=surface.getBoundingClientRect(), width=Math.round(r.width*devicePixelRatio), height=Math.round(r.height*devicePixelRatio);
  const size=`${width}x${height}`; if (!width||!height||size===lastSize) return;
  lastSize=size; send({type:"resize",width,height,generation:++generation});
}
function startRenderer() {
  if (closed || receiver) return;
  state="starting"; lastSize=""; status.textContent="Connecting to desktop…"; status.hidden=false;
  const current = ++attachment;
  rendererClosed = new Promise(resolve => { resolveRendererClosed=resolve; });
  const observer={ observe(_subject,_topic,data) {
    if (closed || current !== attachment) return;
    try {
      const v=JSON.parse(data);
      if (v.type==="closed") {
        receiver=null; resolveRendererClosed();
        if (!changing && state !== "error") fail("The Display connection stopped. Turn Display off and on to reconnect.");
        else update();
        return;
      }
      if (state==="stopping" || state==="error") return;
      if(v.type==="ready") {
        const mode=document.getElementById("renderMode");mode.textContent=v.mode==="gpu"?"GPU":"Software";mode.title=v.fallbackReason||"";
        state="running"; update();
        send({type:"visible",visible:!document.hidden});
        if (interactive && !document.hidden) surface.focus();
        else send({type:"focus",focused:false});
        resize();
      } else if(v.type==="frame_ready")status.hidden=true;
      else if(v.type==="error") fail(v.message);
      else if(v.type==="cursor") surface.style.cursor=`url("${v.image}") ${Math.round(v.hotspot_x/devicePixelRatio)} ${Math.round(v.hotspot_y/devicePixelRatio)}, default`;
      else if(v.type==="cursor_state") surface.style.cursor=v.state==="hidden"?"none":"default";
    } catch { fail("The native display returned an invalid status."); }
  }, QueryInterface:ChromeUtils.generateQI(["nsIObserver"]) };
  try { receiver=BashKittenDisplay.attach(document,surface,observer); update(); }
  catch(e) { receiver=null; resolveRendererClosed(); fail(e.message); }
}
async function enabled(value) {
  if (closed || changing) return;
  changing=true;
  releaseInput(); clipboardEpoch++;
  state=value?"starting":"stopping";
  status.textContent=value?"Starting Display…":"Turning off Display…"; status.hidden=false;
  receiver?.close(); update();
  try {
    const result=await BashKittenDisplay.service(document,value?"start":"stop");
    await rendererClosed;
    if (closed) return;
    serviceRunning=result.running;
    if (value) {
      if (!result.running) throw new Error(result.error || "Display did not start.");
      startRenderer();
    } else {
      if (result.running) throw new Error("Display has not stopped.");
      state="off"; status.textContent="Display is off. The container and agent are still running.";
    }
  } catch(error) {
    if (!closed) {
      try { serviceRunning=(await BashKittenDisplay.service(document,"status")).running; } catch {}
      if (!closed) fail(error.message);
    }
  } finally { changing=false; if(!closed)update(); }
}
function interaction(value) {
  if (interactive === value) return;
  releaseInput(); interactive=value; clipboardEpoch++;
  document.getElementById("clipboardStatus").textContent="";
  if (!interactive) surface.blur();
  update();
}
BashKittenDisplay.bind(document,{enabled,interactive:interaction});
if (serviceRunning) startRenderer();
else {
  status.textContent=initial.error || "Display is off. Turn it on to open desktop apps.";
  status.hidden=false; update();
}
new ResizeObserver(()=>{if(!resizeFrame)resizeFrame=requestAnimationFrame(resize);}).observe(surface);
surface.addEventListener("pointermove",e=>{if(!interactive)return;const r=surface.getBoundingClientRect();send({type:"pointer",x:(e.clientX-r.left)*devicePixelRatio,y:(e.clientY-r.top)*devicePixelRatio,generation});});
for(const name of ["pointerdown","pointerup"])surface.addEventListener(name,e=>{
  if(!interactive||state!=="running")return;
  e.preventDefault();surface.focus();const r=surface.getBoundingClientRect();send({type:"pointer",x:(e.clientX-r.left)*devicePixelRatio,y:(e.clientY-r.top)*devicePixelRatio,generation});
  if(name==="pointerdown"){surface.setPointerCapture(e.pointerId);pointerIds.add(e.pointerId);}else pointerIds.delete(e.pointerId);
  send({type:"button",button:[272,274,273,275,276][e.button]||272,pressed:name==="pointerdown",generation});
});
surface.addEventListener("pointercancel",releaseInput);
surface.addEventListener("wheel",e=>{if(!interactive)return;e.preventDefault();send({type:"wheel",horizontal:e.deltaX,vertical:e.deltaY,generation});},{passive:false});
surface.addEventListener("contextmenu",e=>e.preventDefault());
for(const name of ["keydown","keyup"])surface.addEventListener(name,e=>{if(!interactive)return;const key=keys[e.code];if(key===undefined||e.repeat)return;
  // Keep tab navigation in browser chrome; Ctrl-L belongs to the focused
  // guest application because Display has no browser address field.
  if(e.ctrlKey&&["KeyT","KeyW","Tab"].includes(e.code))return;
  e.preventDefault();e.stopPropagation();send({type:"key",key,pressed:name==="keydown",modifiers:0});});
for(const name of ["beforeinput","input","compositionstart","compositionupdate","compositionend","paste","cut","copy","dragstart","dragover","drop"])surface.addEventListener(name,e=>{if(!interactive)e.preventDefault();});
surface.addEventListener("focus",()=>send({type:"focus",focused:true}));
surface.addEventListener("blur",releaseInput);
document.addEventListener("visibilitychange",()=>{send({type:"visible",visible:!document.hidden});if(document.hidden)releaseInput();else{send({type:"focus",focused:interactive&&document.activeElement===surface});resize();}});
function detach(){if(closed)return;closed=true;clipboardEpoch++;cancelAnimationFrame(resizeFrame);receiver?.close();receiver=null;resolveRendererClosed?.();}
window.addEventListener("unload",detach,{once:true});
window.addEventListener("BashKittenDisplayDetach",detach,{once:true});

// Explicit snapshots only. Merely attaching/focusing a tab never reads either
// clipboard. Native owner validates its live machine before running guest work.
async function clipboard(action) {
  if (!interactive || state !== "running") return;
  const epoch=++clipboardEpoch;
  const current=()=>!closed && interactive && state === "running" && epoch === clipboardEpoch;
  const controls=[document.getElementById("copy"),document.getElementById("paste")];
  const label=document.getElementById("clipboardStatus");
  controls.forEach(button=>button.disabled=true);label.textContent="";
  try {
    if(action==="read") {
      const result=await BashKittenDisplay.clipboard(document,{action});
      if(!current()) return;
      if(result.type==="image/png") {
        const blob=await (await fetch(`data:image/png;base64,${result.dataBase64}`)).blob();
        if(!current()) return;
        await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);
      } else if(result.type==="text/plain") await navigator.clipboard.writeText(result.text);
      else throw new Error("The desktop clipboard has no supported text or image.");
    } else {
      // Firefox's async Clipboard API performs image conversion outside the UI
      // thread and returns a bounded snapshot, without retaining a watcher.
      const items=await navigator.clipboard.read();
      let request;
      for(const item of items) {
        if(item.types.includes("image/png")) {
          const blob=await item.getType("image/png");
          const dataBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(",")[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
          request={action,type:"image/png",dataBase64};break;
        }
        if(item.types.includes("text/plain")) {
          const blob=await item.getType("text/plain");
          request={action,type:"text/plain",text:await blob.text()};
        }
      }
      if(!request) throw new Error("The clipboard has no supported text or image.");
      if(!current()) return;
      await BashKittenDisplay.clipboard(document,request);
    }
    if(current())label.textContent=action==="read"?"Copied from desktop":"Pasted to desktop";
  } catch(error) {if(current())label.textContent=error.message;}
  finally {if(!closed)update();}
}
document.getElementById("copy").addEventListener("click",event=>{if(event.isTrusted)clipboard("read");});
document.getElementById("paste").addEventListener("click",event=>{if(event.isTrusted)clipboard("write");});

}
void initialize().catch(error => {
  status.textContent = error.message; status.hidden = false;
  surface.tabIndex = -1;
  for (const id of ["copy", "paste"]) document.getElementById(id).disabled = true;
});
