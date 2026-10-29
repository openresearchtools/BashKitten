/* SPDX-License-Identifier: AGPL-3.0-only */
import { confirm, modelSelect, downloadProgress } from './ui.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';

/** Shared view; the owned native settings actor authorizes every operation. */
export async function renderSection({ root: parent, call: control, info, signal }) {
  if (info.local !== true && info.backendKind !== 'machine') { parent.textContent = 'Select Local or a managed container to use LocalAI.'; return; }
  const win = parent.ownerDocument.defaultView;
  const isLocal = () => info.local === true || info.backendKind === 'machine';
  const doc = parent.ownerDocument;
  const node = (tag, text = '') => { const result = doc.createElementNS(HTML, tag); result.textContent = text; return result; };
  const message = node('p'), body = node('div'); message.setAttribute('role', 'status'); parent.append(message, body);
  let state, liveState, busy = false, progressNode, outputNode, refreshGuided, refreshAdvanced, refreshDownloads, feedbackJob, setupView, formEdited = false, lastSetupStatus;
  for (const event of ['input', 'change']) parent.addEventListener(event, () => { formEdited = true; }, { signal });
  const jobMessage = job => job ? [({ complete: 'Complete', failed: 'Failed', interrupted: 'Interrupted', cancelled: 'Cancelled' })[job.status] || job.phase,
    job.progress && (Number(job.progress.total) > 0 || !['complete', 'failed', 'interrupted', 'cancelled'].includes(job.status)) ? downloadProgress(job.progress) : '', job.error].filter(Boolean).join(' · ') : '';
  const operationOutput = value => [value.job?.log, ...[['llama', 'llama.cpp'], ['whisper', 'Whisper']].map(([engine, label]) => {
    const service = value[engine]?.service;
    return service?.output ? `${label} · ${service.state}\n${service.output}` : '';
  })].filter(Boolean).join('\n\n');
  const followJob = job => { feedbackJob = job?.id; message.textContent = jobMessage(job); };
  const active = () => !signal.aborted && parent.isConnected && isLocal();
  const call = async (name, args) => { if (!active()) throw Error('This environment’s LocalAI settings are no longer open.'); return control(name, args); };
  const run = async (action, feedback = message) => {
    if (busy || !active()) return;
    busy = true; feedback.textContent = '';
    if (feedback === message) feedbackJob = null;
    const disabled = [...parent.querySelectorAll('button')].map(button => [button, button.disabled]);
    for (const [button] of disabled) button.disabled = true;
    try { await action(); } catch (error) { if (active()) feedback.textContent = error.message; }
    finally {
      busy = false;
      for (const [button, previous] of disabled) if (button.isConnected) button.disabled = previous;
      if (active() && liveState) { refreshGuided?.(liveState); refreshAdvanced?.(liveState); }
    }
  };
  const button = (text, action, feedback = message) => { const result = node('button', text); result.type = 'button'; result.onclick = () => run(action, feedback); return result; };
  const field = (parent, text, value = '', multiline = false) => {
    const label = node('label', text), input = node(multiline ? 'textarea' : 'input'); input.value = value;
    if (multiline) { input.rows = 4; input.style.cssText = 'font-family:monospace;resize:vertical;max-height:20rem;overflow:auto'; }
    label.append(input); parent.append(label); return input;
  };
  const select = (parent, text, choices, value) => {
    const label = node('label', text), input = node('select');
    for (const [id, title] of choices) { const option = node('option', title); option.value = id; input.append(option); }
    input.value = value; label.append(input); parent.append(label); return input;
  };
  const check = (parent, text, checked) => { const label = node('label', text), input = node('input'); input.type = 'checkbox'; input.checked = checked; label.prepend(input); parent.append(label); return input; };
  const pick = async (title, kind = 'file', initial = '') => {
    const chooser = node('section'); chooser.className = 'connection-card';
    chooser.setAttribute('role', 'dialog'); chooser.setAttribute('aria-label', title);
    chooser.append(node('h3', title)); parent.append(chooser);
    const location = field(chooser, 'Folder or file path', initial);
    const listing = node('div'), feedback = node('p'); feedback.setAttribute('role', 'status');
    listing.style.cssText = 'max-height:24rem;overflow:auto;display:flex;flex-direction:column;align-items:stretch';
    const filename = kind === 'save' ? field(chooser, 'New filename', initial.split('/').at(-1)) : null;
    let current, pending = false, finished = false, resolve;
    const result = new Promise(done => { resolve = done; });
    const observer = new win.MutationObserver(() => { if (!active() || !chooser.isConnected) finish(null); });
    const finish = value => { if (finished) return; finished = true; observer.disconnect(); signal.removeEventListener('abort', cancelled); doc.removeEventListener('visibilitychange', visibility); chooser.remove(); resolve(value); };
    const cancelled = () => finish(null);
    const visibility = () => { if (doc.hidden) finish(null); };
    signal.addEventListener('abort', cancelled, { once: true });
    doc.addEventListener('visibilitychange', visibility);
    const action = (label, handler) => {
      const element = node('button', label); element.type = 'button';
      element.onclick = async () => {
        if (pending || finished) return;
        pending = true; feedback.textContent = '';
        try { await handler(); } catch (error) { if (!finished) feedback.textContent = error.message; }
        finally { pending = false; }
      };
      return element;
    };
    const browse = async path => {
      const directory = await call('localai-browse', { path, kind });
      if (finished) return;
      current = directory; location.value = current.path; listing.replaceChildren();
      if (current.parent) listing.append(action('Parent folder', () => browse(current.parent)));
      for (const entry of current.entries) {
        if (kind === 'folder' && !entry.directory) continue;
        listing.append(action((entry.directory ? 'Folder: ' : '') + entry.name, () => {
          if (entry.directory) return browse(entry.path);
          if (filename) filename.value = entry.name;
          else finish(entry.path);
        }));
      }
      if (!current.entries.length) listing.append(node('p', 'This folder is empty.'));
    };
    chooser.append(action('Open path', () => browse(location.value)), listing, feedback);
    if (kind !== 'file') chooser.append(action(kind === 'folder' ? 'Use this folder' : 'Use this filename', () => {
      if (!current) throw Error('Open a folder first');
      if (filename && (!filename.value.trim() || /[\/\0]/.test(filename.value) || ['.', '..'].includes(filename.value))) throw Error('Enter a filename without a directory');
      finish(filename ? current.path.replace(/\/$/, '') + '/' + filename.value : current.path);
    }));
    const cancel = node('button', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => finish(null); chooser.append(cancel);
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    pending = true;
    void browse(initial).catch(error => { if (!finished) feedback.textContent = error.message; }).finally(() => { pending = false; });
    location.focus();
    return result;
  };
  const draw = value => {
    if (!active()) return;
    state = liveState = value; formEdited = false; lastSetupStatus = value.firstRun?.status; setupView = null; refreshGuided = null; refreshAdvanced = null; refreshDownloads = null; body.replaceChildren();
    if (state.needsSetup) {
      body.append(node('p', 'Set up Termux Local before configuring local models.'), button('Set up Local', () => call('localai-setup')));
      return;
    }
    if (state.firstRun) {
      const setup = node('section'); setup.className = 'connection-card';
      setup.append(node('h3', 'Local AI is preparing in the background'), node('p', 'Your chat and image model, speech recognition and voice are selected automatically. Starts on CPU. Downloads continue with this page closed.'));
      const names = node('p', state.firstRun.models.map(item => `${item.title} · ${(item.bytes / 1e9).toFixed(2)} GB`).join(' · '));
      const status = node('p'); status.setAttribute('role', 'status');
      const resume = button('Resume setup', async () => { followJob(await call('localai-first-run')); });
      const cancel = button('Stop setup', async () => { followJob(await call('localai-cancel')); });
      const update = value => {
        if (!setup.isConnected) return;
        const setupState = value.firstRun;
        if (!setupState) return;
        setup.hidden = setupState.status === 'complete';
        status.textContent = setupState.status === 'complete' ? 'Ready. Local chat, vision and voice are set up.' :
          [setupState.status === 'pending' ? 'Preparing downloads…' : setupState.status === 'running' ? jobMessage(value.job) : setupState.status, setupState.error].filter(Boolean).join(' · ');
        resume.hidden = !setupState.canResume; cancel.hidden = setupState.status !== 'running';
      };
      setup.append(names, status, resume, cancel);
      setup.hidden = state.firstRun.status === 'complete';
      body.append(setup); setupView = update; update(state);
    }
    const guided = node('div'); body.append(guided); drawGuided(guided);
    const downloads = node('section'); downloads.className = 'connection-card'; body.append(downloads);
    void drawDownloads(downloads).catch(error => { if (active() && downloads.isConnected) message.textContent = error.message; });
    const advanced = node('details'); advanced.className = 'connection-card'; advanced.append(node('summary', 'Advanced')); body.append(advanced);
    drawLlamaAdvanced(advanced);
    const progress = node('p', jobMessage(state.job)); progressNode = progress; body.append(progress);
    body.append(button('Refresh status', async () => draw(await call('localai-status'))));
    const output = node('details'); output.append(node('summary', 'Local AI runtime output')); const text = node('pre', operationOutput(state)); outputNode = text; text.style.cssText = 'max-height:12rem;overflow:auto;white-space:pre-wrap'; output.append(text); advanced.append(output);
  };
  const drawLlamaAdvanced = section => {
    const custom = check(section, 'Use a custom router INI', liveState.guided?.llama?.mode === 'custom');
    section.append(node('p', 'Custom mode uses your INI and disables the guided chat model, device and context controls. You or your agent can edit the file. Speech settings remain independent.'));
    const controls = node('div'), path = node('p'), status = node('p');
    status.setAttribute('role', 'status'); section.append(controls, status); controls.append(path);
    const update = latest => {
      if (!active() || !section.isConnected) return;
      const enabled = latest.guided?.llama?.mode === 'custom';
      custom.checked = enabled; controls.hidden = !enabled;
      path.textContent = latest.llama.config.preset;
      status.textContent = [latest.llama.savedForNextStart ? 'INI changes are saved. Apply them when current model work has finished.' : '', latest.llama.error, latest.llama.service?.error].filter(Boolean).join(' · ');
    };
    const refresh = async () => {
      const latest = await call('localai-status'); if (!active()) return;
      liveState = latest; refreshGuided?.(latest); update(latest);
    };
    custom.onchange = () => {
      const enabled = custom.checked; custom.checked = liveState.guided?.llama?.mode === 'custom';
      void run(async () => {
        const current = liveState.guided?.llama;
        if (!current) throw Error('Refresh Local AI settings before changing router mode.');
        if (enabled) {
          liveState = await call('localai-custom-router', { enabled: true, revision: liveState.guided.revision });
          refreshGuided?.(liveState); update(liveState);
        } else {
          followJob(await call('localai-guided-select', { engine: 'llama', id: current.selected, device: current.device || 'cpu', contextSize: current.context?.selected, revision: liveState.guided.revision, replaceCustom: true }));
          await refresh();
        }
      });
    };
    controls.append(button('Choose INI…', async () => {
      const revision = liveState.guided.revision;
      const file = await pick('Choose router INI', 'file', liveState.llama.config.preset); if (!file) return;
      liveState = await call('localai-custom-router', { enabled: true, file, revision });
      refreshGuided?.(liveState); update(liveState);
    }), button('Edit INI', () => {
      const opened = { file: liveState.llama.config.preset, revision: liveState.revision };
      return editINI(opened.file, async file => {
        const latest = await call('localai-status'); if (!active()) return;
        liveState = latest;
        if (latest.revision !== opened.revision || latest.llama.config.preset !== opened.file || latest.guided?.llama?.mode !== 'custom') {
          throw Error('The INI was saved, but the active configuration changed while editing. Refresh settings before choosing which INI to use.');
        }
        if (file !== opened.file) liveState = await call('localai-custom-router', { enabled: true, file, revision: latest.guided.revision });
        opened.file = file; opened.revision = liveState.revision;
        refreshGuided?.(liveState); update(liveState);
      });
    }), button('Apply INI', async () => {
      const latest = await call('localai-status'); if (!active()) return;
      if (latest.guided?.llama?.mode !== 'custom') throw Error('Custom router mode is no longer active. Refresh settings.');
      if (latest.llama.service?.state === 'running' && !await confirm(parent, { title: 'Apply router INI?', message: 'This restarts the router and ends any active local inference.' }, signal)) return;
      await call('localai-action', { engine: 'llama', action: latest.llama.service?.state === 'running' ? 'reload' : 'start' });
      await refresh();
    }));
    refreshAdvanced = update; update(liveState);
  };
  const drawGuided = root => {
    const pickers = new Map(), views = new Map();
    root.append(node('p', 'Choose a model to download and use it. Required runtimes and matching model assets are handled automatically.'));
    for (const [engine, title] of [['llama', 'Chat and images'], ['whisper', 'Speech recognition'], ['tts', 'Voice']]) {
      const section = node('section'); section.className = 'connection-card'; section.append(node('h3', title)); root.append(section);
      const status = node('p'); status.setAttribute('role', 'status');
      const picker = modelSelect(section, engine === 'tts' ? 'Text to speech model' : engine === 'whisper' ? 'Speech recognition model' : 'Model', { signal, onSelect: id => {
        if (!id || busy || !active()) return;
        void run(async () => {
          const current = liveState.guided?.[engine]; if (!current) throw Error('Refresh Local AI settings before choosing a model.');
          if (current.mode === 'custom') throw Error('Turn off custom router INI in Advanced to use guided models.');
          followJob(await call('localai-guided-select', { engine, id, device: current.device || 'cpu',
            ...(engine === 'llama' ? { contextSize: current.context?.selected } : {}), revision: liveState.guided.revision }));
          const latest = await call('localai-status'); if (!active()) return; liveState = latest; refreshGuided?.(latest); await refreshDownloads?.();
        });
      } });
      pickers.set(engine, picker);
      const device = select(section, 'Run on', [['cpu', 'CPU'], ['gpu', 'GPU']], 'cpu');
      const deviceNote = node('p'); section.append(deviceNote, status);
      device.onchange = () => {
        const current = liveState.guided?.[engine], target = device.value;
        device.value = current?.device || 'cpu';
        if (!current || busy || current.mode === 'custom') return;
        void run(async () => {
          followJob(await call('localai-guided-select', { engine, id: current.pending?.id || current.selected, device: target,
            ...(engine === 'llama' ? { contextSize: current.pending?.contextSize ?? current.context?.selected } : {}), revision: liveState.guided.revision }));
          const latest = await call('localai-status'); if (!active()) return; liveState = latest; refreshGuided?.(latest); await refreshDownloads?.();
        });
      };
      let context, contextLimit, applyContext, autoSend, contextDirty = false;
      if (engine === 'llama') {
        context = field(section, 'Context size (tokens)'); context.type = 'number'; context.min = '1'; context.step = '1';
        contextLimit = node('p'); section.append(contextLimit);
        context.oninput = () => { contextDirty = true; };
        applyContext = button('Apply context size', async () => {
          const current = liveState.guided?.llama;
          if (!current || current.mode === 'custom') throw Error('Use the custom router below to change its context.');
          if (!context.reportValidity()) return;
          const submitted = context.value, contextSize = Number(submitted); if (!Number.isSafeInteger(contextSize) || contextSize < 1) throw Error('Enter a whole number of context tokens.');
          followJob(await call('localai-guided-select', { engine, id: current.pending?.id || current.selected, device: current.pending?.device || current.device || 'cpu', contextSize, revision: liveState.guided.revision }));
          if (context.value === submitted) contextDirty = false;
          const latest = await call('localai-status'); if (!active()) return; liveState = latest; refreshGuided?.(latest); await refreshDownloads?.();
        });
        section.append(applyContext, node('p', 'Download size includes the model and its image projector. Memory use also depends on context and other open apps; a smaller model or shorter context needs less memory.'));
      }
      if (engine === 'tts') section.append(node('p', 'The default Pocket voice speaks English.'));
      if (engine === 'whisper') {
        section.append(node('p', 'Parakeet supports 25 European languages. Whisper offers smaller models and other language choices.'));
        autoSend = check(section, 'Automatically send composer voice messages', state.whisper.config.autoSend);
        autoSend.onchange = () => {
          const enabled = autoSend.checked;
          autoSend.checked = liveState.whisper.config.autoSend;
          void run(async () => {
            await call('localai-save', { engine, config: { ...liveState.whisper.config, autoSend: enabled }, revision: liveState.revision });
            liveState = await call('localai-status');
          });
        };
        section.append(node('p', 'Calls always read your words back and ask you to confirm before sending.'));
      }
      views.set(engine, { status, device, deviceNote, context, contextLimit, applyContext, autoSend, contextEdited: () => contextDirty });
    }
    const update = latest => {
      if (!active() || !root.isConnected) return;
      for (const [engine, view] of views) {
        const current = latest.guided?.[engine], picker = pickers.get(engine);
        if (!current) { view.status.textContent = 'Model status is unavailable. Refresh Local AI settings.'; picker.update({ disabled: true }); view.device.disabled = true; continue; }
        const custom = engine === 'llama' && current.mode === 'custom', presets = current.presets || [];
        if (view.autoSend) view.autoSend.checked = latest.whisper.config.autoSend;
        picker.update({ choices: [...(custom ? [{ id: '', title: 'Custom router configuration', status: 'custom' }] : []), ...presets.map(item => ({ ...item,
          title: `${item.title} · ${(item.bytes / 1e9).toFixed(2)} GB`, detail: item.recommended ? 'Recommended starting model' : '' }))],
          value: custom ? '' : current.pending?.id || current.selected, disabled: custom || busy });
        const deviceChoices = current.devices?.length ? current.devices : [{ id: 'cpu', label: 'CPU', available: true }];
        const choicesRevision = JSON.stringify(deviceChoices);
        if (view.device.dataset.choices !== choicesRevision) {
          view.device.replaceChildren(...deviceChoices.map(item => { const option = node('option', item.label); option.value = item.id; option.disabled = item.available === false; return option; }));
          view.device.dataset.choices = choicesRevision;
        }
        view.device.value = current.pending?.device || current.device || 'cpu'; view.device.disabled = custom;
        const chosenDevice = current.devices?.find(item => item.id === view.device.value);
        view.deviceNote.textContent = custom ? 'Devices are controlled by your custom router below.' : chosenDevice?.detail || (deviceChoices.filter(item => item.available !== false).length === 1 ? 'No supported GPU is currently available.' : '');
        if (view.context) {
          const selected = current.pending?.contextSize ?? current.context?.selected;
          if (!view.contextEdited() && doc.activeElement !== view.context && selected !== undefined) view.context.value = selected;
          if (Number.isSafeInteger(current.context?.max) && current.context.max > 0) view.context.max = current.context.max; else view.context.removeAttribute('max');
          view.context.disabled = custom; view.applyContext.disabled = custom;
          view.contextLimit.textContent = current.context?.max ? `${selected?.toLocaleString() || '—'} / ${current.context.max.toLocaleString()} tokens supported by this model` : current.context?.detail || 'Model context limit is not available yet.';
        }
        const pending = current.pending;
        view.status.textContent = [custom ? 'Custom router INI is active. Turn it off in Advanced to use guided models.' : '',
          pending ? 'Preparing the selected model in the background…' : '', current.error, latest[engine]?.error, latest[engine]?.service?.error].filter(Boolean).join(' · ');
      }
    };
    refreshGuided = update; update(liveState);
  };
  const downloadSamples = new Map();
  const measuredProgress = (id, progress, running = true) => {
    const now = Date.now(), previous = downloadSamples.get(id), amount = Number(progress.downloaded) || 0;
    const bytesPerSecond = progress.bytesPerSecond ?? (!running ? 0 : previous && now > previous.at && amount >= previous.amount ? (amount - previous.amount) * 1000 / (now - previous.at) : undefined);
    downloadSamples.set(id, { at: now, amount }); return { ...progress, bytesPerSecond };
  };
  const drawDownloads = async root => {
    root.append(node('h3', 'Downloads'));
    const list = node('div'), empty = node('p', 'No downloads in progress.'), rows = new Map(); root.append(list, empty);
    const row = (id, title, progress, status, error, actions) => {
      let view = rows.get(id);
      if (!view) {
        const card = node('div'); card.className = 'download-row';
        view = { card, title: node('strong'), bar: node('progress'), progress: node('p'), status: node('p'), actions: node('div'), buttons: new Map() };
        card.append(view.title, view.bar, view.progress, view.status, view.actions); list.append(card); rows.set(id, view);
      }
      view.title.textContent = title; view.bar.setAttribute('aria-label', `${title} download`);
      const terminalWithoutBytes = id.startsWith('runtime:') && ['complete', 'failed', 'interrupted', 'cancelled'].includes(status) && !(Number(progress.total) > 0);
      view.bar.hidden = view.progress.hidden = terminalWithoutBytes;
      if (Number(progress.total) > 0) { view.bar.max = progress.total; view.bar.value = Math.min(progress.downloaded || 0, progress.total); }
      else view.bar.removeAttribute('value');
      view.progress.textContent = terminalWithoutBytes ? '' : downloadProgress(progress); view.status.textContent = [status, error].filter(Boolean).join(' · ');
      // Polling changes text/progress, not the focused download control.
      for (const [action, handler] of actions) {
        let control = view.buttons.get(action);
        if (!control) { control = button(action, handler); view.actions.append(control); view.buttons.set(action, control); }
      }
      for (const [action, control] of view.buttons) if (!actions.some(([name]) => name === action)) { control.remove(); view.buttons.delete(action); }
    };
    const update = async () => {
      const result = await call('native-models-status'); if (!active() || !root.isConnected) return;
      const seen = new Set(), job = liveState.job;
      if (job) {
        const id = 'runtime:' + job.id; seen.add(id);
        const actions = ['complete', 'failed', 'interrupted', 'cancelled'].includes(job.status) ? []
          : [['Cancel preparation', async () => { followJob(await call('localai-cancel')); await update(); }]];
        row(id, job.phase || 'Runtime preparation', measuredProgress(id, job.progress || {}, ['running', 'waiting'].includes(job.status)), job.status, job.error, actions);
      }
      for (const download of result.jobs || []) {
        const id = 'model:' + download.id; seen.add(id);
        const available = download.status === 'complete' ? [] : ['downloading', 'queued'].includes(download.status) ? ['pause', 'cancel'] : ['resume', ...(download.status === 'cancelled' ? [] : ['cancel'])];
        const actions = available.map(action => [action === 'resume' ? 'Retry / resume download' : action === 'pause' ? 'Pause download' : 'Cancel download',
          async () => { await call('native-models-action', { id: download.id, action }); await update(); }]);
        row(id, download.repository, measuredProgress(id, download, download.status === 'downloading'), download.status, download.error, actions);
      }
      for (const [id, view] of rows) if (!seen.has(id)) { view.card.remove(); rows.delete(id); downloadSamples.delete(id); }
      empty.hidden = seen.size > 0;
    };
    refreshDownloads = update; await update();
  };
  const editINI = async (filename, saved) => {
    let file = await call('localai-ini', { file: filename });
    const editor = node('section'); editor.className = 'connection-card';
    const path = node('p', file.file), text = field(editor, 'Router INI', file.content, true); text.rows = 12;
    editor.prepend(path); parent.append(editor);
    const status = node('p'); status.setAttribute('role', 'status'); editor.append(status);
    editor.append(button('Save', async () => { file = await call('localai-ini', { file: file.file, content: text.value, revision: file.revision }); await saved(file.file); status.textContent = 'INI saved. Reload to apply.'; }, status), button('Save as…', async () => {
      const filename = await pick('Save router INI', 'save', file.file); if (!filename) return;
      const existing = await call('localai-ini', { file: filename });
      file = await call('localai-ini', { file: filename, content: text.value, revision: existing.revision });
      path.textContent = file.file; await saved(file.file); status.textContent = 'INI saved and selected. Apply INI when ready.';
    }, status), button('Close editor', () => editor.remove()));
    text.focus();
  };
  await run(async () => draw(await call('localai-status')));
  if (!active() || state?.needsSetup) return;
  // Update status only while this native panel is visible. Never replace an
  // unfinished configuration/INI edit with a background status response.
  let timer = null, polling = false;
  const poll = async () => {
    timer = null;
    if (!active() || doc.hidden || polling) return;
    polling = true;
    try {
      if (!busy) {
        const latest = await call('localai-status');
        if (!active() || doc.hidden || busy) return;
        if (latest.needsSetup) return;
        liveState = latest;
        if (!state) { draw(latest); return; }
        if (latest.firstRun?.status === 'complete' && lastSetupStatus !== 'complete') {
          lastSetupStatus = 'complete';
          if (!formEdited) { draw(latest); return; }
          message.textContent = 'Local AI is ready. Your edits are still here; Refresh status shows the new saved settings.';
        }
        if (progressNode?.isConnected) progressNode.textContent = jobMessage(latest.job);
        setupView?.(latest);
        if (feedbackJob && latest.job?.id === feedbackJob) {
          message.textContent = jobMessage(latest.job);
          if (['complete', 'failed', 'interrupted', 'cancelled'].includes(latest.job.status)) feedbackJob = null;
        }
        if (outputNode?.isConnected) outputNode.textContent = operationOutput(latest);
        refreshGuided?.(latest); await refreshDownloads?.();
        refreshAdvanced?.(latest);
      }
    } catch (error) { if (active()) message.textContent = error.message; }
    finally {
      polling = false;
      if (active() && !doc.hidden) timer = win.setTimeout(poll, 2000);
    }
  };
  const visibility = () => {
    win.clearTimeout(timer); timer = null;
    if (active() && !doc.hidden && !polling) void poll();
  };
  doc.addEventListener('visibilitychange', visibility, { signal });
  signal.addEventListener('abort', () => win.clearTimeout(timer), { once: true });
  if (active() && !doc.hidden) timer = win.setTimeout(poll, 2000);
}
