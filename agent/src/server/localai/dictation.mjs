// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { controlRequest } from '../control.mjs';
import { launchInference } from './launch.mjs';

async function parakeet(command, audio, signal) {
  // Upstream reads -f - into its in-memory WAV decoder. The existing process
  // guard disables core dumps and owns every child; audio never gets a path.
  const child = launchInference(command, { signal });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk));
  child.stdin.on('error', () => {});
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(Error('Parakeet transcription failed; check the selected model and device')));
  });
  try {
    child.stdin.end(audio); await ended; signal.throwIfAborted();
    const text = Buffer.concat(output).toString('utf8').trim();
    if (!text) throw Error('Parakeet did not return a transcript');
    return { text };
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    for (const chunk of output) chunk.fill(0);
  }
}

/** Authenticated operation only. No formBody, jobs, staging files or content logs. */
export async function transcribe(req, res, watchAuthorization) {
  if (req.headers['content-type'] !== 'audio/wav') throw Error('Dictation requires PCM WAV audio');
  const id = randomUUID(), abort = new AbortController(), chunks = [];
  let audio, completed = false;
  const cancel = () => { abort.abort(); void controlRequest('whisper-release', { id }).catch(() => {}); };
  res.once('close', cancel);
  const stopWatching = watchAuthorization(cancel);
  try {
    for await (const chunk of req) { abort.signal.throwIfAborted(); chunks.push(chunk); }
    audio = Buffer.concat(chunks); for (const chunk of chunks) chunk.fill(0); chunks.length = 0;
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE' ||
        audio.toString('ascii', 12, 16) !== 'fmt ' || audio.readUInt32LE(16) !== 16 || audio.readUInt16LE(20) !== 1 ||
        audio.readUInt16LE(22) !== 1 || audio.readUInt32LE(24) !== 16000 || audio.readUInt16LE(34) !== 16 ||
        audio.toString('ascii', 36, 40) !== 'data' || audio.readUInt32LE(40) !== audio.length - 44 || audio.readUInt32LE(4) !== audio.length - 8) throw Error('Invalid mono 16 kHz PCM recording');
    abort.signal.throwIfAborted();
    const ready = await controlRequest('whisper-acquire', { id });
    abort.signal.throwIfAborted();
    if (ready.id === id && ready.kind === 'parakeet') {
      const result = await parakeet(ready.command, audio, abort.signal); completed = true; return result;
    }
    if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(ready.url) || ready.id !== id) throw Error('Whisper did not provide its owned endpoint');
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/wav' }), 'recording.wav');
    form.append('response_format', 'json'); form.append('temperature', '0');
    const response = await fetch(ready.url + '/inference', { method: 'POST', body: form, signal: abort.signal, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw Error(`Whisper transcription failed (HTTP ${response.status})`); }
    const result = await response.json();
    if (typeof result.text !== 'string') throw Error('Whisper returned an invalid transcript');
    abort.signal.throwIfAborted();
    completed = true;
    return { text: result.text.trim() };
  } finally {
    res.off('close', cancel); stopWatching(); abort.abort();
    audio?.fill(0); for (const chunk of chunks) chunk.fill(0);
    await controlRequest('whisper-release', { id, completed });
  }
}
