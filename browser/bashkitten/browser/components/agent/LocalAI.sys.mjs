/* SPDX-License-Identifier: AGPL-3.0-only */
const HTML = 'http://www.w3.org/1999/xhtml';

/** Trusted desktop controls. No host-management capability enters Agent HTML. */
export async function localAISettings(parent, control, win, isLocal) {
  const doc = parent.ownerDocument;
  const node = (tag, text = '') => { const result = doc.createElementNS(HTML, tag); result.textContent = text; return result; };
  const message = node('p'), body = node('div'); message.setAttribute('role', 'status'); parent.append(message, body);
  let state, busy = false, progressNode, outputNode, importNode, refreshVisibleModels, synthesisStatus, routerPresetNode;
  const engineStatus = {};
  const active = () => parent.isConnected && isLocal();
  const call = async (name, args) => { if (!active()) throw Error('Select Local to use LocalAI'); return control(name, args); };
  const run = async (action, feedback = message) => {
    if (busy || !active()) return;
    busy = true; feedback.textContent = '';
    const disabled = [...parent.querySelectorAll('button')].map(button => [button, button.disabled]);
    for (const [button] of disabled) button.disabled = true;
    try { await action(); } catch (error) { if (active()) feedback.textContent = error.message; }
    finally { busy = false; for (const [button, previous] of disabled) if (button.isConnected) button.disabled = previous; }
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
  const copy = value => { Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(value); message.textContent = 'Copied'; };
  const pick = async (title, kind = 'file', initial = '') => {
    const chooser = node('section'); chooser.className = 'connection-card';
    chooser.setAttribute('role', 'dialog'); chooser.setAttribute('aria-label', title);
    chooser.append(node('h3', title)); parent.append(chooser);
    const location = field(chooser, 'Backend folder or path', initial);
    const listing = node('div'), feedback = node('p'); feedback.setAttribute('role', 'status');
    listing.style.cssText = 'max-height:24rem;overflow:auto;display:flex;flex-direction:column;align-items:stretch';
    const filename = kind === 'save' ? field(chooser, 'New filename', initial.split('/').at(-1)) : null;
    let current, pending = false, finished = false, resolve;
    const result = new Promise(done => { resolve = done; });
    const observer = new win.MutationObserver(() => { if (!active() || !chooser.isConnected) finish(null); });
    const finish = value => { if (finished) return; finished = true; observer.disconnect(); chooser.remove(); resolve(value); };
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
      if (!current) throw Error('Open a backend folder first');
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
  const pickerField = (parent, title, value, kind = 'file') => {
    const input = field(parent, title, value);
    parent.append(button('Choose…', async () => { const filename = await pick(title, kind, input.value); if (filename) input.value = filename; }));
    return input;
  };
  const draw = value => {
    if (!active()) return;
    state = value; refreshVisibleModels = null; routerPresetNode = null; body.replaceChildren();
    for (const engine of ['llama', 'whisper']) {
      const current = state[engine], config = current.config;
      const section = node('details'); section.open = engine === 'llama'; section.className = 'connection-card';
      section.append(node('summary', engine === 'llama' ? 'llama.cpp' : 'Whisper dictation'));
      engineStatus[engine] = node('p', [current.service?.state || 'Not configured', current.url, current.service?.error, current.error, current.savedForNextStart ? 'Saved changes apply on Reload' : '', current.runtime?.version, current.runtime?.selectedBackend].filter(Boolean).join(' · '));
      section.append(engineStatus[engine]);
      if (engine === 'whisper') section.append(node('p', 'Loads on demand for microphone messages on this Agent, including connected phones. Audio stays in memory and is discarded after transcription.'));
      const mode = select(section, 'Runtime', engine === 'llama' ? [['managed', 'Managed'], ['custom', 'Custom binary']] : [['managed', 'Managed']], config.mode);
      const binary = pickerField(section, 'Executable', config.mode === 'custom' ? config.binary : current.runtime?.binary || '');
      const chooseBinary = binary.parentElement.nextElementSibling;
      const folder = button('Choose binary folder…', async () => { const directory = await pick('Choose runtime folder', 'folder'); if (directory) binary.value = directory; }); section.append(folder);
      const updateMode = () => { binary.disabled = mode.value !== 'custom'; chooseBinary.disabled = mode.value !== 'custom'; folder.disabled = mode.value !== 'custom'; };
      mode.onchange = updateMode; updateMode();
      const savedBackend = engine === 'llama' && config.backend === 'cpu' ? 'vulkan' : config.backend;
      const backend = select(section, engine === 'llama' ? 'Runtime package' : 'Device', engine === 'llama' ? [['auto', 'Automatic'], ['cuda', 'CUDA + CPU'], ['vulkan', 'Vulkan + CPU']] : [['auto', 'Automatic'], ['cuda', 'CUDA'], ['vulkan', 'Vulkan'], ['cpu', 'CPU']], savedBackend);
      if (engine === 'llama') section.append(node('p', 'Choose CPU or a GPU for each model below. Launcher environment applies to all router models.'));
      const version = node('p'); version.setAttribute('role', 'status'); section.append(version);
      section.append(button('Check now', async () => {
        if (mode.value !== config.mode || backend.value !== savedBackend) throw Error('Save the runtime choice first');
        const result = await call('localai-check', { engine });
        version.textContent = result.custom ? 'Custom binary — managed updates disabled' : `${result.version} · ${result.backend} · ${result.updateAvailable ? 'Update available' : 'Up to date'}`;
      }), button('Download / update runtime', async () => {
        if (mode.value !== config.mode || backend.value !== savedBackend) throw Error('Save the runtime choice first');
        const result = await call('localai-install', { engine }); message.textContent = result.phase;
      }));
      if (current.runtime?.root) for (const [label, filename] of [['Licenses', 'LICENSES.txt'], ['Source record', 'SOURCE.json']]) section.append(button(label, () => {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); file.initWithPath(current.runtime.root + '/' + filename);
        win.openTrustedLinkIn(Services.io.newFileURI(file).spec, 'tab');
      }));
      const launcher = node('details'); launcher.append(node('summary', 'Launcher and environment')); section.append(launcher);
      launcher.append(node('p', 'The default launcher supplies the executable, port and saved configuration. Override these settings only when needed.'));
      const port = field(launcher, 'Port — 0 chooses an available port', config.port); port.type = 'number'; port.min = '0'; port.max = '65535';
      const argv = field(launcher, 'Optional launch arguments — JSON array; {port} uses the chosen port', config.argv.length ? JSON.stringify(config.argv, null, 2) : '', true);
      launcher.append(button('Copy effective command', () => copy(JSON.stringify(current.service?.command?.argv || config.argv, null, 2))));
      if (current.service?.command) { const command = node('pre', JSON.stringify(current.service.command.argv, null, 2)); command.style.cssText = 'max-height:6em;overflow:auto;white-space:pre-wrap'; launcher.append(command); }
      const cwd = pickerField(launcher, 'Working directory', config.cwd, 'folder');
      const env = engine === 'llama' ? field(launcher, 'Environment — JSON object', JSON.stringify(config.env), true) : null;
      let preset, startup, imported, keyFile, model, keepRunning, autoSend;
      if (engine === 'llama') {
        preset = pickerField(section, 'Router INI', config.preset);
        routerPresetNode = preset;
        section.append(button('Add / edit router models', () => editRouterModels(preset.value, path => { preset.value = path; })));
        section.append(button('Edit router INI', () => editINI(preset.value, path => { preset.value = path; })));
        keyFile = pickerField(section, 'Optional application API-key file', config.keyFile);
        startup = check(section, 'Keep router available while Agent is on (models load on demand)', config.startup);
        imported = check(section, 'Import this configuration into the coding agent', config.importToPi);
        importNode = node('p', ['Pi import: ' + state.import.state, state.import.provider, state.import.endpoint, state.import.error].filter(Boolean).join(' · '));
        section.append(importNode);
      } else {
        const modelKind = select(section, 'Speech model', [['whisper', 'Whisper'], ['parakeet', 'Parakeet']], config.modelKind || 'whisper');
        modelKind.onchange = () => { config.modelKind = modelKind.value; if (modelKind.value === 'parakeet') { argv.value = ''; keepRunning.checked = false; } };
        model = pickerField(section, 'whisper.cpp model (ggml-*.bin)', config.model);
        keepRunning = check(section, 'Keep Whisper running after transcription', config.keepRunning);
        autoSend = check(section, 'Automatically send voice messages', config.autoSend);
      }
      section.append(button('Save changes', async () => {
        const next = { ...config, mode: mode.value, binary: mode.value === 'custom' ? binary.value : '', backend: backend.value, port: Number(port.value),
          argv: argv.value.trim() ? JSON.parse(argv.value) : [], cwd: cwd.value, env: env ? JSON.parse(env.value) : {} };
        if (engine === 'llama') Object.assign(next, { preset: preset.value, startup: startup.checked, importToPi: imported.checked, keyFile: keyFile.value });
        else Object.assign(next, { model: model.value, keepRunning: keepRunning.checked, autoSend: autoSend.checked });
        draw(await call('localai-save', { engine, config: next, revision: state.revision })); message.textContent = 'Saved. Reload applies command changes to a running engine.';
      }));
      for (const action of ['start', 'stop', 'reload']) section.append(button(action === 'start' ? 'Start' : action === 'stop' ? 'Stop' : 'Reload', async () => {
        if (action === 'reload' && !Services.prompt.confirm(win, 'Reload engine?', 'Restart with the saved command? Active inference will end.')) return;
        draw(await call('localai-action', { engine, action }));
      }));
      body.append(section);
      if (config.mode === 'managed') void call('localai-check', { engine }).then(result => { if (active() && version.isConnected) version.textContent = `${result.version} · ${result.backend} · ${result.updateAvailable ? 'Update available' : 'Up to date'}`; }).catch(error => { if (version.isConnected) version.textContent = error.message; });
    }
    drawTTS();
    const models = node('details'); models.className = 'connection-card'; models.append(node('summary', 'Models'));
    const modelBody = node('div'); models.append(modelBody); body.append(models);
    models.ontoggle = () => { if (models.open && !modelBody.hasChildNodes()) void run(() => drawModels(modelBody)); };
    const progress = node('p', state.job ? [state.job.phase, state.job.error].filter(Boolean).join(' · ') : ''); progressNode = progress; body.append(progress);
    body.append(button('Refresh status', async () => draw(await call('localai-status'))), button('Cancel LocalAI operation', async () => { const value = await call('localai-cancel'); progress.textContent = value?.phase || ''; }));
    const output = node('details'); output.append(node('summary', 'LocalAI operation output')); const text = node('pre', state.job?.log || ''); outputNode = text; text.style.cssText = 'max-height:12rem;overflow:auto;white-space:pre-wrap'; output.append(text); body.append(output);
  };
  const drawTTS = () => {
    if (!state.tts) return;
    const config = state.tts.config, section = node('details'); section.className = 'connection-card';
    section.append(node('summary', 'Speech synthesis · llama-tts'), node('p', 'Uses the managed llama.cpp runtime. Both families need their matching projector and reference speech. Models provides compatible downloads.'));
    const family = select(section, 'Model family', [['pocket', 'Pocket TTS'], ['qwen3', 'Qwen3-TTS']], config.modelKind);
    const backend = select(section, 'Device', [['auto', 'Automatic'], ['cuda', 'CUDA'], ['vulkan', 'Vulkan'], ['cpu', 'CPU']], config.backend);
    const model = pickerField(section, 'Model GGUF', config.model), projector = pickerField(section, 'Matching mmproj GGUF', config.projector), voice = pickerField(section, 'Reference voice audio', config.voice), language = field(section, 'Language code', config.language);
    section.append(button('Save changes', async () => { draw(await call('localai-save', { engine: 'tts', config: { ...config, backend: backend.value, modelKind: family.value, model: model.value, projector: projector.value, voice: voice.value, language: language.value }, revision: state.revision })); }));
    const prompt = field(section, 'Text to speak', '', true), output = field(section, 'New output WAV file', '');
    section.append(button('Choose output…', async () => { const file = await pick('Save generated speech', 'save', output.value); if (file) output.value = file; }));
    synthesisStatus = node('p'); section.append(synthesisStatus);
    section.append(button('Generate speech', async () => { const result = await call('localai-synthesize', { text: prompt.value, output: output.value }); prompt.value = ''; synthesisStatus.textContent = result.tts.synthesis.state; }), button('Stop synthesis', async () => { const result = await call('localai-synthesis-cancel'); synthesisStatus.textContent = result.tts.synthesis.state; }));
    section.append(node('p', 'Select the original downloaded Pocket F16 model to create a smaller Q4_0 or Q8_0 copy. Keep its matching projector.'));
    for (const type of ['Q4_0', 'Q8_0']) section.append(button(`Create Pocket ${type} copy`, async () => {
      if (family.value !== 'pocket' || !/\.gguf$/i.test(model.value)) throw Error('Select the original Pocket F16 model first');
      await call('localai-quantize', { file: model.value, type, output: model.value.replace(/\.gguf$/i, `-${type}.gguf`) });
      message.textContent = 'Creating a separate quantized model. Refresh status when complete to select it.';
    }));
    if (state.job?.kind === 'localai-quantize' && state.job.status === 'complete' && state.job.result?.file) section.append(button('Use created Pocket model', async () => {
      draw(await call('localai-model-use', { engine: 'tts', file: state.job.result.file, kind: 'pocket', projector: projector.value }));
    }));
    body.append(section);
  };
  const editRouterModels = async (filename, saved, selectedName = '') => {
    let catalogue = await call('localai-router-models', { file: filename });
    const editor = node('section'); editor.className = 'connection-card';
    editor.append(node('h3', 'Router models'));
    const location = node('p', catalogue.file); editor.append(location);
    const entries = select(editor, 'Saved model', [['', 'Add a model']], '');
    const form = node('div'); editor.append(form);
    const name = field(form, 'Model name');
    const model = pickerField(form, 'Model file', '');
    const projector = pickerField(form, 'Optional mmproj file', '');
    const context = field(form, 'Context length — 0 uses the model default', '0'); context.type = 'number'; context.min = '0'; context.step = '1';
    const device = select(form, 'Run on', [['none', 'CPU']], 'none');
    const deviceNote = node('p'); form.append(deviceNote);
    const layers = field(form, 'GPU layers — all, auto, or a number', '0');
    const fit = check(form, 'Fit the model to available memory', true);
    const cacheGpu = check(form, 'Keep KV cache on GPU', false);
    const flash = select(form, 'Flash attention', [['auto', 'Automatic'], ['on', 'On'], ['off', 'Off']], 'auto');
    const idle = select(form, 'Keep loaded after last use', [['0', 'Indefinitely'], ['1', '1 minute'], ['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['custom', 'Custom minutes']], '0');
    const customIdle = field(form, 'Idle minutes — 0 means indefinitely', '0'); customIdle.type = 'number'; customIdle.min = '0'; customIdle.step = '1'; customIdle.parentElement.hidden = true;
    idle.onchange = () => { customIdle.parentElement.hidden = idle.value !== 'custom'; };
    form.append(node('p', 'The inactivity timer resets when the model is used. Unloading releases the active KV context too. The router may also unload an idle model to make room for another model.'));
    const extra = field(form, 'Additional INI parameters — one key=value per line', '', true);
    const status = node('p'); status.setAttribute('role', 'status'); editor.append(status);
    let originalName, dirty = true, testOwner, testState = 'idle', testTimer;
    const running = () => ['loading', 'checking'].includes(testState);
    const cancelTest = async () => {
      if (testTimer) win.clearTimeout(testTimer); testTimer = null;
      if (!testOwner || !running()) return;
      const owner = testOwner;
      try { const result = await control('localai-router-model-test-cancel', { owner }); if (owner === testOwner) showTest(result); }
      catch (error) { if (editor.isConnected) status.textContent = error.message; }
    };
    const observer = new win.MutationObserver(() => {
      if (!active() || !editor.isConnected) { observer.disconnect(); void cancelTest(); }
    });
    const populate = selected => {
      const value = catalogue.models.find(item => item.name === selected);
      const config = value?.config || { device: 'none', gpuLayers: 0, contextSize: 0, fit: true, cacheGpu: false, flashAttention: 'auto', idleMinutes: 0 };
      originalName = value?.name; name.value = value?.name || ''; model.value = config.model || ''; projector.value = config.projector || '';
      context.value = config.contextSize ?? 0; layers.value = config.gpuLayers ?? 'auto'; fit.checked = config.fit !== false;
      cacheGpu.checked = config.cacheGpu !== false; flash.value = config.flashAttention || 'auto'; extra.value = config.extra || '';
      const choices = [['none', 'CPU'], ['', 'Engine default'], ...catalogue.devices.map(item => [item.id, item.label || item.id])];
      if (config.device && !choices.some(([id]) => id === config.device)) choices.push([config.device, config.device + ' (saved; not currently available)']);
      device.replaceChildren(...choices.map(([id, label]) => { const option = node('option', label); option.value = id; return option; })); device.value = config.device ?? '';
      deviceNote.textContent = catalogue.deviceError || '';
      const minutes = String(config.idleMinutes ?? 0); customIdle.value = minutes;
      idle.value = [...idle.options].some(option => option.value === minutes) ? minutes : 'custom'; customIdle.parentElement.hidden = idle.value !== 'custom';
      dirty = !value;
    };
    const refresh = async selected => {
      catalogue = await call('localai-router-models', { file: catalogue.file }); location.textContent = catalogue.file;
      entries.replaceChildren(...[['', 'Add a model'], ...catalogue.models.map(item => [item.name, item.name])].map(([id, title]) => { const option = node('option', title); option.value = id; return option; }));
      entries.value = selected || ''; populate(selected);
    };
    form.addEventListener('input', () => { dirty = true; }); form.addEventListener('change', () => { dirty = true; });
    device.onchange = () => {
      if (device.value === 'none') { layers.value = '0'; cacheGpu.checked = false; }
      else if (device.value) { layers.value = 'all'; cacheGpu.checked = true; flash.value = 'auto'; }
      dirty = true;
    };
    // Backend path pickers assign values directly rather than synthesizing form input.
    const editedConfig = () => ({ model: model.value, projector: projector.value, contextSize: Number(context.value), device: device.value,
      gpuLayers: ['all', 'auto'].includes(layers.value.trim()) ? layers.value.trim() : Number(layers.value), fit: fit.checked,
      cacheGpu: cacheGpu.checked, flashAttention: flash.value, idleMinutes: Number(idle.value === 'custom' ? customIdle.value : idle.value), extra: extra.value });
    let savedConfig;
    entries.onchange = () => void run(async () => { if (running()) throw Error('Stop the load check before selecting another model'); populate(entries.value); savedConfig = JSON.stringify(editedConfig()); }, status);
    editor.append(button('Save model', async () => {
      if (running()) throw Error('Stop the load check before saving changes');
      const config = editedConfig();
      if (!Number.isInteger(config.contextSize) || config.contextSize < 0 || !Number.isFinite(config.idleMinutes) || config.idleMinutes < 0 ||
          !(typeof config.gpuLayers === 'string' || Number.isInteger(config.gpuLayers) && config.gpuLayers >= 0)) throw Error('Enter valid context, GPU layer and idle values');
      await call('localai-router-model-save', { file: catalogue.file, revision: catalogue.revision, name: name.value, originalName, config });
      const selected = name.value; saved(catalogue.file); await refresh(selected); savedConfig = JSON.stringify(editedConfig());
      status.textContent = 'Model saved. Reload the router to apply changes.';
    }, status), button('Add another model', () => {
      if (running()) throw Error('Stop the load check before adding a model'); entries.value = ''; populate(''); savedConfig = null;
    }, status));
    const showTest = result => {
      testState = result.state;
      if (!editor.isConnected) return;
      status.textContent = result.state === 'passed' ? 'Check passed. Model unloaded.' : result.state === 'failed' ? 'Load check failed: ' + (result.error || 'See the engine error') :
        result.state === 'cancelled' ? 'Load check cancelled. Temporary model stopped.' : result.state === 'idle' ? 'No active load check.' : 'Checking model load…';
    };
    const pollTest = async owner => {
      if (owner !== testOwner) return;
      if (!active() || !editor.isConnected) { await cancelTest(); return; }
      try { showTest(await call('localai-router-model-test-status', { owner })); }
      catch (error) { status.textContent = error.message; await cancelTest(); return; }
      if (running()) testTimer = win.setTimeout(() => void pollTest(owner), 1000);
    };
    editor.append(button('Check model load', async () => {
      if (running()) throw Error('A load check is already running');
      if (!originalName || dirty || name.value !== originalName || savedConfig !== JSON.stringify(editedConfig())) throw Error('Save this model before checking its load');
      testOwner = Services.uuid.generateUUID().toString().slice(1, -1);
      testState = 'loading';
      try { showTest(await call('localai-router-model-test', { file: catalogue.file, revision: catalogue.revision, name: originalName, owner: testOwner })); }
      catch (error) { await cancelTest(); throw error; }
      if (running()) testTimer = win.setTimeout(() => void pollTest(testOwner), 1000);
    }, status), button('Stop load check', cancelTest, status), button('Edit INI directly', async () => {
      await cancelTest(); observer.disconnect(); editor.remove(); await editINI(catalogue.file, saved);
    }, status), button('Close model builder', async () => { await cancelTest(); observer.disconnect(); editor.remove(); }, status));
    editor.append(node('p', 'The load check uses a temporary router, then stops it and unloads the model before reporting success.'));
    parent.append(editor); observer.observe(doc.documentElement, { childList: true, subtree: true });
    await refresh(selectedName); savedConfig = JSON.stringify(editedConfig()); name.focus();
  };
  const editINI = async (filename, saved) => {
    let file = await call('localai-ini', { file: filename });
    const editor = node('section'); editor.className = 'connection-card';
    const path = node('p', file.file), text = field(editor, 'Router INI', file.content, true); text.rows = 12;
    editor.prepend(path); parent.append(editor);
    const status = node('p'); status.setAttribute('role', 'status'); editor.append(status);
    editor.append(button('Save', async () => { file = await call('localai-ini', { file: file.file, content: text.value, revision: file.revision }); saved(file.file); status.textContent = 'INI saved. Reload to apply.'; }, status), button('Save as…', async () => {
      const filename = await pick('Save router INI', 'save', file.file); if (!filename) return;
      const existing = await call('localai-ini', { file: filename });
      file = await call('localai-ini', { file: filename, content: text.value, revision: existing.revision });
      path.textContent = file.file; saved(file.file); status.textContent = 'INI saved. Save changes to use this file.';
    }, status), button('Close editor', () => editor.remove()));
    text.focus();
  };
  const drawModels = async root => {
    const projectorChoices = new Map(); let renderedJobs = '';
    const status = await call('native-models-status'); root.replaceChildren();
    const directory = pickerField(root, 'Models directory', status.directory, 'folder');
    root.append(button('Save models directory', async () => {
      await call('project-root', { path: directory.value }); await call('native-models-settings', { directory: directory.value }); message.textContent = 'Models directory saved';
    }));
    const tokenPanel = node('details'); tokenPanel.append(node('summary', 'Hugging Face token'));
    const token = field(tokenPanel, status.hasToken ? 'Saved privately on this host' : 'Optional token for gated models'); token.type = 'password';
    tokenPanel.append(button('Save token', async () => { const value = token.value; token.value = ''; await call('native-models-settings', { token: value }); message.textContent = 'Token saved privately'; }), button('Remove token', async () => { token.value = ''; await call('native-models-settings', { token: '' }); })); root.append(tokenPanel);
    const catalogue = await call('native-models-catalogue');
    const type = select(root, 'Model type', [['llama', 'llama.cpp GGUF'], ['whisper', 'Whisper / Parakeet'], ['tts', 'Pocket / Qwen3-TTS']], 'llama');
    const curated = node('div'); root.append(curated);
    const drawPresets = () => {
      curated.replaceChildren();
      const presets = catalogue.presets.filter(item => item.engine === type.value);
      const preset = select(curated, 'Downloads — smallest first', presets.map(item => [item.id, `${item.title} · ${(item.bytes / 1e9).toFixed(2)} GB`]), presets[0]?.id);
      curated.append(button('Download selected model', async () => { await call('native-models-preset', { id: preset.value }); message.textContent = 'Download started; it continues with this panel closed'; await refreshJobs(); }));
    };
    drawPresets();
    const query = field(root, 'Search or owner/repository'); const results = node('div');
    type.onchange = () => { drawPresets(); results.replaceChildren(); if (!query.value.trim() && type.value === 'whisper') query.value = 'whisper.cpp'; };
    const repository = async id => {
      const value = await call('native-models-repository', { id }); results.replaceChildren(node('strong', value.id), node('p', value.revision));
      const selected = new Set();
      const compatible = value.files.filter(file => type.value === 'whisper' ? file.whisper : file.gguf);
      if (!compatible.length) results.append(node('p', 'This repository has no files in the selected model format.'));
      for (const file of compatible) {
        const box = check(results, `${file.path} · ${(file.size / 1048576).toFixed(1)} MiB`, false);
        box.onchange = () => { if (box.checked) selected.add(file.path); else selected.delete(file.path); };
      }
      results.append(button('Download selected files', async () => { await call('native-models-download', { id: value.id, revision: value.revision, files: [...selected] }); message.textContent = 'Download started; it continues with this panel closed'; await refreshJobs(); }));
    };
    root.append(button('Search', async () => {
      const value = await call('native-models-search', { query: query.value, type: type.value === 'tts' ? 'llama' : type.value }); results.replaceChildren();
      for (const model of value.models) results.append(button(model.id, () => repository(model.id)));
    }), button('Open repository', () => repository(query.value)), results);
    const jobs = node('div'); root.append(jobs);
    const refreshJobs = async () => {
      const value = await call('native-models-status'); if (!root.isConnected) return;
      const revision = JSON.stringify(value.jobs); if (revision === renderedJobs) return; renderedJobs = revision; jobs.replaceChildren();
      for (const job of value.jobs) {
        const card = node('section'); card.className = 'connection-card'; card.append(node('strong', job.repository), node('p', [job.status, job.error].filter(Boolean).join(' · ')));
        const presets = catalogue.presets.filter(item => item.repository === job.repository && item.revision === job.revision && item.files.every(name => job.files.some(file => file.path === name && file.status === 'complete')));
        for (const preset of presets) card.append(button('Use ' + preset.title, async () => {
          const files = preset.files.map(name => job.directory + '/' + job.files.find(file => file.path === name).outputPath);
          const result = await call('localai-model-use', { engine: preset.engine, kind: preset.kind, file: files[0], projector: files[1] || '' }); draw(result);
          if (preset.engine === 'llama' && result.selectedModel) await editRouterModels(result.llama.config.preset, path => { if (routerPresetNode?.isConnected) routerPresetNode.value = path; }, result.selectedModel);
          message.textContent = preset.engine === 'llama' ? 'Model added. Review its settings, then reload the router.' : 'Model selected.';
        }));
        const projections = job.files.filter(file => file.status === 'complete' && /mmproj.*\.gguf$/i.test(file.path));
        const projector = projections.length ? select(card, 'Vision projector for router entries', [['', 'None'], ...projections.map(file => [file.outputPath, file.path])], projectorChoices.get(job.id) ?? (projections.length === 1 ? projections[0].outputPath : '')) : null;
        if (projector) projector.onchange = () => projectorChoices.set(job.id, projector.value);
        for (const file of job.files) {
          card.append(node('p', `${file.path} · ${(file.downloaded / 1048576).toFixed(1)} / ${(file.size / 1048576).toFixed(1)} MiB`));
          if (file.status === 'complete') {
            const filename = job.directory + '/' + file.outputPath;
            if (/\.bin$/i.test(file.path) && !presets.some(item => item.files.includes(file.path))) card.append(button(/parakeet/i.test(file.path) ? 'Use for Parakeet' : 'Use for Whisper', async () => {
              draw(await call('localai-model-use', { engine: 'whisper', kind: /parakeet/i.test(file.path) ? 'parakeet' : 'whisper', file: filename }));
            }));
            if (/\.gguf$/i.test(file.path) && !/tts|pocket/i.test(job.repository) && !presets.some(item => item.files.includes(file.path)) && !/mmproj|-(?!00001)\d{5}-of-\d{5}/i.test(file.path)) card.append(button('Add router entry', async () => {
              const projection = projector?.value ? job.directory + '/' + projector.value : '';
              const result = await call('localai-model-use', { engine: 'llama', file: filename, projector: projection }); draw(result);
              await editRouterModels(result.llama.config.preset, path => { if (routerPresetNode?.isConnected) routerPresetNode.value = path; }, result.selectedModel);
              message.textContent = 'Model added. Review its settings, then reload the router.';
            }));
          }
        }
        for (const action of ['pause', 'resume', 'cancel']) if (!['complete', 'cancelled'].includes(job.status)) card.append(button(action, async () => { await call('native-models-action', { id: job.id, action }); await refreshJobs(); }));
        jobs.append(card);
      }
    };
    root.append(button('Refresh downloads', refreshJobs)); await refreshJobs();
    refreshVisibleModels = () => root.isConnected && root.parentElement.open ? refreshJobs() : undefined;
  };
  await run(async () => draw(await call('localai-status')));
  // Update status only while this native panel is visible. Never replace an
  // unfinished configuration/INI edit with a background status response.
  const poll = async () => {
    if (!active()) return;
    try {
      if (!busy) {
        const latest = await call('localai-status');
        for (const engine of ['llama', 'whisper']) {
          const current = latest[engine];
          if (engineStatus[engine]?.isConnected) engineStatus[engine].textContent = [current.service?.state || 'Not configured', current.url, current.service?.error, current.error, current.savedForNextStart ? 'Saved changes apply on Reload' : '', current.runtime?.version, current.runtime?.selectedBackend].filter(Boolean).join(' · ');
        }
        if (importNode?.isConnected) importNode.textContent = ['Pi import: ' + latest.import.state, latest.import.provider, latest.import.endpoint, latest.import.error].filter(Boolean).join(' · ');
        if (progressNode?.isConnected) progressNode.textContent = latest.job ? [latest.job.phase, latest.job.progress?.downloaded ? `${(latest.job.progress.downloaded / 1048576).toFixed(1)} MiB downloaded` : '', latest.job.error].filter(Boolean).join(' · ') : '';
        if (outputNode?.isConnected) outputNode.textContent = latest.job?.log || '';
        if (synthesisStatus?.isConnected) synthesisStatus.textContent = [latest.tts?.synthesis?.state, latest.tts?.synthesis?.output, latest.tts?.synthesis?.error].filter(Boolean).join(' · ');
        await refreshVisibleModels?.();
      }
    } catch (error) { if (active()) message.textContent = error.message; }
    if (active()) win.setTimeout(poll, 2000);
  };
  win.setTimeout(poll, 2000);
}
