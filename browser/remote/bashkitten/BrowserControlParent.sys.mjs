/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  event: "chrome://remote/content/shared/webdriver/Event.sys.mjs",
});

/** Parent endpoint for visible-tab browser-control queries. */
export class BashKittenBrowserControlParent extends JSWindowActorParent {
  #inputQueries = 0;

  async sendQuery(name, data) {
    if (name !== "act") return super.sendQuery(name, data);
    this.#inputQueries++;
    try {
      return await super.sendQuery(name, data);
    } finally {
      this.#inputQueries--;
    }
  }

  async receiveMessage({ name, data }) {
    if (name !== "BashKitten:NativePointer" || !this.#inputQueries) {
      throw new Error("Native pointer dispatch requires an authorized input query");
    }
    const context = this.browsingContext;
    if (context.currentWindowGlobal !== this.manager) {
      throw new Error("The target document changed; take another snapshot");
    }
    const browser = context.top.embedderElement;
    const win = browser?.documentGlobal;
    const { x, y, events, nativeClick } = data;
    if (!win || !browser.isConnected || !Number.isFinite(x) || !Number.isFinite(y) ||
        !Array.isArray(events) || !events.length || events.some(event =>
          !["mousemove", "mousedown", "contextmenu", "mouseup"].includes(event.type))) {
      throw new Error("Invalid ordinary-tab pointer event");
    }
    const point = { x: x / win.devicePixelRatio, y: y / win.devicePixelRatio };
    const rect = browser.getBoundingClientRect();
    const hit = win.document.elementFromPoint(point.x, point.y);
    if (point.x < rect.left || point.x >= rect.right || point.y < rect.top ||
        point.y >= rect.bottom || (hit !== browser && !browser.contains(hit))) {
      throw new Error("The pointer target is outside or covers the ordinary tab");
    }
    for (let child = context; child.parent; child = child.parent) {
      await child.parent.currentWindowGlobal.getActor("BashKittenBrowserControl")
        .sendQuery("pointerFrame", { childBrowsingContextId: child.id, x, y });
    }
    if (context.currentWindowGlobal !== this.manager) {
      throw new Error("The target document changed; take another snapshot");
    }
    // Only an in-flight act from the existing authorized coordinator can reach
    // this path. Coordinates stay inside that same browser's content rectangle;
    // browser chrome and extension-principal admission remain with their owners.
    const handling = win.windowUtils.setHandlingUserInput(true);
    let pressed = null;
    try {
      for (const event of events) {
        if (nativeClick && event.type === "mousedown" && win.windowUtils.dragSession) {
          continue;
        }
        if (event.type === "mousedown") pressed = event;
        await lazy.event.synthesizeMouseAtPoint(point.x, point.y, {
          allowToHandleDragDrop: true, ...event, asyncEnabled: true,
        }, win);
        if (event.type === "mouseup") pressed = null;
      }
    } finally {
      if (pressed) {
        try {
          await lazy.event.synthesizeMouseAtPoint(point.x, point.y, {
            ...pressed, type: "mouseup", allowToHandleDragDrop: true, asyncEnabled: true,
          }, win);
        } catch {}
      }
      handling.destruct();
    }
    return { dispatched: true };
  }
}
