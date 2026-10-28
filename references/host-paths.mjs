// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync } from 'node:fs';

// Source references/ is beside agent/. The installed package places References,
// Systematic Reviewer and Search beside one another. Its build stamp identifies
// that fixed layout; no service or filesystem discovery is performed.
const packageRoot = new URL('../', import.meta.url);
export const agentPackageRoot = new URL(existsSync(new URL('build-platform.json', packageRoot)) ? './' : 'agent/', packageRoot);
export const citationParser = new URL('systematic-reviewer/lib/markdown.mjs', agentPackageRoot);
