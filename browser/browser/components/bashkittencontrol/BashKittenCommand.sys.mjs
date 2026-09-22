/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { BrowserControl } from "chrome://remote/content/bashkitten/BrowserControl.sys.mjs";

/** The native executable and remote channel share the same ordinary-tab dispatcher. */
export async function handleBashKittenCommand(request, signal) {
  try {
    await new Promise(resolve => Services.tm.dispatchToMainThread(resolve));
    if (request.version !== 1 || !Array.isArray(request.argv) ||
        !request.argv.every(value => typeof value === "string") ||
        typeof request.cwd !== "string" || !PathUtils.isAbsolute(request.cwd)) {
      throw new Error("Invalid BashKitten native command");
    }
    if (signal?.aborted) throw new Error("Browser command was cancelled");
    const argv = request.argv.filter(value => value !== "--no-start");
    if (argv.length === 1 && argv[0] === "--agent-json") {
      const command = JSON.parse(request.stdin ?? "");
      const result = await BrowserControl.execute(command, { cwd: request.cwd, signal });
      return { exitCode: 0, stdout: `${JSON.stringify({ result })}\n`, stderr: "" };
    }
    const json = argv.includes("--json");
    const args = argv.filter(value => value !== "--json");
    const command = args.shift() ?? "help";
    let value;
    if (command === "status") {
      value = { running: true, browserPid: Services.appinfo.processID,
        socketPath: request.socketPath, transport: "unix", runtime: "gecko" };
    } else if (command === "version") {
      value = { package: "bashkitten", version: Services.appinfo.version, protocolVersion: 1 };
    } else if (command === "tools") {
      value = await BrowserControl.execute({ method: "capabilities", params: {} });
    } else if (command === "help" || command === "h" || command === "skill") {
      return { exitCode: 0, stdout: "BashKitten native browser control\n\nSend one JSON command on stdin:\n  bashkitten --no-start --agent-json\n  {\"method\":\"tabs.list\",\"params\":{}}\n\nPage tools require an explicit page or tabId from tabs.list.\nUse capabilities for the available desktop tools. Agent and login views are protected.\n", stderr: "" };
    } else {
      throw new Error("Use bashkitten --no-start --agent-json with {method,params} on stdin");
    }
    if (args.length) throw new Error(`Unexpected argument: ${args[0]}`);
    return { exitCode: 0, stdout: `${JSON.stringify(value, null, json ? 0 : 2)}\n`, stderr: "" };
  } catch (error) {
    const message = error?.message ?? String(error);
    const json = request.argv?.includes("--agent-json") || request.argv?.includes("--json");
    return { exitCode: 1, stdout: json ? `${JSON.stringify({ error: { code: "browser_command_failed", message } })}\n` : "",
      stderr: json ? "" : `bashkitten: ${message}\n` };
  }
}
