// SPDX-License-Identifier: AGPL-3.0-or-later
import { applicationRequest } from '../../pi/apps-channel.mjs';
import { browserCall } from '../../pi/client.mjs';
import { projectPath } from './client.mjs';

/** User command only: credential values never enter model messages or snapshots. */
export async function reviewSetup(args, ctx) {
  if (!ctx.hasUI) throw Error('Use scripts/setup.mjs status --project PROJECT, or set openalex --project PROJECT in an interactive terminal');
  const [action = '', selectedProject, ...rest] = args.trim().split(/\s+/);
  if (rest.length || !['', 'status', 'openalex'].includes(action)) throw Error('Use /review-setup [status|openalex] [PROJECT]');
  try {
    let projectId = selectedProject;
    if (!projectId) {
      const { body } = await applicationRequest('references', 'GET', '/projects', undefined, { signal: ctx.signal });
      const projects = Array.isArray(body) ? body : body?.projects;
      if (!Array.isArray(projects) || !projects.length) throw Error('Create a References project in the manager before configuring References');
      if (projects.length === 1) projectId = projects[0].id;
      else {
        const choices = projects.map(project => `${project.name || project.id} (${project.id})`);
        const chosen = await ctx.ui.select('References project', choices, { signal: ctx.signal });
        if (!chosen) return;
        projectId = projects[choices.indexOf(chosen)].id;
      }
    }
    const path = projectPath(projectId, '/settings');
    const { body: state } = await applicationRequest('references', 'GET', path, undefined, { signal: ctx.signal });
    const summary = `OpenAlex: ${state.openalexKeyConfigured ? 'saved key configured' : 'keyless access'}; References owns shared settings.\nAccount: https://openalex.org/settings/api`;
    if (action === 'status') { ctx.ui.notify(summary, 'info'); return; }
    const choice = await ctx.ui.select(summary, ['Open References settings', 'Enter or replace OpenAlex key', 'Remove saved OpenAlex key'], { signal: ctx.signal });
    if (!choice || ctx.signal?.aborted) return;
    if (choice === 'Open References settings') {
      const { body } = await applicationRequest('references', 'POST', '/open', { projectId }, { signal: ctx.signal });
      const url = body.url || body.browserUrl;
      if (!url) throw Error('References did not return a browser URL');
      await browserCall('tabs.create', { url }, { signal: ctx.signal });
      ctx.ui.notify('References opened. Use its settings to edit shared service configuration.', 'info');
      return;
    }
    let key = null;
    if (choice === 'Enter or replace OpenAlex key') {
      key = await ctx.ui.input('OpenAlex API key (visible while typing; blank cancels)', undefined, { signal: ctx.signal });
      if (!key?.trim() || ctx.signal?.aborted) return;
      key = key.trim();
    }
    await applicationRequest('references', 'PATCH', path, { openalexKey: key }, { signal: ctx.signal });
    ctx.ui.notify(key === null ? 'Saved OpenAlex key removed.' : 'OpenAlex key saved in the owning backend.', 'info');
  } catch {
    ctx.ui.notify('References setup failed. Check project access and service availability; no credential value was logged.', 'error');
  }
}
