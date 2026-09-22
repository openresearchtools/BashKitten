// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Wild Buzzard's native Pi integration; see NOTICE.
import { Type } from 'typebox';
import { browserCall, captureScreenshot, saveDownload } from './client.mjs';
import { fileURLToPath } from 'node:url';

export default function bashkitten(pi) {
  pi.registerTool({
    name: 'bashkitten_browser', label: 'BashKitten browser',
    description: 'Control ordinary browser tabs. First call capabilities and read the browser skill matching that client (Android or Linux). Use explicit tabId for page actions; tabs.list lists and tabs.create {url} opens. snapshot gets element references for act. Agent, login and credential views are protected. Native approval may be required on the first Android call.',
    parameters: Type.Object({ method: Type.String(), params: Type.Optional(Type.Record(Type.String(), Type.Any())) }),
    async execute(_id, { method, params = {} }, signal) {
      let result = await browserCall(method, params, { signal });
      if (method === 'capabilities' && result?.platform) {
        const target = ['android', 'termux'].includes(result.platform) ? 'android' : result.platform === 'linux' ? 'linux' : null;
        if (target) result = { ...result, browserGuide: fileURLToPath(new URL(`./skills/browser-${target}/SKILL.md`, import.meta.url)) };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { result } };
    },
  });
  pi.registerTool({
    name: 'bashkitten_screenshot', label: 'Browser screenshot',
    description: 'Show and capture an ordinary tab by explicit tabId. Returns a PNG image and its saved private path beside the Pi session. Protected Agent/login views are excluded.',
    parameters: Type.Object({ tabId: Type.String() }),
    execute(_id, { tabId }, signal, _update, ctx) { return captureScreenshot(ctx.sessionManager, tabId, signal); },
  });
  pi.registerTool({
    name: 'bashkitten_downloads', label: 'Browser downloads',
    description: 'When the client capabilities include downloads.list/get, list browser downloads or save a completed download by downloadId to private storage beside this Pi session. Returns its actual local path for native Pi tools.',
    parameters: Type.Object({ action: Type.String({ enum: ['list', 'fetch'] }), downloadId: Type.Optional(Type.String()) }),
    async execute(_id, { action, downloadId }, signal, _update, ctx) {
      if (action === 'fetch') {
        if (!downloadId) throw Error('downloadId is required');
        return saveDownload(ctx.sessionManager, downloadId, signal);
      }
      const result = await browserCall('downloads.list', {}, { signal });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { downloads: result } };
    },
  });
}
