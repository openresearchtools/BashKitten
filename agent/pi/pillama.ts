// SPDX-License-Identifier: AGPL-3.0-only
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import pillama from './vendor/pillama/index.ts';

// Our managed server uses its own native Pi provider ID. Keep custom terminal
// --pillama-provider choices, and select either built-in llama provider as the
// user changes models without restarting Pi or altering the upstream extension.
export default function extension(pi: ExtensionAPI) {
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
  });
}
