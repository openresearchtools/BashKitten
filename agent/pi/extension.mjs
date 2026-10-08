// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Wild Buzzard's native Pi integration; see NOTICE.
import { Type } from 'typebox';
import { browserCall, captureScreenshot, saveDownload } from './client.mjs';
import { browserDocumentation, browserHelp } from './browser-help.mjs';
import { searchWeb } from './search.mjs';

export default function bashkitten(pi) {
  // Stock Pi records tool_search activation and later deferred loads in the
  // native transcript. Keep user/other-extension tools in the existing set.
  pi.on('session_start', () => {
    if (!pi.getAllTools().some(tool => tool.name === 'tool_search')) throw Error('This Pi runtime needs its native tool_search extension');
    pi.setActiveTools([...new Set([...pi.getActiveTools(), 'tool_search'])]);
  });
  pi.registerTool({
    name: 'browser', label: 'Browser', exposure: 'deferred',
    description: 'Read and control ordinary browser tabs. Start with capabilities and read its browserGuide once, or call help for that guide. Use observed tab IDs and element references. Protected Agent/login views are excluded.',
    parameters: Type.Object({ method: Type.String(), params: Type.Optional(Type.Record(Type.String(), Type.Any())) }),
    async execute(_id, { method, params = {} }, signal) {
      let result = method === 'help'
        ? await browserHelp(await browserCall('capabilities', {}, { signal }))
        : await browserCall(method, params, { signal });
      if (method === 'capabilities' && result?.platform) {
        result = { ...result, ...browserDocumentation(result.platform) };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { result } };
    },
  });
  pi.registerTool({
    name: 'browser_screenshot', label: 'Browser screenshot', exposure: 'deferred',
    description: 'Show and capture an ordinary tab by explicit tabId. Returns a PNG image and its saved private path beside the Pi session. Protected Agent/login views are excluded.',
    parameters: Type.Object({ tabId: Type.Union([Type.String(), Type.Number()]) }),
    execute(_id, { tabId }, signal, _update, ctx) { return captureScreenshot(ctx.sessionManager, tabId, signal); },
  });
  pi.registerTool({
    name: 'browser_downloads', label: 'Browser downloads', exposure: 'deferred',
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
  pi.registerTool({
    name: 'websearch', label: 'Web search', exposure: 'deferred',
    description: 'Search the web or read a URL into saved Markdown. Read the websearch skill once. Supply exactly one query or url; read sources before relying on snippets.',
    parameters: Type.Object({
      query: Type.Optional(Type.String()), url: Type.Optional(Type.String()),
      maxResults: Type.Optional(Type.Integer({ minimum: 1 })),
      timeoutSeconds: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
      outputDirectory: Type.Optional(Type.String()),
      languages: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
      timestamped: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    execute(_id, value, signal) { return searchWeb(value, signal); },
  });
}
