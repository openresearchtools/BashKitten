// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { runtimeInfo, managedRuntimeEnvironment } from './runtimes.mjs';
import { launchInference } from './launch.mjs';
import { transcribeAudio } from './dictation.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const response = value => Buffer.from(JSON.stringify(value));
async function waitForCleanup(finished, signal) {
  signal.throwIfAborted();
  let cancelled;
  try {
    await Promise.race([finished, new Promise((_, reject) => {
      cancelled = () => reject(signal.reason);
      signal.addEventListener('abort', cancelled, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', cancelled); }
}
async function readExact(stream, length, signal) {
  const parts = []; let size = 0;
  while (size < length) {
    signal.throwIfAborted();
    const part = stream.read(length-size);
    if (part) { parts.push(part); size += part.length; continue; }
    if (stream.readableEnded || stream.destroyed) throw Error('Speech helper closed its output');
    await once(stream, 'readable', { signal });
  }
  return Buffer.concat(parts);
}

/** Owned by the private controller, never a web/remote speech endpoint. */
export class PhoneSpeech {
  constructor(localAI) { this.localAI = localAI; this.captures = new Map(); this.requests = new Map(); }
  async synthesisAvailable(value, signal) {
    const previous = this.synthesis;
    if (previous && this.localAI.synthesis === previous.child && uuid(value.callId) && previous.callId === value.callId) {
      // A keypad transition may reach us before its separate cancel packet.
      // Only that same call's explicitly cancelled request can be superseded.
      if (value.cancelledRequestId === previous.requestId) previous.abort.abort();
      if (previous.abort.signal.aborted) await waitForCleanup(previous.finished, signal);
    }
    signal.throwIfAborted();
    if (this.localAI.stopping || this.localAI.synthesis) throw Error('Speech synthesis is busy');
  }
  async vadFiles() {
    const runtime = await runtimeInfo('whisper');
    if (!runtime?.capabilities?.streamingVad) throw Error('Download the current Whisper runtime in LocalAI to enable call speech detection');
    const executable = path.join(path.dirname(runtime.binary), 'bashkitten-vad');
    const model = path.join(path.dirname(path.dirname(runtime.binary)), 'models', 'ggml-silero-v6.2.0.bin');
    await fs.access(executable, fs.constants.X_OK); await fs.access(model);
    return { runtime, executable, model };
  }
  async ready() {
    try {
      if (!(await this.localAI.speechCapability()).available) throw Error('Set up Whisper or Parakeet in LocalAI');
      await this.vadFiles(); await this.ttsCommand('Ready', '/proc/self/fd/3');
      return { ready: true };
    } catch (error) { return { ready: false, error: error.message }; }
  }
  async ttsCommand(text, output) {
    if (typeof text !== 'string' || !text.trim() || text.includes('\0')) throw Error('Speech text is empty or invalid');
    const config = (await this.localAI.config()).tts;
    const runtime = await this.localAI.binary('llama', config);
    for (const file of [config.model, config.projector, config.voice]) {
      if (!file) throw Error('Set up the TTS model, projector and reference voice in LocalAI');
      await fs.access(file);
    }
    const executable = path.join(path.dirname(runtime.binary), 'llama-tts');
    await fs.access(executable, fs.constants.X_OK);
    // Released TTS treats even -n -1 as 512 frames; this loop ceiling does not
    // allocate memory or size context. Let model EOS/cancellation finish speech.
    return { argv: [executable, '-m', config.model, '-mm', config.projector, '-p', text, '-n', '2147483647',
      '--tts-speaker-file', config.voice, '--output', output,
      '--device', runtime.devices.find(item => item.backend === runtime.backend)?.id || 'none',
      '-ngl', runtime.backend === 'cpu' ? '0' : '999', ...(runtime.backend === 'cpu' ? ['--no-mmproj-offload'] : []),
      ...(config.modelKind === 'qwen3' ? ['--tts-lang', config.language] : [])], cwd: config.cwd, env: runtime.env };
  }
  async request(action, value = {}) {
    action = action.replace(/^phone\./, '');
    if (action === 'speech.ready') return this.ready();
    if (action === 'speech.cancel') { this.cancel(value.requestId); return { ok: true }; }
    if (!uuid(value.captureId)) throw Error('Invalid speech capture identity');
    if (action === 'speech.vad.close') { this.cancel(value.captureId); return { ok: true }; }
    if (action !== 'speech.vad.open') throw Error('Unknown speech request');
    if (this.captures.has(value.captureId)) throw Error('Speech capture already exists');
    const entry = { abort: new AbortController(), sequence: 0, serial: Promise.resolve() };
    this.captures.set(value.captureId, entry);
    try {
      const { runtime, executable, model } = await this.vadFiles(); entry.abort.signal.throwIfAborted();
      const child = launchInference({ argv: [executable, model], env: managedRuntimeEnvironment(runtime.binary, {}, 'cpu') }, { signal: entry.abort.signal });
      entry.child = child;
      child.stdin.on('error', () => {}); child.on('error', () => entry.abort.abort());
      child.once('close', () => { entry.abort.abort(); if (this.captures.get(value.captureId) === entry) this.captures.delete(value.captureId); });
      const ready = await readExact(child.stdout, 6, entry.abort.signal);
      if (ready.toString() !== 'READY\n') throw Error('Invalid VAD helper greeting');
      return { ready: true };
    } catch (error) { this.cancel(value.captureId); throw error; }
  }
  cancel(id) {
    this.requests.get(id)?.abort();
    const capture = this.captures.get(id);
    if (capture) { this.captures.delete(id); capture.abort.abort(); capture.child?.stdin.end(); }
  }
  close() { for (const id of [...this.captures.keys(), ...this.requests.keys()]) this.cancel(id); }
  async audio(action, bytes, value = {}, signal) {
    action = action.replace(/^phone\./, '');
    if (action === 'speech.vad.frame') {
      const capture = this.captures.get(value.captureId);
      if (!capture || bytes.length !== 1024 || !Number.isSafeInteger(value.sequence)) throw Error('Invalid VAD frame');
      const cancel = () => this.cancel(value.captureId);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const pending = capture.serial.then(async () => {
        capture.abort.signal.throwIfAborted();
        if (value.sequence !== capture.sequence + 1) throw Error('VAD frame sequence changed');
        capture.sequence = value.sequence;
        await new Promise((resolve,reject) => capture.child.stdin.write(bytes, error => error ? reject(error) : resolve()));
        const result = await readExact(capture.child.stdout, 4, capture.abort.signal), probability = result.readFloatLE();
        if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw Error('Invalid VAD probability');
        return response({ probability });
      });
      capture.serial = pending.catch(() => this.cancel(value.captureId));
      try { return await pending; } finally { signal?.removeEventListener('abort', cancel); bytes.fill(0); }
    }
    if (!uuid(value.requestId) || this.requests.has(value.requestId)) throw Error('Invalid or duplicate speech request');
    const abort = new AbortController(); this.requests.set(value.requestId, abort);
    const cancelled = () => abort.abort(); signal?.addEventListener('abort', cancelled, {once:true});
    if (signal?.aborted) abort.abort();
    try {
      abort.signal.throwIfAborted();
      if (action === 'speech.transcribe') return response(await transcribeAudio(bytes, {
        signal: abort.signal, acquire: id => this.localAI.acquireSpeech(id), release: (id, completed) => this.localAI.releaseSpeech(id, completed),
      }));
      if (action !== 'speech.synthesize') throw Error('Unknown speech operation');
      await this.synthesisAvailable(value, abort.signal);
      const command = await this.ttsCommand(value.text, '/proc/self/fd/3'); abort.signal.throwIfAborted();
      await this.synthesisAvailable(value, abort.signal);
      abort.signal.throwIfAborted();
      if (this.localAI.stopping || this.localAI.synthesis) throw Error('Speech synthesis is busy');
      const child = launchInference(command, { signal: abort.signal, outputPipe: true }), chunks = [];
      this.localAI.synthesis = child; this.localAI.synthesisState = { state: 'generating' };
      let release;
      const owner = { child, abort, callId: value.callId, requestId: value.requestId, finished: new Promise(resolve => { release = resolve; }) };
      this.synthesis = owner; this.localAI.synthesisFinished = owner.finished;
      let processError;
      // AbortError arrives before process/group cleanup. Keep the shared lease
      // until close, which also follows an error when spawning fails.
      const finished = new Promise((resolve,reject) => {
        child.once('error', error => { processError = error; });
        child.once('close', code => processError ? reject(processError) : code === 0 ? resolve() : reject(Error('Call speech synthesis failed')));
      });
      child.stdout?.on('data', chunk => chunks.push(chunk)); child.stdin?.on('error', () => {}); child.stdin?.end();
      try {
        await finished; abort.signal.throwIfAborted();
        const wav = Buffer.concat(chunks);
        if (wav.length < 44 || wav.toString('ascii',0,4) !== 'RIFF' || wav.toString('ascii',8,12) !== 'WAVE') { wav.fill(0); throw Error('TTS returned invalid WAV audio'); }
        return wav;
      } finally {
        for (const chunk of chunks) chunk.fill(0);
        if (child.exitCode === null) child.kill('SIGTERM');
        if (this.localAI.synthesis === child) { this.localAI.synthesis = null; this.localAI.synthesisState = { state: 'idle' }; }
        if (this.synthesis === owner) this.synthesis = null;
        release();
      }
    } finally { bytes.fill(0); signal?.removeEventListener('abort',cancelled); this.requests.delete(value.requestId); }
  }
}
