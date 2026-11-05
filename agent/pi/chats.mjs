// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import os from 'node:os';
import { Type } from 'typebox';
import * as piSdk from '@earendil-works/pi-coding-agent';
import { lookupChats } from '../src/server/chats.mjs';

export default function chats(pi) {
  pi.registerTool({
    name: 'chats', label: 'Chats', exposure: 'deferred',
    description: 'Read-only Taskarian chat lookup on this backend: list finds titles/projects, search finds conversation text, and read requires the returned chat id. Read the chats skill. Returns native entry references; never starts or messages another agent.',
    parameters: Type.Object({ action: Type.Union([Type.Literal('list'), Type.Literal('search'), Type.Literal('read')]),
      query: Type.Optional(Type.String()), id: Type.Optional(Type.String()), projectId: Type.Optional(Type.String()),
      leafId: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false }),
    async execute(_id, value, signal) {
      const root = path.resolve(process.env.TASKARIAN_DATA_DIR || path.join(path.isAbsolute(process.env.XDG_DATA_HOME || '') ? process.env.XDG_DATA_HOME : path.join(os.homedir(), '.local/share'), 'Taskarian'));
      const result = await lookupChats(piSdk, root, value, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
}
