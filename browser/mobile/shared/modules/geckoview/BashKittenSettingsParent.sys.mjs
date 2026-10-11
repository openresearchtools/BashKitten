// SPDX-License-Identifier: AGPL-3.0-only
import { GeckoViewActorParent } from "resource://gre/modules/GeckoViewActorParent.sys.mjs";
import { BashKittenSettings } from "resource://gre/modules/BashKittenSettings.sys.mjs";
export class BashKittenSettingsParent extends GeckoViewActorParent {
  async receiveMessage({ name, data }) {
    const global = this.manager;
    const view = BashKittenSettings.require(global);
    if (name === "Ready") return view.info;
    if (name !== "Call" || !BashKittenSettings.allows(view, data?.command) || typeof data.args !== "string") throw new Error("Unsupported settings action");
    const args = JSON.parse(data.args);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Settings arguments must be an object");
    const response = await this.eventDispatcher.sendRequestForResult("BashKitten:SettingsCall", { section: view.section, command: data.command, args: data.args });
    if (BashKittenSettings.require(global, view) !== view) throw new Error("Settings document changed");
    if (typeof response !== "string") throw new Error("Invalid settings response");
    const result = JSON.parse(response);
    if (result.error) throw new Error(String(result.error));
    return result.result;
  }
}
