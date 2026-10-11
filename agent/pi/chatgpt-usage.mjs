// SPDX-License-Identifier: AGPL-3.0-only
import { cachedUsage, selectedUsageAuth, usageText } from './chatgpt-usage-data.mjs';
export default function chatGPTUsage(pi) {
  let generation = 0, identity, inflight, controller;
  const publish = (ctx, snapshot) => {
    const text = usageText(snapshot);
    if (ctx.mode === 'tui') ctx.ui.setWidget('chatgpt-usage', text ? [text] : undefined, { placement: 'belowEditor' });
    else ctx.ui.setStatus('chatgpt-usage', text || undefined);
    if (ctx.mode === 'rpc') ctx.ui.setStatus('chatgpt-usage:data', snapshot ? JSON.stringify(snapshot) : undefined);
  };
  const refresh = (ctx, clear = false) => {
    if (clear) { generation++; controller?.abort(); inflight = null; identity = null; publish(ctx, null); }
    if (inflight) return;
    const current = generation;
    controller = new AbortController(); const signal = controller.signal;
    inflight = (async () => {
      const auth = await selectedUsageAuth(ctx);
      if (current !== generation) return;
      if (!auth) { identity = null; publish(ctx, ctx.model && ['openai', 'openai-codex'].includes(ctx.model.provider) ? { status: 'unavailable', observedAt: Date.now(), buckets: [] } : null); return; }
      if (identity !== auth.identity) { identity = auth.identity; publish(ctx, null); }
      const result = await cachedUsage(auth, process.env.BASHKITTEN_DATA_DIR, signal);
      if (current !== generation || signal.aborted) return;
      // Logout/account change may occur during the request. Resolve through Pi
      // once more and discard the old identity's response without publishing it.
      const latest = await selectedUsageAuth(ctx);
      if (current !== generation) return;
      if (latest?.identity !== auth.identity) { identity = null; publish(ctx, null); return; }
      publish(ctx, result);
    })().catch(() => { if (current === generation && !signal.aborted) publish(ctx, { status: 'unavailable', observedAt: Date.now(), buckets: [] }); })
      .finally(() => { if (current === generation) inflight = null; });
  };
  pi.on('session_start', (_event, ctx) => { refresh(ctx, true); });
  pi.on('model_select', (_event, ctx) => { refresh(ctx, true); });
  pi.on('turn_end', (_event, ctx) => { refresh(ctx); });
  pi.on('session_shutdown', () => { generation++; controller?.abort(); });
  pi.registerCommand('bashkitten-usage-refresh', { description: 'Refresh the selected subscription usage status', handler: async (args, ctx) => { refresh(ctx, args.trim() === 'invalidate'); } });
}
