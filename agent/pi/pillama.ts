// SPDX-License-Identifier: AGPL-3.0-only
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import pillama from './vendor/pillama/index.ts';

// Our managed server uses its own native Pi provider ID. Keep custom terminal
// --pillama-provider choices, and select either built-in llama provider as the
// user changes models without restarting Pi or altering the upstream extension.
export default function extension(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  let provider = 'llama.cpp';
  const selectProvider = (_event: unknown, ctx: ExtensionContext) => {
    const selected = ctx.model?.provider;
    provider = selected === 'bashkitten-llama' || selected?.startsWith('bashkitten-remote-') ? selected : 'llama.cpp';
  };
  pi.on('session_start', selectProvider);
  pi.on('model_select', selectProvider);
  pi.on('before_provider_request', selectProvider);
  pillama({
    ...pi,
    getFlag(name) {
      const value = pi.getFlag(name);
      return name === 'pillama-provider' && value === 'llama.cpp' ? provider : value;
    },
  }, {
    agentDir,
    async isGeneratedProvider(id, definition) {
      if (!/^bashkitten-(?:llama|remote-[a-f0-9]{48}-[a-z0-9_-]{1,64})$/.test(id)) return false;
      try {
        // The owned Pi profile is $BASHKITTEN_DATA_DIR/pi on both platforms.
        const owner = JSON.parse(await readFile(join(dirname(agentDir), 'access/managed-providers', id + '.json'), 'utf8'));
        return isDeepStrictEqual(definition, owner?.provider) || isDeepStrictEqual(definition, owner?.pending);
      } catch { return false; }
    },
  });
}
