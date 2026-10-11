// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import os from 'node:os';
import { Type } from 'typebox';
import * as piSdk from '@earendil-works/pi-coding-agent';
import { lookupChats } from '../src/server/chats.mjs';

export default function chats(pi) {
  pi.registerTool({
    name: 'chats', label: 'Chats', exposure: 'deferred',
    description: 'Read-only list, plain-text search and read of this backend’s BashKitten chats. Read the chats skill. Returns stable chat/entry references and optional project names; never starts or messages another agent.',
    parameters: Type.Object({ action: Type.Union([Type.Literal('list'), Type.Literal('search'), Type.Literal('read')]),
      query: Type.Optional(Type.String()), id: Type.Optional(Type.String()), projectId: Type.Optional(Type.String()),
      leafId: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false }),
    async execute(_id, value, signal) {
      const root = path.resolve(process.env.BASHKITTEN_DATA_DIR || path.join(os.homedir(), '.local/share/bashkitten-pi'));
      const result = await lookupChats(piSdk, root, value, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
}
