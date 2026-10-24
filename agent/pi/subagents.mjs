// SPDX-License-Identifier: AGPL-3.0-only
import { Type } from 'typebox';
import { agentRequest } from './agent-channel.mjs';

export default function subagents(pi) {
  if (!process.env.BASHKITTEN_SESSION_ID) return;
  const request = (ctx, value, signal) => agentRequest({ ...value,
    session: ctx.sessionManager.getSessionId(), chat: process.env.BASHKITTEN_SESSION_ID }, signal);
  const configure = async ctx => {
    const { settings, canMessage } = await request(ctx, { action: 'settings' });
    // Hidden tools cannot be discovered/called, even through codemode. When
    // permitted, native tool_search loads the deferred schema on demand.
    pi.registerTool({ ...tool, exposure: settings.enabled || canMessage ? 'deferred' : 'hidden' });
  };
  const tool = {
    name: 'agents', label: 'Agents', exposure: 'hidden',
    description: 'Coordinate other agent sessions, never talk to the user: use a normal assistant reply for the user. Read the subagents skill. list returns real IDs; spawn delegates, send steers a busy recipient at the next safe boundary or starts an idle turn, follow_up explicitly resumes a stopped recipient, and stop stops a direct child. Never target your own ID. Completed child turns automatically reach the parent.',
    parameters: Type.Object({ action: Type.String({ enum: ['list', 'spawn', 'send', 'follow_up', 'stop'] }),
      id: Type.Optional(Type.String({ description: 'Another agent session ID from list; never self or the user.' })), name: Type.Optional(Type.String()),
      message: Type.Optional(Type.String({ description: 'Task or coordination message for the recipient agent, not a user-facing reply.' })) }),
    async execute(toolCallId, value, signal, _update, ctx) {
      const result = await request(ctx, { ...value, deliveryId: toolCallId }, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  };
  pi.registerTool(tool);
  pi.on('session_start', async (_event, ctx) => configure(ctx));
  pi.registerCommand('bashkitten-agents-refresh', { description: 'Reload this chat’s saved subagent settings',
    handler: async (_args, ctx) => configure(ctx) });
}
