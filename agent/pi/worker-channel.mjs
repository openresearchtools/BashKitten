// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
export function workerRequest(route, value, signal) {
  const socketPath = process.env.BASHKITTEN_WORKER_SOCKET, key = process.env.BASHKITTEN_WORKER_KEY;
  if (!socketPath || !key) throw Error('This tool requires a live BashKitten Pi worker');
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: route, method: 'POST', signal,
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' } }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', part => { data += part; });
      res.on('error', reject); res.on('end', () => { try { const result = JSON.parse(data); if (res.statusCode !== 200) throw Error(result.error || 'Worker rejected request'); resolve(result); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(Error('Question service did not respond'))); req.end(JSON.stringify(value));
  });
}
