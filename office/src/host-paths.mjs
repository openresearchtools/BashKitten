// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';
const packageRoot = new URL('../../', import.meta.url);
export const agentPackageRoot = new URL(existsSync(new URL('build-platform.json', packageRoot)) ? './' : 'agent/', packageRoot);
