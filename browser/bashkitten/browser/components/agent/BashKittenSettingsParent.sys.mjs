/* SPDX-License-Identifier: AGPL-3.0-only */
import { BashKittenSettings } from "resource:///modules/BashKittenSettings.sys.mjs";
export class BashKittenSettingsParent extends JSWindowActorParent {
  receiveMessage({ name, data }) { return BashKittenSettings.receive(this, name, data); }
  didDestroy() { BashKittenSettings.actorDestroyed(this); }
}
