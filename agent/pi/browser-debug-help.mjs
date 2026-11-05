// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const guides = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).taskarian?.browserDebugGuides;

export function browserDebugDocumentation(platform) {
  const target = ['android', 'termux'].includes(platform) ? 'android' : platform === 'linux' ? 'linux' : null;
  if (!target) return null;
  return {
    browserDebugGuide: fileURLToPath(new URL(guides?.[target] || `./skills/browser-debugging-${target}/SKILL.md`, import.meta.url)),
    help: 'Read browserDebugGuide once, or call help for the same complete skill. It includes every command and parameter.',
  };
}

export async function browserDebugHelp(capabilities) {
  const docs = browserDebugDocumentation(capabilities?.platform);
  if (!docs) throw Error('The connected browser did not identify a supported platform');
  return { platform: capabilities.platform, ...docs, content: await readFile(docs.browserDebugGuide, 'utf8') };
}
