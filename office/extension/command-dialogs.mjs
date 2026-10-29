// SPDX-License-Identifier: AGPL-3.0-only
// Presentation sizes shared by the lifecycle entry and its native dialog page.
export function commandDialog(id) {
  if (['citation', 'edit'].includes(id)) return { width: 760, height: 500 };
  if (id === 'remove') return { width: 460, height: 180 };
  return { width: 580, height: 520 };
}
