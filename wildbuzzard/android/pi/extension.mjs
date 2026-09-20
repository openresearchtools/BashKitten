// SPDX-License-Identifier: AGPL-3.0-or-later
import { Type } from 'typebox';
import { browserCall, captureScreenshot, saveDownload, sessionLocation } from './client.mjs';

const methods = ['capabilities', 'tabs.list', 'tabs.create', 'tabs.show', 'tabs.close', 'navigate', 'back', 'forward', 'reload', 'stop',
  'snapshot', 'act', 'read', 'evaluate', 'wait', 'console', 'clearConsole', 'viewport', 'diagnostics', 'tabs.setDesktopMode', 'tabs.setAdblocking', 'downloads.accept'];

export default function wildBuzzard(pi) {
  pi.registerTool({
    name: 'wildbuzzard_browser', label: 'Wild Buzzard',
    description: 'Control the Android browser for this Pi chat. Create a tab with tabs.create {url}; show it with tabs.show {tabId}; inspect snapshot {tabId,depth,maxNodes}; if truncated, request snapshot {tabId,target} with a container reference to inspect that subtree; use act {tabId,kind,target,value} with an opaque reference from that snapshot. navigate uses {tabId,url}. evaluate uses {tabId,code} with a JavaScript function body and return. Tabs and downloaded files are isolated to this chat. Use capabilities for supported methods and diagnostics for actual remote-debugging flags. Approval, when required, is once per Android app through /wildbuzzard-authorize or browser Settings > Agent access.',
    promptSnippet: 'Browse real websites in Android Wild Buzzard with DOM trees and page actions',
    promptGuidelines: ['Use wildbuzzard_browser snapshots to obtain element references before acting; take a fresh snapshot after navigation.',
      'Use wildbuzzard_screenshot for images and wildbuzzard_downloads to copy browser downloads into this chat’s private session storage.'],
    parameters: Type.Object({ method: Type.String({ enum: methods }), params: Type.Optional(Type.Record(Type.String(), Type.Any())) }),
    async execute(_id, { method, params = {} }, signal, _update, ctx) {
      const { scope } = sessionLocation(ctx.sessionManager);
      const result = await browserCall(method, params, { scope, signal });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { result } };
    },
  });
  pi.registerTool({
    name: 'wildbuzzard_screenshot', label: 'Browser screenshot',
    description: 'Show and capture one browser tab owned by this chat. Returns an image visible to the model and an absolute PNG path in the Pi session directory. Uses private app-to-app transfer; no shared-storage permission.',
    promptSnippet: 'Capture a browser tab as an image and a private session file',
    parameters: Type.Object({ tabId: Type.String() }),
    execute(_id, { tabId }, signal, _update, ctx) { return captureScreenshot(ctx.sessionManager, tabId, signal); },
  });
  pi.registerTool({
    name: 'wildbuzzard_downloads', label: 'Browser downloads',
    description: 'List this chat’s browser downloads, or fetch a completed download by downloadId into this Pi session. The result gives an absolute private file path usable by read. Pending downloads can be accepted with wildbuzzard_browser downloads.accept {tabId,downloadId}.',
    promptSnippet: 'List browser downloads or copy one into this session',
    parameters: Type.Object({ action: Type.String({ enum: ['list', 'fetch'] }), downloadId: Type.Optional(Type.String()) }),
    async execute(_id, { action, downloadId }, signal, _update, ctx) {
      if (action === 'fetch') {
        if (!downloadId) throw new Error('downloadId is required for fetch');
        return saveDownload(ctx.sessionManager, downloadId, signal);
      }
      const result = await browserCall('downloads.list', {}, { ...sessionLocation(ctx.sessionManager), signal });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { downloads: result } };
    },
  });
  pi.registerCommand('wildbuzzard-authorize', {
    description: 'Allow this terminal app to use Wild Buzzard; publisher-signed apps are allowed automatically',
    async handler(_args, ctx) {
      await browserCall(null, {}, { authorize: true });
      ctx.ui.notify('Wild Buzzard access enabled for this Android app', 'info');
    },
  });
}
