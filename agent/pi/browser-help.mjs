// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const guides = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).bashkitten?.browserGuides;

export function browserDocumentation(platform) {
  const target = ['android', 'termux'].includes(platform) ? 'android' : platform === 'linux' ? 'linux' : null;
  if (!target) return null;
  return {
    browserGuide: fileURLToPath(new URL(guides?.[target] || `./skills/browser-${target}/SKILL.md`, import.meta.url)),
    help: 'Read browserGuide once, or call help for the same complete skill. It includes every command and parameter.',
  };
}

export async function browserHelp(capabilities) {
  const docs = browserDocumentation(capabilities?.platform);
  if (!docs) throw Error('The connected browser did not identify a supported platform');
  return { platform: capabilities.platform, ...docs, content: await readFile(docs.browserGuide, 'utf8') };
}
