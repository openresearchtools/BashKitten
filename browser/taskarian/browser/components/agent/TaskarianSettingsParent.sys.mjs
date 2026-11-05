/* SPDX-License-Identifier: AGPL-3.0-only */
import { TaskarianSettings } from "resource:///modules/TaskarianSettings.sys.mjs";
export class TaskarianSettingsParent extends JSWindowActorParent {
  receiveMessage({ name, data }) { return TaskarianSettings.receive(this, name, data); }
  didDestroy() { TaskarianSettings.actorDestroyed(this); }
}
