// SPDX-License-Identifier: AGPL-3.0-only
// The stock provider declares the callback. Only its live native enrollment may
// return a browser redirect to that listener; Pi owns validation and credentials.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const uniqueQuery = url => new Set(url.searchParams.keys()).size === [...url.searchParams.keys()].length;

export function declaredCallback(event) {
  if (event?.type !== 'auth_url' || typeof event.url !== 'string' || event.url.length > 16384) return null;
  try {
    const authorization = new URL(event.url);
    if (!['https:', 'http:'].includes(authorization.protocol) || authorization.username || authorization.password || !uniqueQuery(authorization)) return null;
    const redirects = ['redirect_uri', 'callback_url'].filter(key => authorization.searchParams.has(key));
    if (redirects.length !== 1) return null;
    const redirect = new URL(authorization.searchParams.get(redirects[0]));
    if (redirect.protocol !== 'http:' || !loopback.has(redirect.hostname) || redirect.username || redirect.password || redirect.hash || !uniqueQuery(redirect)) return null;
    return { authorizationUrl: authorization.href, redirectUri: redirect.href, state: authorization.searchParams.get('state'), method: 'GET' };
  } catch { return null; }
}

export function enrollCallback(attempt, authorizationUrl) {
  let url;
  try { url = new URL(authorizationUrl).href; } catch { throw Error('Invalid provider login link'); }
  const descriptor = attempt.events.map(declaredCallback).find(value => value?.authorizationUrl === url);
  if (!descriptor) throw Error('This Pi login does not declare a loopback callback');
  const registration = { ...descriptor, attemptId: attempt.id, registrationId: randomUUID(), expiresAt: Date.now() + 15 * 60 * 1000 };
  clearTimeout(attempt.callbackExpiry);
  delete attempt.callbackCompletion;
  attempt.callbackRegistration = registration;
  attempt.callbackExpiry = setTimeout(() => {
    delete attempt.callbackRegistration;
    attempt.controller.abort();
  }, registration.expiresAt - Date.now());
  attempt.callbackExpiry.unref();
  return { ...registration };
}

export function finishCallback(attempt) {
  clearTimeout(attempt.callbackExpiry);
  if (attempt.callbackRegistration) {
    const { attemptId, registrationId, expiresAt } = attempt.callbackRegistration;
    attempt.callbackCompletion = { attemptId, registrationId, expiresAt };
    delete attempt.callbackRegistration;
  }
}

export function callbackRegistration(attempt, value) {
  const registration = attempt?.callbackRegistration || attempt?.callbackCompletion;
  if (!registration || attempt.id !== value.attemptId || registration.registrationId !== value.registrationId || Date.now() >= registration.expiresAt) throw Error('Provider login enrollment expired');
  return registration;
}

export function acceptCallback(registration, input) {
  if (registration.consumed || typeof input !== 'string' || input.length > 16384) throw Error('Provider callback is unavailable');
  let received;
  try { received = new URL(input); } catch { throw Error('Invalid provider callback'); }
  const expected = new URL(registration.redirectUri);
  if (received.origin !== expected.origin || received.pathname !== expected.pathname || received.username || received.password || received.hash || !uniqueQuery(received)) throw Error('Provider callback does not match this login');
  for (const [key, value] of expected.searchParams) if (received.searchParams.get(key) !== value) throw Error('Provider callback does not match this login');
  if (registration.state !== null && received.searchParams.get('state') !== registration.state) throw Error('Provider callback does not match this login');
  if (!received.searchParams.has('code') && !received.searchParams.has('error')) throw Error('Provider callback is incomplete');
  registration.consumed = true;
  return received;
}

export async function forwardCallback(registration, received, signal) {
  const destination = new URL(registration.redirectUri);
  // Never resolve page-controlled DNS, follow redirects, or return listener HTML.
  const host = destination.hostname === '[::1]' ? '::1' : '127.0.0.1';
  await new Promise((resolve, reject) => {
    const request = http.request({ hostname: host, port: Number(destination.port || 80), method: 'GET',
      path: received.pathname + received.search, headers: { host: destination.host, connection: 'close' },
      agent: false, signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) }, response => {
      let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 65536) request.destroy(Error('Provider callback response was too large')); });
      response.once('error', reject);
      response.once('end', () => response.statusCode >= 200 && response.statusCode < 300 ? resolve() : reject(Error('Pi rejected the provider callback')));
    });
    request.once('error', reject);
    request.end();
  });
}
