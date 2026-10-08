// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// One adapter for the existing packaged query-or-URL interface. Validation,
// extraction, saved Markdown and cancellation stay with the same helper.
const helper = fileURLToPath(new URL('../search/bashkitten-search', import.meta.url));
export function searchWeb(value, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [], { signal, stdio: ['pipe', 'pipe', 'inherit'] });
    const chunks = [];
    child.once('error', reject);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.once('close', code => {
      try {
        if (signal?.aborted) throw signal.reason || Error('Web search cancelled');
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof result.ok !== 'boolean') throw Error('Invalid search helper response');
        resolve({ content: [{ type: 'text', text: JSON.stringify(result) }],
          details: result, ...(code !== 0 || !result.ok ? { isError: true } : {}) });
      } catch (error) { reject(error); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(value));
  });
}
