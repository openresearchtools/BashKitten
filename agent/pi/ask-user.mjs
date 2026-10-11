// SPDX-License-Identifier: AGPL-3.0-only
import { Type } from 'typebox';
import { workerRequest } from './worker-channel.mjs';
export default function askUser(pi) {
  if (!process.env.BASHKITTEN_WORKER_SOCKET) return;
  pi.registerTool({ name: 'ask_user', label: 'Ask user', exposure: 'deferred',
    description: 'Ask one optional question with suggested choices and a custom reply. Returns immediately while you keep working; the reply or 120-second expiry arrives as an attributed follow-up. Never use for required authorization. Read the ask-user skill.',
    parameters: Type.Object({ question: Type.String({ minLength: 1 }), options: Type.Optional(Type.Array(Type.String({ minLength: 1 }))) }, { additionalProperties: false }),
    async execute(toolCallId, value, signal, _update, ctx) {
      const result = await workerRequest('/questions/create', { text: value.question, options: value.options,
        toolCallId, nativeSessionId: ctx.sessionManager.getSessionId(), branchId: ctx.sessionManager.getLeafId() }, signal);
      const details = { questionId: result.questionId, status: result.status, deadline: result.deadline,
        instruction: 'Continue independent work now. Apply the attributed answer when it arrives. After expiry proceed with the best long-term solution; silence is never permission approval.' };
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    },
  });
}
