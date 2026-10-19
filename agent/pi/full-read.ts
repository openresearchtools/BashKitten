// SPDX-License-Identifier: AGPL-3.0-only
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "typebox";
import { estimateTokens, SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const HEADROOM = 20_000;
const FILE_FRACTION = 0.70;
const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
const modelKey = (ctx: ExtensionContext) => `${ctx.model?.provider}/${ctx.model?.id}`;

export default function (pi: ExtensionAPI) {
  let soleCall: string | undefined;
  let pending: { handoff: string; session: string; model: string } | undefined;
  let compacting = false;

  // Enforce the instruction before any full document is returned.
  pi.on("message_end", ({ message }) => {
    if (message.role !== "assistant") return;
    const calls = message.content.filter(block => block.type === "toolCall");
    soleCall = calls.length === 1 ? calls[0].id : undefined;
  });
  const alone = (id: string) => {
    if (id !== soleCall) throw Error("Use exactly one tool call in this response. Read exactly one file at a time.");
  };
  const cancel = () => { pending = undefined; soleCall = undefined; };
  pi.on("input", cancel);
  pi.on("agent_start", cancel);
  pi.on("session_before_switch", cancel);
  pi.on("session_before_fork", cancel);
  pi.on("session_before_tree", cancel);
  pi.on("session_shutdown", cancel);
  pi.on("model_select", cancel);

  function budget(ctx: ExtensionContext) {
    const usage = ctx.getContextUsage();
    if (!ctx.model || !usage || usage.tokens === null || !Number.isFinite(usage.tokens) || usage.tokens < 0 || !Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) {
      throw Error("Context usage is unavailable. Do not read the full file until Pi reports current usage.");
    }
    const reserve = SettingsManager.inMemory(pi.getSettings()).getCompactionSettings(ctx.model).reserveTokens;
    return { used: usage.tokens, window: usage.contextWindow, available: usage.contextWindow - reserve - HEADROOM - usage.tokens };
  }

  pi.registerTool({
    name: "full-read", label: "Read full file",
    description: "Read ONE UTF-8 text/code file in full. Call ALONE, never in a tool batch. Uses Pi estimates; refuses >70% context or <20k headroom before compaction. On compact_required, compact_context then retry once; if still refused, read in chunks.",
    parameters: Type.Object({ path: Type.String({ minLength: 1 }) }),
    exposure: "model-only", executionMode: "sequential",
    async execute(id, { path }, signal, _update, ctx) {
      alone(id);
      const initial = budget(ctx), model = modelKey(ctx);
      const filename = resolve(ctx.cwd, path);
      // Nonblocking open rejects special files; streaming bounds memory even if a file grows.
      const file = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK);
      let text = "";
      try {
        if (!(await file.stat()).isFile()) throw Error("Expected a regular UTF-8 text file.");
        const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
        for await (const chunk of file.createReadStream({ autoClose: false, signal })) {
          text += decoder.decode(chunk, { stream: true });
          if (text.includes("\0")) throw Error("Binary/NUL-containing files are unsupported. Supply UTF-8 text.");
          if (Math.ceil(text.length / 4) > initial.window * FILE_FRACTION) {
            throw Error("File exceeds 70% of model context (Pi estimate). Read in chunks.");
          }
        }
        text += decoder.decode();
      } finally { await file.close(); }
      signal?.throwIfAborted();
      if (modelKey(ctx) !== model || ctx.hasPendingMessages()) throw Error("Model or queued input changed. Retry this read alone after pending input is processed.");
      const output = result(text);
      const tokens = estimateTokens({ role: "toolResult", toolCallId: id, toolName: "full-read", ...output, isError: false, timestamp: Date.now() });
      const current = budget(ctx);
      if (tokens > current.window * FILE_FRACTION) throw Error("File exceeds 70% of model context (Pi estimate). Read in chunks.");
      if (tokens > current.available) {
        throw Error(`compact_required: file ~${tokens} tokens; current context ~${current.used}/${current.window}; available with 20k headroom ~${Math.max(0, current.available)}. Call compact_context alone with a brief handoff, then retry full-read once. If it still does not fit, read in chunks.`);
      }
      return output;
    },
  });

  pi.registerTool({
    name: "compact_context", label: "Compact context",
    description: "Compact with Pi, then resume your handoff. Call ALONE. Handoff: task, essential findings, next file path. Afterward retry full-read once; if refused, use chunks. Previously read files may be summarized.",
    parameters: Type.Object({ handoff: Type.String({ minLength: 1, maxLength: 4000 }) }),
    exposure: "model-only", executionMode: "sequential",
    async execute(id, { handoff }, signal, _update, ctx) {
      alone(id);
      signal?.throwIfAborted();
      if (pending || compacting || ctx.hasPendingMessages()) throw Error("Compaction or queued input is already pending.");
      pending = { handoff, session: ctx.sessionManager.getSessionId(), model: modelKey(ctx) };
      return { ...result("Compaction pending. Pi will resume with the handoff after completion."), terminate: true };
    },
  });

  // Manual compaction aborts the active run, so start only after this tool run settles.
  pi.on("agent_settled", (event, ctx) => {
    if (compacting || !pending) return;
    const request = pending;
    const valid = () => pending === request && request.session === ctx.sessionManager.getSessionId() && request.model === modelKey(ctx);
    if (event.aborted || !ctx.isIdle() || ctx.hasPendingMessages() || !valid()) { cancel(); return; }
    compacting = true;
    ctx.compact({
      customInstructions: `Preserve this handoff for continuing the task:\n${request.handoff}`,
      onComplete: () => {
        compacting = false;
        const resume = valid() && ctx.isIdle() && !ctx.hasPendingMessages();
        pending = undefined;
        if (resume) pi.sendMessage({ customType: "full-read-compaction", content: `Compaction completed. Continue this task:\n${request.handoff}\nCall full-read alone to recheck space before loading a file. If it still does not fit, read in chunks; do not compact again for that read.`, display: true }, { triggerTurn: true });
      },
      onError: error => {
        compacting = false;
        const report = valid();
        pending = undefined;
        if (report) pi.sendMessage({ customType: "full-read-compaction", content: `Compaction failed or was cancelled: ${error.message}`, display: true }, { triggerTurn: false });
      },
    });
  });
}
