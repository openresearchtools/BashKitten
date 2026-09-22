// SPDX-License-Identifier: GPL-3.0-only
import { GeckoViewActorParent } from "resource://gre/modules/GeckoViewActorParent.sys.mjs";
import { BashKittenHost } from "resource://gre/modules/BashKittenHost.sys.mjs";

const commands = new Set(["notification-settings", "notify-turn", "import-remote", "sign-in"]);

export class BashKittenHostParent extends GeckoViewActorParent {
  async receiveMessage({ name, data }) {
    const enrollment = BashKittenHost.require(this.manager);
    if (name === "Ready") return true;
    if (name === "DraftReady") return BashKittenHost.restoreDraft(this.browser);
    if (name !== "Call" || !commands.has(data?.command) ||
        typeof data.args !== "string" || data.args.length > 200000) {
      throw new Error("Unsupported Agent host request");
    }
    const args = JSON.parse(data.args);
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("Host arguments must be an object");
    }
    const reply = await this.eventDispatcher.sendRequestForResult("BashKitten:HostCall", {
      command: data.command, args: data.args,
    });
    if (BashKittenHost.require(this.manager) !== enrollment) {
      throw new Error("The selected Agent changed");
    }
    if (typeof reply !== "string" || reply.length > 200000) {
      throw new Error("Invalid Agent host response");
    }
    const value = JSON.parse(reply);
    if (value?.error) throw new Error(String(value.error).slice(0, 500));
    if (!value || !Object.hasOwn(value, "result")) throw new Error("Invalid Agent host response");
    return value.result;
  }
}
