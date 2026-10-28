// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { SERVICES, ConfigError, serviceStatus, saveServiceKey, removeServiceKey } from './services.mjs';

const MAX_BODY = 8192;
const REQUEST_TIMEOUT = 5000;
const MAX_LIFETIME = 10 * 60 * 1000;

function page(nonce, selected) {
  const cards = Object.entries(SERVICES).map(([id, service]) => `
    <section aria-labelledby="${id}-title">
      <h2 id="${id}-title">${service.name}</h2>
      <p id="${id}-status" class="state">Checking configuration…</p>
      <p><a href="${service.accountUrl}" target="_blank" rel="noopener noreferrer">Open account / API key settings ↗</a>${service.signupUrl ? ` · <a href="${service.signupUrl}" target="_blank" rel="noopener noreferrer">Create an account ↗</a>` : ''}</p>
      <form data-service="${id}" method="post">
        <label for="${id}-key">New API key</label>
        <input id="${id}-key" type="password" autocomplete="new-password" spellcheck="false" maxlength="4096" required>
        <div class="actions"><button type="submit">Save / replace key</button><button type="button" data-remove="${id}" class="secondary">Remove saved key</button></div>
      </form>
    </section>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Research service setup</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;padding:24px;background:#f5f7fa;color:#172334;font:16px/1.5 system-ui,sans-serif}main{max-width:760px;margin:auto}h1{font-size:1.8rem;line-height:1.2}h2{font-size:1.2rem;margin-top:0}section{background:white;border:1px solid #cbd5e1;border-radius:10px;padding:24px;margin:20px 0}a{color:#174e94}label{display:block;font-weight:600;margin-bottom:6px}input{font:inherit;width:100%;border:1px solid #64748b;border-radius:5px;padding:10px}button{font:inherit;font-weight:600;cursor:pointer;border:1px solid #174e94;border-radius:5px;padding:10px 14px;background:#174e94;color:white}.secondary{background:white;color:#174e94}button:disabled{opacity:.6;cursor:wait}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px}:focus-visible{outline:3px solid #d18b00;outline-offset:3px}.state{font-weight:600}#notice{min-height:1.5em}#path{overflow-wrap:anywhere;color:#475569;font-size:.9rem}.footnote{color:#475569;font-size:.9rem}@media(max-width:480px){body{padding:16px}section{padding:18px}.actions button{width:100%}}
</style></head><body><main>
<h1>Connect OpenAlex</h1>
<p>Open your OpenAlex account settings, copy your key, then paste it here. Saved keys are never shown or prefilled.</p>
<p>Local Zotero needs no API key. Keep your usual Zotero profile open with local API access enabled.</p>
<p id="notice" role="status" aria-live="polite"></p>
${cards}
<p id="path"></p>
<p class="footnote">Keys are stored in a private plaintext file on this computer. Environment variables override saved keys. “Configured” means a key is available; setup does not contact the service to validate it.</p>
<p class="footnote">This page runs only on this computer and closes automatically within 10 minutes. Choose Done to stop it now.</p>
<button id="done" type="button">Done — close setup</button>
<noscript><p>JavaScript is required for this local setup page. You can also use the hidden terminal setup prompt.</p></noscript>
</main><script nonce="${nonce}">
const notice = document.getElementById('notice');
let finished = false;
function busy(value) { document.querySelectorAll('button').forEach(button => { button.disabled = value; }); }
async function request(action, body) {
  const response = await fetch('api/' + action, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Setup request failed.');
  return data;
}
function render(data) {
  document.getElementById('path').textContent = 'Credential file: ' + data.configPath;
  for (const [id, state] of Object.entries(data.services)) {
    document.getElementById(id + '-status').textContent = state.source === 'environment' ? 'Configured via ' + state.environmentVariable + ' (overrides saved keys)' : state.configured ? 'Configured via saved key' : 'No key configured';
  }
}
async function update(action, body, message) {
  busy(true);
  try { render(await request(action, body)); notice.textContent = message; }
  catch (error) { notice.textContent = error.message === 'Failed to fetch' ? 'Setup is closed or unavailable. Start the setup command again to continue.' : error.message; }
  finally { if (!finished) busy(false); }
}
document.querySelectorAll('form').forEach(form => form.addEventListener('submit', event => {
  event.preventDefault();
  const input = document.getElementById(form.dataset.service + '-key');
  const key = input.value;
  input.value = '';
  update('save', { service: form.dataset.service, key }, 'Key saved. The active source is shown above.');
}));
document.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
  document.getElementById(button.dataset.remove + '-key').value = '';
  update('remove', { service: button.dataset.remove }, 'Saved key removed. Environment overrides remain unchanged.');
}));
document.getElementById('done').addEventListener('click', async () => {
  document.querySelectorAll('input').forEach(input => { input.value = ''; });
  busy(true);
  try { await request('done', {}); finished = true; notice.textContent = 'Setup closed. You can close this tab.'; }
  catch { notice.textContent = 'Setup is already closed or unavailable. You can close this tab.'; finished = true; }
});
request('status').then(render).catch(error => { notice.textContent = error.message; });
const selected = ${JSON.stringify(selected ?? '')};
if (selected) document.getElementById(selected + '-key').focus();
</script></body></html>`;
}

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function bodyJSON(request) {
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks = [];
    const cleanup = () => {
      clearTimeout(timer);
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('aborted', onAborted);
      request.removeListener('error', onAborted);
    };
    const fail = error => { cleanup(); request.pause(); reject(error); };
    const onAborted = () => fail(new RequestError(400, 'Request was interrupted.'));
    const onData = chunk => {
      length += chunk.length;
      if (length > MAX_BODY) return fail(new RequestError(413, 'Request body is too large.'));
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { reject(new RequestError(400, 'Expected a valid JSON object.')); return; }
      if (!value || typeof value !== 'object' || Array.isArray(value)) reject(new RequestError(400, 'Expected a JSON object.'));
      else resolve(value);
    };
    const timer = setTimeout(() => fail(new RequestError(408, 'Request body timed out.')), REQUEST_TIMEOUT);
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onAborted);
  });
}

/** A temporary user-operated localhost page, never a background daemon. */
export async function startSetupServer({ service, env = process.env, port = 0, timeoutMs = MAX_LIFETIME, signal } = {}) {
  if (service !== undefined && !Object.hasOwn(SERVICES, service)) throw new ConfigError('Only openalex uses API-key setup. Local Zotero needs no key.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('Setup port must be an integer from 0 to 65535.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_LIFETIME) throw new ConfigError('Setup lifetime must be between 1 millisecond and 10 minutes.');
  if (signal?.aborted) throw new ConfigError('Setup was cancelled.');
  const capability = randomBytes(32).toString('base64url');
  const nonce = randomBytes(24).toString('base64');
  const base = `/${capability}/`;
  const html = page(nonce, service);
  let origin, expectedHost, expiry, stopping = false;
  const active = new Set();
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: REQUEST_TIMEOUT, requestTimeout: REQUEST_TIMEOUT, keepAliveTimeout: 1000 }, (request, response) => {
    const work = handle(request, response);
    active.add(work);
    void work.finally(() => active.delete(work));
  });
  server.setTimeout(REQUEST_TIMEOUT, socket => socket.destroy());
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  server.once('close', () => { void Promise.allSettled([...active]).then(resolveClosed); });
  async function close() {
    if (!stopping) {
      stopping = true;
      clearTimeout(expiry);
      signal?.removeEventListener('abort', onAbort);
      server.close();
      server.closeAllConnections();
    }
    await closed;
  }
  const onAbort = () => { void close(); };
  function send(response, code, value, contentType = 'application/json; charset=utf-8') {
    response.writeHead(code, {
      'Content-Type': contentType, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      'Connection': 'close',
    });
    response.end(contentType.startsWith('text/html') ? value : JSON.stringify(value));
  }
  async function handle(request, response) {
    try {
      if (request.headers.host !== expectedHost) throw new RequestError(403, 'Invalid local request host.');
      const path = request.url;
      if (![base, `${base}api/status`, `${base}api/save`, `${base}api/remove`, `${base}api/done`].includes(path)) throw new RequestError(404, 'Setup route not found.');
      if (request.method === 'GET' && path === base) { send(response, 200, html, 'text/html; charset=utf-8'); return; }
      if (request.method === 'GET' && path === `${base}api/status`) { send(response, 200, await serviceStatus({ env })); return; }
      if (request.method !== 'POST' || ![`${base}api/save`, `${base}api/remove`, `${base}api/done`].includes(path)) throw new RequestError(405, 'Method not allowed.');
      if (request.headers.origin !== origin) throw new RequestError(403, 'Invalid local request origin.');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') || request.headers['content-encoding']) throw new RequestError(415, 'Use an uncompressed application/json request.');
      if (Number(request.headers['content-length'] ?? 0) > MAX_BODY) throw new RequestError(413, 'Request body is too large.');
      const body = await bodyJSON(request);
      if (stopping) throw new RequestError(503, 'Setup is closing.');
      const action = path.slice(`${base}api/`.length);
      const allowed = action === 'save' ? ['service', 'key'] : action === 'remove' ? ['service'] : [];
      if (Object.keys(body).some(key => !allowed.includes(key)) || (action !== 'done' && !Object.hasOwn(SERVICES, body.service))) throw new RequestError(400, 'Invalid setup request fields.');
      if (action === 'done') {
        response.once('finish', () => { void close(); });
        send(response, 200, { closed: true });
      } else send(response, 200, action === 'save' ? await saveServiceKey(body.service, body.key, { env }) : await removeServiceKey(body.service, { env }));
    } catch (error) {
      if (!response.destroyed && !response.headersSent) send(response, error instanceof RequestError ? error.status : 400, { error: error instanceof RequestError || error instanceof ConfigError ? error.message : 'Setup request failed; no credential details were logged.' });
    }
  }
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port }, () => { server.removeListener('error', reject); resolve(); });
    });
  } catch { throw new ConfigError('Cannot start the local setup server; check that the port is available.'); }
  expectedHost = `127.0.0.1:${server.address().port}`;
  origin = `http://${expectedHost}`;
  server.on('error', onAbort);
  expiry = setTimeout(onAbort, timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) { await close(); throw new ConfigError('Setup was cancelled.'); }
  return { url: `${origin}${base}`, close, closed };
}
