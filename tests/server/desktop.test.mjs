import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedRemovals, profiles, methods, customProfile } from '../../src/server/platform/termux/desktop.mjs';

test('Graphics replacement permits only declared conflicts and preserves unrelated apps', () => {
  const profile = profiles.find(p => p.id === 'angle-vulkan');
  assert.deepEqual(allowedRemovals('Remv vulkan-loader-generic [1.4.363]\nRemv mesa-vulkan-icd-freedreno [26.2.3]\n', profile), ['vulkan-loader-generic', 'mesa-vulkan-icd-freedreno']);
  assert.throws(() => allowedRemovals('Remv libreoffice [26.8]\nRemv bashkitten [0.2.0]\n', profile), /libreoffice, bashkitten/);
  assert.throws(() => allowedRemovals('Remv vulkan-loader-generic [1.4.363]\n', profiles[0]), /vulkan-loader-generic/);
  assert.ok(methods.includes('environment') && methods.includes('separator') && methods.includes('custom'));
  const custom = customProfile({ name: 'My Mesa', packages: { mesa: '26.2.3' }, env: { GALLIUM_DRIVER: 'llvmpipe' }, conflicts: ['vulkan-loader-android'] });
  assert.equal(custom.id, 'custom-my-mesa');
  assert.throws(() => customProfile({ name: 'Bad', packages: { '--force-yes': '1' } }), /package names/);
  assert.throws(() => customProfile({ name: 'Bad', env: { GALLIUM_DRIVER: 'x\0y' } }), /environment/);
  assert.throws(() => allowedRemovals('Remv libreoffice [26.8]\n', custom), /libreoffice/);
});
