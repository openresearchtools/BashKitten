/* SPDX-License-Identifier: AGPL-3.0-only */
import { node, field, check, button, confirm } from './ui.mjs';

/** Native owners supply the destinations and resolve every saved startup choice. */
export async function renderSection({ root, call, signal }) {
  root.append(node(root, 'p', 'Choose what starts automatically. These are the same choices shown in each service’s settings.'));
  const body = node(root, 'div'), status = node(root, 'p');
  status.setAttribute('role', 'status'); root.append(body, status);
  const active = () => !signal.aborted && root.isConnected;
  let busy = false;
  const run = async work => {
    if (busy || !active()) return;
    busy = true; status.textContent = '';
    const controls = [...root.querySelectorAll('button,input,textarea,select')].map(element => [element, element.disabled]);
    for (const [element] of controls) element.disabled = true;
    try { await work(); }
    catch (error) { if (active()) status.textContent = error.message; }
    finally {
      busy = false;
      for (const [element, disabled] of controls) if (element.isConnected) element.disabled = disabled;
    }
  };
  const action = (parent, title, work) => button(parent, title, () => run(work));
  const load = async () => draw(await call('autostart.get'));
  const saveCommands = async (environment, commands) => {
    await call('autostart.commands.save', { environmentId: environment.id, revision: environment.revision, commands });
    await load();
  };
  function draw(snapshot) {
    if (!active()) return;
    body.replaceChildren();
    const groups = new Map();
    for (const entry of snapshot.entries || []) {
      const group = entry.group || 'Services';
      let section = groups.get(group);
      if (!section) {
        section = node(body, 'section'); section.append(node(body, 'h2', group));
        groups.set(group, section); body.append(section);
      }
      const enabled = typeof entry.enabled === 'boolean' ? check(section, entry.label, entry.enabled) : null;
      if (!enabled) section.append(node(section, 'p', entry.label));
      else enabled.disabled = entry.available === false;
      if (entry.detail) section.append(node(section, 'p', entry.detail));
      if (enabled) enabled.onchange = () => {
        const value = enabled.checked; enabled.checked = entry.enabled === true;
        void run(async () => { await call('autostart.set', { id: entry.id, enabled: value }); await load(); });
      };
    }
    body.append(node(body, 'h2', 'Custom commands'));
    body.append(node(body, 'p', 'Startup switches apply when the environment next starts. Removing a command also stops its current process.'));
    for (const environment of snapshot.environments || []) {
      const section = node(body, 'section'); section.className = 'connection-card';
      section.append(node(section, 'h3', environment.name)); body.append(section);
      if (environment.detail) section.append(node(section, 'p', environment.detail));
      if (environment.file) {
        section.append(node(section, 'p', 'Configuration file'), node(section, 'code', environment.file));
      }
      if (environment.available === false) continue;
      for (const command of environment.commands || []) {
        const row = node(section, 'div'); section.append(row);
        const enabled = check(row, `Start ${command.name} automatically`, command.enabled === true);
        enabled.onchange = () => {
          const value = enabled.checked; enabled.checked = command.enabled === true;
          void run(() => saveCommands(environment, environment.commands.map(item => item.id === command.id ? { ...item, enabled: value } : item)));
        };
        const current = environment.status?.find(item => item.id === command.id);
        if (current) row.append(node(row, 'p', [current.state, current.exitCode != null ? `Exit ${current.exitCode}` : '', current.error,
          current.savedForNextStart ? 'Saved changes apply on next start' : ''].filter(Boolean).join(' · ')));
        action(row, `Edit ${command.name}`, () => edit(environment, command));
        action(row, `Remove ${command.name}`, async () => {
          if (await confirm(root, { title: `Remove ${command.name}?`, message: 'Remove this startup command and stop its owned process if it is running. Its files are kept.' }, signal)) {
            await saveCommands(environment, environment.commands.filter(item => item.id !== command.id));
          }
        });
      }
      if (!environment.commands?.length) section.append(node(section, 'p', 'No custom commands.'));
      action(section, 'Add command', () => edit(environment));
    }
    if (!snapshot.environments?.length) body.append(node(body, 'p', 'No local execution environment is available.'));
    action(body, 'Refresh', load);
  }
  function edit(environment, command) {
    if (!active()) return;
    body.replaceChildren();
    const form = node(body, 'form'); body.append(form);
    form.append(node(form, 'h2', `${command ? 'Edit' : 'Add'} command · ${environment.name}`));
    const name = field(form, 'Name', command?.name || '', { required: '' });
    const enabled = check(form, 'Start automatically', command?.enabled ?? true);
    const program = field(form, 'Program', command?.argv?.[0] || '', { required: '', spellcheck: 'false' });
    form.append(node(form, 'p', 'Use the full program path in this environment. Arguments are passed as written, without shell expansion.'));
    const originalArgs = command?.argv?.slice(1) || [], originalEnv = command?.env || {};
    const argumentText = originalArgs.join('\n').replace(/\r\n?/g, '\n');
    const environmentText = Object.entries(originalEnv).map(([key, value]) => `${key}=${value}`).join('\n').replace(/\r\n?/g, '\n');
    const args = field(form, 'Arguments (one per line)', argumentText, { multiline: true, rows: 4, spellcheck: 'false' });
    const cwd = field(form, 'Working folder', command?.cwd || '', { required: '', spellcheck: 'false' });
    const env = field(form, 'Environment variables (NAME=value per line)', environmentText, { multiline: true, rows: 4, spellcheck: 'false' });
    const save = async () => {
      if (!form.reportValidity()) return;
      if (!name.value.trim()) throw Error('Enter a name for this command.');
      if (!program.value.startsWith('/')) throw Error('Enter the full program path, starting with /.');
      // Unchanged values retain their exact array/object, including empty values
      // and configuration-file values containing literal newlines.
      if (args.value !== argumentText && originalArgs.some(value => /[\r\n]/.test(value))) throw Error('This command has an argument containing a line break. Change that argument in its configuration file.');
      if (env.value !== environmentText && Object.values(originalEnv).some(value => /[\r\n]/.test(value))) throw Error('This command has an environment value containing a line break. Change that value in its configuration file.');
      const argumentsList = args.value === argumentText ? originalArgs : args.value === '' ? [] : args.value.split('\n');
      let variables = originalEnv;
      if (env.value !== environmentText) {
        variables = Object.create(null);
        for (const line of env.value.split('\n').filter(value => value.trim())) {
          const match = /^([A-Za-z_][A-Za-z_0-9]*)=(.*)$/.exec(line);
          if (!match) throw Error('Write each environment variable as NAME=value, without spaces before the name.');
          if (Object.hasOwn(variables, match[1])) throw Error(`Environment variable ${match[1]} is listed twice.`);
          variables[match[1]] = match[2];
        }
      }
      if (!cwd.value.startsWith('/')) throw Error('Enter the full working folder path in this environment.');
      const next = { id: command?.id || root.ownerDocument.defaultView.crypto.randomUUID(), name: name.value.trim(), enabled: enabled.checked,
        argv: [program.value, ...argumentsList], cwd: cwd.value, env: variables };
      const commands = environment.commands || [];
      await saveCommands(environment, command ? commands.map(item => item.id === command.id ? next : item) : [...commands, next]);
    };
    action(form, 'Save command', save); action(form, 'Cancel', load);
    form.onsubmit = event => { event.preventDefault(); void run(save); }; name.focus();
  }
  action(body, 'Retry', load);
  await run(load);
}
