// SPDX-License-Identifier: AGPL-3.0-only
// Settings have no Pi session. Reuse Pillama 0.4.0's conservative template
// detector here without importing its Pi SDK into the native control owner.
// Detector adapted from pi/vendor/pillama/thinking.ts, Copyright (c) 2026
// openresearchtools (MIT; full license retained with the pristine donor).
const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export function templateControls(template, caps = {}) {
  if (typeof template !== 'string' || template.length > 128 * 1024) return;
  const source = template.replace(/\{#[\s\S]*?#\}/g, '');
  const blocks = [...source.matchAll(/\{%[-+]?([\s\S]*?)[-+]?%\}/g)];
  const toggle = blocks.some(b => /\bif\s+enable_thinking\b/.test(b[1]));
  if (caps.supports_reasoning_effort === true) {
    for (const effort of ['reasoning_effort', 'reasoning_strength']) {
      const variables = new Set([effort]);
      for (const block of blocks) {
        const alias = block[1].trim().match(/^set\s+(\w+)\s*=\s*(\w+)(?:\s*\||\s*$)/);
        if (alias && variables.has(alias[2])) variables.add(alias[1]);
        const guard = block[1].trim().match(/^if\s+(\w+)\s+not\s+in\s*[\[(]([^\])]+)[\])]$/);
        if (!guard || !variables.has(guard[1])) continue;
        const following = source.slice(block.index + block[0].length).split(/\{%/)[0];
        if (!/\{\{[-+]?\s*raise_exception\(/.test(following)) continue;
        const literals = guard[2].split(',').map(s => s.trim());
        if (literals.at(-1) === '') literals.pop();
        if (literals.length > levels.length || literals.some(s => !/^(['"])[a-z]+\1$/.test(s))) return;
        const values = literals.map(s => s.slice(1, -1));
        if (!values.length || values.some(v => v === 'off' || !levels.includes(v))) return;
        return { levels: levels.filter(l => values.includes(l)), effort, toggle };
      }
    }
    return;
  }
  return toggle ? { levels: ['medium'], toggle: true } : undefined;
}

/** Probe native rendering only; never loads a model or submits inference. */
export async function verifiedThinking(props, render) {
  const detection = templateControls(props.chat_template, props.chat_template_caps);
  if (!detection) return null;
  const prompts = await Promise.all(detection.levels.map(level => render({ ...(detection.toggle ? { enable_thinking: true } : {}), ...(detection.effort ? { [detection.effort]: level } : {}) })));
  if (prompts.some(prompt => typeof prompt !== 'string' || !prompt) || detection.effort && new Set(prompts).size < 2) return null;
  if (detection.toggle) {
    const off = await render({ enable_thinking: false });
    if (typeof off !== 'string' || !off || prompts.some(prompt => prompt === off)) return null;
    detection.levels = ['off', ...detection.levels];
  }
  return detection;
}

const nativeReasoningKey = /^\s*(?:reasoning|rea|LLAMA_ARG_REASONING|reasoning-effort|LLAMA_ARG_REASONING_EFFORT)\s*=/;
const templateKwargsLine = /^\s*(?:chat-template-kwargs|LLAMA_ARG_CHAT_TEMPLATE_KWARGS)\s*=(.*)$/;
export function thinkingSelection(extra = '') {
  const values = Object.fromEntries(extra.split(/\r?\n/).flatMap(line => {
    if (!nativeReasoningKey.test(line)) return [];
    const [key, ...value] = line.trim().split('='); return [[key.trim(), value.join('=').split(/[;#]/)[0].trim()]];
  }));
  if (['off', 'false', '0', 'disabled'].includes(values.reasoning || values.rea || values.LLAMA_ARG_REASONING)) return 'off';
  let kwargs = {};
  try { kwargs = JSON.parse(extra.split(/\r?\n/).map(line => templateKwargsLine.exec(line)?.[1]).findLast(Boolean) || '{}'); } catch { /* Custom input stays unchanged. */ }
  const effort = values['reasoning-effort'] || values.LLAMA_ARG_REASONING_EFFORT || kwargs?.reasoning_effort || kwargs?.reasoning_strength;
  if (levels.includes(effort)) return effort;
  return ['on', 'true', '1', 'enabled'].includes(values.reasoning || values.rea || values.LLAMA_ARG_REASONING) ? 'medium' : 'auto';
}

export function thinkingParameters(extra, selected, capabilities) {
  if (selected === undefined) return extra;
  if (selected === thinkingSelection(extra)) return extra;
  if (selected !== 'auto' && !capabilities?.levels.includes(selected)) throw Error('Use this model once to verify its supported reasoning choices, then select an available level.');
  const kwargs = {};
  const previous = extra.split(/\r?\n/).filter(line => {
    if (nativeReasoningKey.test(line)) return false;
    const match = templateKwargsLine.exec(line);
    if (!match) return true;
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('The native chat template parameters must be a JSON object.');
    Object.assign(kwargs, parsed); return false;
  }).join('\n');
  for (const key of ['enable_thinking', 'reasoning_effort', 'reasoning_strength']) delete kwargs[key];
  if (selected !== 'auto' && selected !== 'off' && capabilities.effort === 'reasoning_strength') kwargs.reasoning_strength = selected;
  return previous + (selected === 'auto' ? '' : '\nreasoning = ' + (selected === 'off' ? 'off' : 'on') +
    (selected !== 'off' && capabilities.effort === 'reasoning_effort' ? '\nreasoning-effort = ' + selected : '')) +
    (Object.keys(kwargs).length ? '\nchat-template-kwargs = ' + JSON.stringify(kwargs) : '');
}
