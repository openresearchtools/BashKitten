// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function browserDocumentation(platform) {
  const target = ['android', 'termux'].includes(platform) ? 'android' : platform === 'linux' ? 'linux' : null;
  if (!target) return null;
  const root = new URL(`./skills/browser-${target}/`, import.meta.url);
  const topics = target === 'linux' ? ['tabs', 'input', 'files', 'debug'] : ['tabs', 'input', 'files'];
  return {
    browserGuide: fileURLToPath(new URL('SKILL.md', root)),
    browserHelp: Object.fromEntries(topics.map(topic => [topic, fileURLToPath(new URL(`references/${topic}.md`, root))])),
    help: 'Call help with params.topic for one command reference, or read its browserHelp path.',
  };
}

export async function browserHelp(capabilities, topic) {
  const docs = browserDocumentation(capabilities?.platform);
  if (!docs) throw Error('The connected browser did not identify a supported platform');
  if (!topic) return { platform: capabilities.platform, ...docs };
  if (!Object.hasOwn(docs.browserHelp, topic)) throw Error(`Unknown help topic. Use: ${Object.keys(docs.browserHelp).join(', ')}`);
  return { platform: capabilities.platform, topic, content: await readFile(docs.browserHelp[topic], 'utf8') };
}
