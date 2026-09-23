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
    if (name === "ChooseFolder") return entry.host.chooseFolder(this.browsingContext.embedderElement, data);
    if (name === "OpenFolder") {
      if (typeof data.path !== "string" || !PathUtils.isAbsolute(data.path) || data.path.includes("\0")) throw new Error("Invalid folder path.");
      const info = await IOUtils.stat(data.path);
      if (info.type !== "directory") throw new Error("This folder no longer exists.");
      return openPath(data.path);
    }
    if (name !== "OpenFile" || typeof data.url !== "string") throw new Error("Invalid file request.");
    const file = await entry.host.resolveLocalFile(this.browsingContext.embedderElement, data.url);
    if (typeof file.path !== "string" || !PathUtils.isAbsolute(file.path) || file.path.includes("\0")) throw new Error("Invalid local file path.");
    if ((await IOUtils.stat(file.path)).type !== "regular") throw new Error("This file no longer exists.");
    const current = protectedAgentView(this);
    if (!current?.local || current.authFor || current.connection !== entry.connection) throw new Error("The selected Agent changed.");
    return openPath(file.path);
  }
}
