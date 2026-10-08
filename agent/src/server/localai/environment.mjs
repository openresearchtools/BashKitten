// SPDX-License-Identifier: AGPL-3.0-only
// A host-selected out-of-tree plugin must not leak into a downloaded engine.
// Custom runtimes may opt in through their explicit command environment.
export function engineEnvironment(overrides = {}) {
  const { GGML_BACKEND_PATH, ...inherited } = process.env;
  return { ...inherited, ...overrides };
}
