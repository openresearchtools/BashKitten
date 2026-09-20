import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedRemovals, profiles, methods } from '../../src/server/platform/termux/desktop.mjs';

test('Graphics replacement permits only declared conflicts and preserves unrelated apps', () => {
  const profile = profiles.find(p => p.id === 'angle-vulkan');
  assert.deepEqual(allowedRemovals('Remv vulkan-loader-generic [1.4.363]\nRemv mesa-vulkan-icd-freedreno [26.2.3]\n', profile), ['vulkan-loader-generic', 'mesa-vulkan-icd-freedreno']);
  assert.throws(() => allowedRemovals('Remv libreoffice [26.8]\nRemv bashkitten [0.2.0]\n', profile), /libreoffice, bashkitten/);
  assert.throws(() => allowedRemovals('Remv vulkan-loader-generic [1.4.363]\n', profiles[0]), /vulkan-loader-generic/);
  assert.ok(methods.includes('environment') && methods.includes('separator') && methods.includes('custom'));
});
