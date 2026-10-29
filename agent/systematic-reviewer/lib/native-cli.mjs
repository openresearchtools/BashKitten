// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from 'node:path';
import { appsRequest, applicationRequest } from '../../pi/apps-channel.mjs';
import { readText, writeOutput } from './io.mjs';
import { importReferenceFile } from '../../pi/references-files.mjs';

export function options(args, allowed) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!allowed.includes(flag) || Object.hasOwn(result, flag)) throw Error(`Unknown or repeated argument: ${flag}`);
    if (['--overwrite', '--stdin', '--help'].includes(flag)) result[flag] = true;
    else {
      const value = args[++index];
      if (value === undefined || value.startsWith('--')) throw Error(`Missing value for ${flag}`);
      result[flag] = value;
    }
  }
  return result;
}
export function requestForSession(session = process.env.BASHKITTEN_SESSION_ID) {
  if (process.env.BASHKITTEN_WORKER_SOCKET) return appsRequest;
  return async (value, signal) => {
    if (!session) throw Error('Choose an existing authorized BashKitten session with --session, or run from its Pi worker');
    const { appsRequest: ownerRequest } = await import('../../src/server/apps/client.mjs');
    return ownerRequest({ ...value, session }, { signal });
  };
}
export async function inputFile(path, signal) {
  if (!path) return undefined;
  return JSON.parse(await readText(resolve(path), { signal, maxBytes: 16 * 1024 * 1024 }));
}
export async function publish(value, flags, signal) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (flags['--output']) {
    await writeOutput(resolve(flags['--output']), text, { overwrite: flags['--overwrite'], signal });
    process.stdout.write(`Saved ${resolve(flags['--output'])}\n`);
  } else process.stdout.write(text);
}
export async function requestCLI(args, { component = 'references', method, path, project = false, help } = {}, signal) {
  const flags = options(args, ['--session', '--project', '--method', '--path', '--input', '--file', '--encoding', '--request-id', '--output', '--overwrite', '--help']);
  if (flags['--help']) { process.stdout.write(`${help}\n`); return; }
  const projectId = flags['--project'];
  if (project && (!projectId || !/^[A-Za-z0-9._~-]+$/.test(projectId))) throw Error('--project must be an explicit project ID');
  const actualPath = project ? `/projects/${encodeURIComponent(projectId)}${path}` : flags['--path'] || path;
  if (flags['--file']) {
    if (component !== 'references' || (method || flags['--method'] || 'POST') !== 'POST')
      throw Error('--file uses References POST import or attachment capture');
    const reply = await importReferenceFile(resolve(flags['--file']), actualPath, {
      ...await inputFile(flags['--input'], signal),
      ...(flags['--encoding'] ? { encoding: flags['--encoding'] } : {}),
      ...(flags['--request-id'] ? { requestId: flags['--request-id'] } : {}),
    }, { signal, request: requestForSession(flags['--session']) });
    await publish(reply, flags, signal);
    return;
  }
  if (['--encoding', '--request-id'].some(flag => flags[flag]))
    throw Error('--encoding and --request-id require --file');
  const reply = await applicationRequest(component, method || flags['--method'] || 'GET', actualPath,
    await inputFile(flags['--input'], signal), { signal, request: requestForSession(flags['--session']) });
  await publish(reply, flags, signal);
}
export async function run(main) {
  const controller = new AbortController();
  const interrupt = () => controller.abort(Error('Operation interrupted'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try { await main(process.argv.slice(2), controller.signal); }
  catch (error) { process.stderr.write(`${controller.signal.aborted ? 'Operation interrupted' : error.message}\n`); if (error.details?.requestId) process.stderr.write(`Transfer request ID: ${error.details.requestId}. Retry the same file and request ID to recover its receipt.\n`); process.exitCode = controller.signal.aborted ? 130 : 1; }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}
