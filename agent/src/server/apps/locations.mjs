// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';

// Source components are repository peers of agent/. Installed components are
// peers of src/ and pi/ in the existing app package. The package's authoritative
// build stamp selects that layout; never search unrelated component locations.
const agentRoot = new URL('../../../', import.meta.url);
export const componentRoot = new URL(existsSync(new URL('build-platform.json', agentRoot)) ? './' : '../', agentRoot);
export const applicationModules = {
  files: new URL('files/provider.mjs', componentRoot),
  references: new URL('references/index.mjs', componentRoot),
  office: new URL('office/src/service.mjs', componentRoot),
  officeProvider: new URL('files/office-provider.mjs', componentRoot),
  officePrepare: new URL('office/src/prepare.mjs', componentRoot),
};
export const referencesWebRoot = new URL('references/web/', componentRoot);
