// SPDX-License-Identifier: AGPL-3.0-only
import { connectReferencesHost } from './host-api.mjs';
import { chooseDocumentSettings } from './document-settings.mjs';
const status = document.querySelector('#status');
try {
  const key = new URLSearchParams(location.search).get('invocation');
  if (!/^references-settings-[a-f0-9-]+$/.test(key || '')) throw Error('Document settings invocation is missing');
  const invocation = JSON.parse(sessionStorage.getItem(key)); sessionStorage.removeItem(key);
  const { api, context } = await connectReferencesHost();
  if (context.documentId !== invocation.documentId) throw Error('The document changed');
  status.hidden = true;
  const settings = await chooseDocumentSettings({ api, ...invocation });
  if (settings) window.cool.dialog.close(settings); else window.cool.dialog.cancel();
} catch (error) { status.hidden = false; status.textContent = error.message; }
