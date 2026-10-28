// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from 'node:url';
import { SERVICES, ConfigError, serviceStatus, saveServiceKey, removeServiceKey } from './services.mjs';

const setup = `node '${fileURLToPath(new URL('../scripts/setup.mjs', import.meta.url)).replaceAll("'", "'\\''")}'`;
const statusText = state => state.source === 'environment' ? `using ${state.environmentVariable}`
  : state.configured ? 'using a saved local key' : 'no key configured';
const links = service => `${service.name}: ${service.accountUrl}${service.signupUrl ? `\nCreate an account: ${service.signupUrl}` : ''}`;

/** User-invoked Pi dialogs only: never append credentials to model/session messages. */
export async function reviewSetup(args, ctx, { env = process.env } = {}) {
  // Pi's print/JSON UI methods are no-ops. A command error is surfaced by Pi.
  if (!ctx.hasUI) throw new Error(`Use /review-setup in interactive Pi, or run ${setup} status and ${setup} set openalex in your terminal. Add --web for a temporary local browser form.`);
  try {
    const choice = args.trim();
    if (choice && choice !== 'status' && !Object.hasOwn(SERVICES, choice)) {
      ctx.ui.notify('Use /review-setup [status|openalex]. Local Zotero needs no key. Enter the OpenAlex key in the setup dialog or hidden terminal prompt, never as command arguments.', 'error');
      return;
    }
    const status = await serviceStatus({ env });
    const summary = Object.entries(SERVICES).map(([id, service]) => `${service.name}: ${statusText(status.services[id])}`).join('\n');
    if (choice === 'status') {
      ctx.ui.notify(`${summary}\nLocal Zotero needs no API key.\n${Object.values(SERVICES).map(links).join('\n')}`, 'info');
      return;
    }
    const selected = choice || await ctx.ui.select(`${summary}\nLocal Zotero needs no API key.`, Object.values(SERVICES).map(service => service.name), { signal: ctx.signal });
    const id = choice || Object.keys(SERVICES).find(id => SERVICES[id].name === selected);
    if (!id || ctx.signal?.aborted) return;
    const service = SERVICES[id];
    const action = await ctx.ui.select(`${links(service)}\n${statusText(status.services[id])}`, [
      'Enter or replace saved key', 'Use hidden terminal prompt', 'Use browser setup', 'Remove saved key',
    ], { signal: ctx.signal });
    if (!action || ctx.signal?.aborted) return;
    if (action === 'Use browser setup') {
      ctx.ui.notify(`Run this command and open the printed local URL in your browser:\n${setup} set ${id} --web\nEnter the key yourself in the page. Select Done when finished.`, 'info');
      return;
    }
    if (action === 'Use hidden terminal prompt') {
      ctx.ui.notify(`Open ${service.accountUrl} to obtain your key, then run in your terminal:\n${setup} set ${id}\nThe terminal prompt hides your input.`, 'info');
      return;
    }
    let updated;
    if (action === 'Enter or replace saved key') {
      const key = await ctx.ui.input(`${service.name} API key (visible as you type; leave empty to cancel)`, undefined, { signal: ctx.signal });
      if (!key?.trim() || ctx.signal?.aborted) return;
      updated = await saveServiceKey(id, key, { env });
    } else if (action === 'Remove saved key') updated = await removeServiceKey(id, { env });
    else return;
    const state = updated.services[id];
    ctx.ui.notify(`${service.name}: ${action === 'Remove saved key' ? 'saved key removed' : 'key saved locally'}; ${statusText(state)}.`, 'info');
  } catch (error) {
    ctx.ui.notify(error instanceof ConfigError ? error.message : 'Setup failed; check local configuration permissions. No key was included in this message.', 'error');
  }
}
