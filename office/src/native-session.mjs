// SPDX-License-Identifier: AGPL-3.0-only
// Native COOL document protocol. This participant owns a view, never a document engine.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export const SUPPORTED_RELEASE = { version: '26.04.5.2', hash: '42745e44dd', protocol: '0.1' };
export class OfficeError extends Error {
  constructor(code, message, details) { super(message); this.name = 'OfficeError'; this.code = code; this.details = details; }
}
const jsonAfter = (message, prefix) => JSON.parse(message.slice(prefix.length).trim());
export function nativeWebSocketUrl(grant) {
  const office = new URL(grant.editorInternalURL || grant.editorBaseUrl || grant.actionUrl);
  if (!['http:', 'https:'].includes(office.protocol)) throw new OfficeError('invalid_grant', 'Invalid Office origin');
  const source = new URL(grant.wopiSrc);
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password || source.hash) throw new OfficeError('invalid_grant', 'Invalid WOPI source');
  const documentUri = new URL(source);
  documentUri.searchParams.set('access_token', grant.accessToken);
  documentUri.searchParams.set('permission', grant.mode === 'edit' ? 'edit' : 'readonly');
  office.protocol = office.protocol === 'https:' ? 'wss:' : 'ws:';
  const root = grant.editorInternalURL || grant.editorBaseUrl ? office.pathname.replace(/\/$/, '') : '';
  office.pathname = root + '/cool/' + encodeURIComponent(documentUri.href) + '/ws';
  office.search = new URLSearchParams({ WOPISrc: source.href }).toString();
  office.hash = '';
  return { url: office.href, loadUrl: encodeURIComponent(documentUri.href) };
}

export class NativeOfficeSession extends EventEmitter {
  constructor(grant, { WebSocketImpl = WebSocket, timeoutMs = 60000, maxMessageBytes = 8 * 1024 * 1024, verifyRelease = true } = {}) {
    super();
    if (!grant?.accessToken || !grant?.wopiSrc || !grant?.participantId) throw new OfficeError('invalid_grant', 'An authenticated participant grant is required');
    this.grant = grant; this.WebSocketImpl = WebSocketImpl; this.timeoutMs = timeoutMs;
    this.maxMessageBytes = maxMessageBytes; this.verifyRelease = verifyRelease;
    this.id = randomUUID(); this.pending = new Map(); this.waiters = new Set(); this.tail = Promise.resolve();
    this.status = null; this.wopi = null; this.server = null; this.uncertain = null; this.closed = false;
  }
  async connect({ signal } = {}) {
    const { url, loadUrl } = nativeWebSocketUrl(this.grant);
    const ready = this.waitFor(message => message.startsWith('status:'), { signal });
    this.socket = new this.WebSocketImpl(url); this.socket.binaryType = 'arraybuffer';
    this.socket.addEventListener('open', () => {
      this.send('coolclient ' + SUPPORTED_RELEASE.protocol);
      this.send('load url=' + loadUrl + ' lang=en-GB');
    });
    this.socket.addEventListener('message', event => this.receive(event.data));
    this.socket.addEventListener('error', () => this.fail(new OfficeError('connection_failed', 'The authenticated Office connection failed')));
    this.socket.addEventListener('close', () => { this.closed = true; this.fail(new OfficeError('connection_closed', 'The Office participant disconnected')); this.emit('closed'); });
    try { await ready; } catch (error) { this.close(); throw error; }
    if (this.verifyRelease && (!this.server || this.server.Version !== SUPPORTED_RELEASE.version || this.server.Hash !== SUPPORTED_RELEASE.hash)) {
      this.close(); throw new OfficeError('release_mismatch', 'Office native API release has changed; run the pinned compatibility checks', this.server && { version: this.server.Version, hash: this.server.Hash });
    }
    return this;
  }
  receive(data) {
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (size > this.maxMessageBytes) { this.fail(new OfficeError('message_limit', 'Office response exceeds the configured bounded result size')); this.close(); return; }
    const message = typeof data === 'string' ? data : new TextDecoder().decode(data);
    try {
      if (message.startsWith('coolserver ')) this.server = jsonAfter(message, 'coolserver ');
      if (message.startsWith('status:') || message.startsWith('statusupdate:')) this.status = jsonAfter(message, message.startsWith('status:') ? 'status:' : 'statusupdate:');
      if (message.startsWith('wopi:')) this.wopi = jsonAfter(message, 'wopi:');
      if (message.startsWith('lastmodtime:')) this.lastModified = message.slice(12).trim();
      if (message.startsWith('viewinfo:')) this.views = jsonAfter(message, 'viewinfo:');
      if (message.startsWith('executescriptresult:')) {
        const result = jsonAfter(message, 'executescriptresult:');
        const pending = this.pending.get(result.id);
        if (pending) {
          this.pending.delete(result.id);
          if ('err' in result) pending.reject(new OfficeError('native_script_error', typeof result.err === 'string' ? result.err : result.err.message, result.err));
          else pending.resolve({ value: result.ok, legacyUnoApi: result.legacyUnoApi === true });
        }
      }
      if (message.startsWith('error:')) {
        const error = new OfficeError('native_error', message);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        for (const waiter of [...this.waiters]) waiter.reject(error);
        this.emit('nativeError', error);
      }
      // No script listener installed by this adapter requires synchronous callbacks.
      if (message.startsWith('proxycall:')) {
        const event = jsonAfter(message, 'proxycall:');
        if (event.callId != null) this.send('proxyreturn ' + event.callId + ' null');
        this.emit('documentEvent', event);
      }
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.resolve(message);
      this.emit('message', message);
    } catch (error) { this.fail(new OfficeError('protocol_error', 'Invalid native Office response', { message: error.message })); }
  }
  send(message) {
    if (this.closed || this.socket?.readyState !== 1) throw new OfficeError('connection_closed', 'The Office participant is not connected');
    this.socket.send(message);
  }
  waitFor(predicate, { signal, timeoutMs = this.timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (fn, value) => { clearTimeout(timer); this.waiters.delete(waiter); signal?.removeEventListener('abort', abort); fn(value); };
      const waiter = { predicate, resolve: value => finish(resolve, value), reject: error => finish(reject, error) };
      const abort = () => waiter.reject(new OfficeError('cancelled', 'Office operation cancelled'));
      this.waiters.add(waiter);
      timer = setTimeout(() => waiter.reject(new OfficeError('timeout', 'Office did not acknowledge the operation before the configured deadline')), timeoutMs);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
  }
  exclusive(work) { const task = this.tail.then(work); this.tail = task.catch(() => {}); return task; }
  assertEditing() {
    if (this.grant.mode !== 'edit' || this.status?.readonly || this.wopi?.UserCanWrite === false || this.wopi?.DisableCopy || this.wopi?.DisablePrint || this.wopi?.DisableExport) throw new OfficeError('native_permission', 'Native kit scripting requires an editable view with copy, print and export permissions');
    if (this.uncertain) throw new OfficeError('uncertain_mutation', 'A prior operation has an uncertain outcome; inspect and explicitly reconcile it before another edit', this.uncertain);
  }
  call(fn, args, { signal, mutation = false } = {}) {
    return this.exclusive(async () => {
      if (mutation) this.assertEditing();
      if (signal?.aborted) throw new OfficeError('cancelled', 'Office operation cancelled before dispatch');
      const id = randomUUID();
      const script = '(' + fn.toString() + ')(' + JSON.stringify(args) + ')';
      if (Buffer.byteLength(script) > this.maxMessageBytes) throw new OfficeError('request_limit', 'Office request exceeds the bounded native script limit');
      let sent = false;
      const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
      result.catch(() => {});
      const timeout = this.waitFor(message => message.startsWith('executescriptresult:') && jsonAfter(message, 'executescriptresult:').id === id, { signal });
      try {
        this.send('executescript ' + id + ' 1 bashkitten-office-native\n' + script); sent = true;
        await timeout;
        return await result;
      } catch (error) {
        // A timeout/disconnect is not evidence that an edit did not happen. Never replay it.
        if (mutation && sent && ['timeout', 'cancelled', 'connection_closed', 'connection_failed'].includes(error.code)) { this.uncertain = { operationId: id, reason: error.code }; error.details = this.uncertain; }
        result.catch(() => {}); throw error;
      } finally { this.pending.delete(id); }
    });
  }
  reconcile(operationId) {
    if (!this.uncertain || this.uncertain.operationId !== operationId) throw new OfficeError('reconcile_mismatch', 'Reconciliation must identify the uncertain operation');
    this.uncertain = null;
  }
  save({ signal } = {}) {
    return this.exclusive(async () => {
      this.assertEditing();
      const acknowledged = this.waitFor(message => message.startsWith('unocommandresult:') && jsonAfter(message, 'unocommandresult:').commandName === '.uno:Save', { signal });
      // lastmodtime is emitted after the native broker's successful WOPI upload, not just kit serialization.
      const stored = this.waitFor(message => message.startsWith('lastmodtime:'), { signal });
      stored.catch(() => {});
      this.send('save dontTerminateEdit=1 dontSaveIfUnmodified=0');
      const ack = jsonAfter(await acknowledged, 'unocommandresult:');
      if (!ack.success) throw new OfficeError('save_failed', 'Office failed to save the document', ack);
      const stamp = await stored;
      return { saved: true, lastModified: stamp.slice(12).trim(), nativeAcknowledgement: ack };
    });
  }
  prepareRestore({ signal } = {}) {
    return this.exclusive(async () => {
      if (this.grant.mode !== 'edit' || this.status?.readonly || this.wopi?.UserCanWrite === false) throw new OfficeError('native_permission', 'History restore requires an editable native participant');
      signal?.throwIfAborted();
      // The broker emits this only after its native save/upload and close sequence.
      // A socket disconnect, host message or successful kit save alone is insufficient.
      const acknowledged = this.waitFor(message => message.trim() === 'close: versionrestore: prerestore_ack', { signal });
      this.send('versionrestore prerestore');
      await acknowledged;
      return { prepared: true, nativeAcknowledgement: 'versionrestore: prerestore_ack' };
    });
  }
  saveCopy({ format, name, signal } = {}) {
    return this.exclusive(async () => {
      this.assertEditing();
      if (!['docx', 'odt', 'xlsx', 'ods', 'pptx', 'odp'].includes(format) || typeof name !== 'string' || !name.endsWith('.' + format) || /[\x00-\x1f/\\]/.test(name)) throw new OfficeError('invalid_copy', 'A copy needs a filename matching one of the six editable Office formats');
      const response = this.waitFor(message => message.startsWith('saveas:'), { signal });
      this.send('saveas url=wopi:' + encodeURIComponent(name) + ' format=' + format + ' options=');
      const raw = await response;
      const parameters = Object.fromEntries([...raw.matchAll(/(\w+)=([^ ]+)/g)].map(([, key, value]) => [key, value]));
      const copied = new URL(parameters.url), original = new URL(this.grant.wopiSrc);
      if (copied.origin !== original.origin || copied.pathname.slice(0, copied.pathname.lastIndexOf('/') + 1) !== original.pathname.slice(0, original.pathname.lastIndexOf('/') + 1) || copied.pathname === original.pathname) throw new OfficeError('copy_scope', 'Native Save As did not create an independent file on this document host');
      const documentId = decodeURIComponent(copied.pathname.slice(copied.pathname.lastIndexOf('/') + 1));
      // Never surface the new participant's access token from native saveas.
      return { documentId, name: decodeURIComponent(parameters.filename || parameters.name || name), format };
    });
  }
  export({ format = 'pdf', name = 'document.' + format, signal } = {}) {
    return this.exclusive(async () => {
      if (this.wopi?.DisableExport || this.wopi?.DisableCopy) throw new OfficeError('native_permission', 'Document export is disabled by the host');
      if (!/^[a-z0-9]{1,12}$/.test(format) || !name || /[\x00-\x1f/\\]/.test(name)) throw new OfficeError('invalid_export', 'Invalid export format or filename');
      const response = this.waitFor(message => message.startsWith('downloadas:'), { signal });
      this.send('downloadas name=' + encodeURIComponent(name) + ' id=export format=' + format + ' options=');
      const raw = await response;
      const parameters = Object.fromEntries([...raw.matchAll(/(\w+)=([^ ]+)/g)].map(([, key, value]) => [key, value]));
      if (!/^[A-Za-z0-9_-]+$/.test(parameters.downloadid || '')) throw new OfficeError('protocol_error', 'Office did not return a native download identifier');
      const download = new URL(this.grant.editorBaseUrl || this.grant.actionUrl);
      const root = this.grant.editorBaseUrl ? download.pathname.replace(/\/$/, '') : '';
      download.pathname = root + '/cool/' + encodeURIComponent(this.grant.wopiSrc) + '/download/' + parameters.downloadid;
      download.search = new URLSearchParams({ WOPISrc: this.grant.wopiSrc }).toString();
      download.hash = '';
      return { format, name, downloadUrl: download.href, singleUse: true, nativeAcknowledgement: raw };
    });
  }
  fail(error) { for (const p of this.pending.values()) p.reject(error); this.pending.clear(); for (const w of [...this.waiters]) w.reject(error); }
  close() { if (!this.closed) { this.closed = true; this.socket?.close(1000, 'Participant closed'); this.fail(new OfficeError('connection_closed', 'The Office participant disconnected')); } }
}
