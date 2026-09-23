// SPDX-License-Identifier: GPL-3.0-only
// Changed JavaScript adaptation of BashKitten Rust / SimpleHF; see third_party/NOTICE.
import { getHuggingFaceToken } from './settings.mjs';

const origin = 'https://huggingface.co';
export const modelError = message => Object.assign(Error(message), { modelError: true });
export function repositoryId(value) {
  if (typeof value !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(value) || value.split('/').some(x => x === '.' || x === '..')) throw modelError('Use a Hugging Face repository ID such as organization/model');
  return value;
}
export function revisionId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw modelError('Choose a repository with a pinned commit revision');
  return value;
}
export function repositoryPath(value) {
  if (typeof value !== 'string' || !value || /[\\\x00-\x1f\x7f]/.test(value) || value.split('/').some(x => !x || x === '.' || x === '..' || x.startsWith('.bashkitten-'))) throw modelError('The repository contains an unsafe file path');
  return value;
}
const encodedPath = value => value.split('/').map(encodeURIComponent).join('/');
const allowedHost = host => host === 'huggingface.co' || host.endsWith('.huggingface.co') || host.endsWith('.hf.co') || host.endsWith('.amazonaws.com');
export function publicModelError(error) {
  if (error?.modelError) return error.message;
  if (error?.code === 'ENOSPC') return 'The models folder has no free space';
  if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) return 'The models folder is not writable';
  if (['ELOOP', 'ENOTDIR'].includes(error?.code)) return 'A download path was replaced or contains a symbolic link';
  return 'The model request failed; check the connection and available disk space, then retry';
}
function statusError(status) {
  if ([401, 403].includes(status)) return modelError('Hugging Face denied access; check your saved token and accept the repository terms');
  if (status === 404) return modelError('Hugging Face repository, revision or file was not found');
  if (status === 429) return modelError('Hugging Face rate limit reached; try again later');
  return modelError(`Hugging Face returned HTTP ${status}`);
}

// Never forward a bearer token to a CDN, even if a later redirect returns home.
// Do not include response bodies, signed URLs or underlying fetch errors in errors.
export async function hfRequest(route, { signal, range } = {}) {
  let url = new URL(route, origin), token = await getHuggingFaceToken();
  if (url.origin !== origin) throw modelError('Invalid Hugging Face request');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timer;
  const resetTimeout = () => { clearTimeout(timer); timer = setTimeout(abort, 60000); timer.unref?.(); };
  const close = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); };
  try {
    const seen = new Set();
    for (;;) {
      if (seen.has(url.href)) throw modelError('Hugging Face returned a redirect cycle');
      seen.add(url.href);
      resetTimeout();
      const headers = { 'Accept-Encoding': 'identity' };
      if (token) headers.Authorization = 'Bearer ' + token;
      if (range) headers.Range = range;
      const response = await fetch(url, { headers, redirect: 'manual', signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw modelError('Hugging Face returned a redirect without a destination');
        const next = new URL(location, url);
        if (next.protocol !== 'https:' || next.username || next.password || (next.port && next.port !== '443') || !allowedHost(next.hostname)) throw modelError('Hugging Face returned an unsafe download redirect');
        if (next.origin !== origin) token = '';
        url = next;
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw statusError(response.status); }
      return { response, resetTimeout, close };
    }
  } catch (error) { close(); throw error?.modelError ? error : modelError('Hugging Face could not be reached; check your connection and retry'); }
}
async function jsonRequest(route, signal) {
  const request = await hfRequest(route, { signal });
  try {
    const chunks = [];
    for await (const chunk of request.response.body) {
      request.resetTimeout();
      chunks.push(chunk);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw modelError('Hugging Face returned invalid metadata'); }
    return { value, headers: request.response.headers };
  } finally { request.close(); }
}
export async function searchModels({ query } = {}) {
  if (typeof query !== 'string' || !query.trim()) throw modelError('Enter a model name to search');
  const parameters = new URLSearchParams({ search: query.trim(), filter: 'gguf', sort: 'downloads', direction: '-1' });
  const { value } = await jsonRequest('/api/models?' + parameters);
  if (!Array.isArray(value)) throw modelError('Hugging Face returned invalid search results');
  return { models: value.filter(x => typeof x.id === 'string').map(x => ({ id: x.id, downloads: Number(x.downloads) || 0, likes: Number(x.likes) || 0 })) };
}
export async function repositoryFiles(id, requestedRevision, signal) {
  id = repositoryId(id);
  const metadata = await jsonRequest(`/api/models/${encodedPath(id)}${requestedRevision ? '/revision/' + revisionId(requestedRevision) : ''}`, signal);
  const revision = revisionId(metadata.value.sha);
  if (requestedRevision && revision !== requestedRevision) throw modelError('Hugging Face returned a different repository revision');
  const prefix = `/api/models/${encodedPath(id)}/tree/${revision}`;
  let next = prefix + '?recursive=true&expand=false';
  const seen = new Set(), files = new Map();
  while (next) {
    if (seen.has(next)) throw modelError('Hugging Face repository listing has repeated pages');
    seen.add(next);
    const { value, headers } = await jsonRequest(next, signal);
    if (!Array.isArray(value)) throw modelError('Hugging Face returned invalid repository files');
    for (const item of value) {
      if (item.type !== 'file') continue;
      const path = repositoryPath(item.path), size = item.size;
      if (!Number.isSafeInteger(size) || size < 0) throw modelError('Hugging Face did not report a valid file size');
      const hash = item.lfs?.oid || item.oid;
      if (typeof hash !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) throw modelError('Hugging Face did not report a valid file identity');
      files.set(path, { path, size, gguf: /\.gguf$/i.test(path), hash });
    }
    next = null;
    for (const link of (headers.get('link') || '').split(',')) {
      if (!/rel="?next"?/.test(link)) continue;
      const target = link.match(/<([^>]+)>/);
      if (!target) throw modelError('Invalid Hugging Face listing continuation');
      const url = new URL(target[1], origin);
      if (url.origin !== origin || url.username || url.password || url.pathname !== prefix) throw modelError('Invalid Hugging Face listing continuation');
      next = url.pathname + url.search;
    }
  }
  return { id, revision, gated: metadata.value.gated || false, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}
export async function modelRepository({ id } = {}) {
  const result = await repositoryFiles(id);
  return { ...result, files: result.files.map(({ hash, ...file }) => file) };
}
export const resolvePath = (repository, revision, file) => `/${encodedPath(repository)}/resolve/${revisionId(revision)}/${encodedPath(file)}?download=true`;
