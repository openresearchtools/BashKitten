// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';

// This socket and credential are inherited only by the local backend's workers.
// Caddy does not publish /api/instance/* on either web listener.
export function agentRequest(value, signal) {
  const socketPath = process.env.BASHKITTEN_BACKEND_SOCKET;
  if (!socketPath) throw Error('Agent coordination requires a BashKitten chat');
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: '/api/instance/subagents', method: 'POST', signal,
      headers: { host: new URL(process.env.BASHKITTEN_ACCESS_ORIGIN).host,
        authorization: 'Bearer ' + process.env.BASHKITTEN_INSTANCE_TOKEN, 'content-type': 'application/json' } }, response => {
      let text = '';
      response.setEncoding('utf8'); response.on('data', part => { text += part; });
      response.on('error', reject);
      response.on('end', () => {
        try { const result = JSON.parse(text); if (response.statusCode !== 200) throw Error(result.error || 'Agent coordination failed'); resolve(result); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(120000, () => request.destroy(Error('Agent coordination timed out')));
    request.end(JSON.stringify(value));
  });
}
