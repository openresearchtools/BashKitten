/* SPDX-License-Identifier: GPL-3.0-only */

import { protectedAgentView } from "resource:///modules/BashKittenAgent.sys.mjs";
import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";

async function openPath(path) {
  const process = await Subprocess.call({ command: "/usr/bin/xdg-open", arguments: [path] });
  const result = await process.wait();
  if (result.exitCode) throw new Error("The system could not open this file.");
  return { ok: true };
}

export class BashKittenAgentParent extends JSWindowActorParent {
  async receiveMessage({ name, data }) {
    const entry = protectedAgentView(this);
    if (!entry) throw new Error("This document is not an active Agent view.");
    if (name === "Ready" || name === "DraftReady") { await entry.host.contentReady(entry, this, name === "DraftReady"); return; }
    if (name === "SignIn") { await entry.host.signIn(); return { ok: true }; }
    if (name === "ImportRemote") { await entry.host.remotes(); return { ok: true }; }
    if (name === "OpenHosted") { await entry.host.openHosted(this.browsingContext.embedderElement, data.url); return { ok: true }; }
    if (!entry.local) throw new Error("This action is available only in the local Agent view.");
    if (name === "OpenFolder") {
      if (typeof data.path !== "string" || !PathUtils.isAbsolute(data.path) || data.path.includes("\0")) throw new Error("Invalid folder path.");
      const info = await IOUtils.stat(data.path);
      if (info.type !== "directory") throw new Error("This folder no longer exists.");
      return openPath(data.path);
    }
    if (name !== "OpenFile" || !(data.bytes instanceof Uint8Array) || data.bytes.byteLength > 100 * 1024 * 1024) throw new Error("Invalid file request.");
    const root = PathUtils.join(PathUtils.profileDir, "agent-open-files");
    await IOUtils.makeDirectory(root, { permissions: 0o700, ignoreExisting: true });
    const safeName = String(data.name || "file").replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(-180);
    const path = PathUtils.join(root, `${Services.uuid.generateUUID().toString().slice(1, -1)}-${safeName}`);
    await IOUtils.write(path, data.bytes, { mode: "create" });
    await IOUtils.setPermissions(path, 0o600);
    return openPath(path);
  }
}
