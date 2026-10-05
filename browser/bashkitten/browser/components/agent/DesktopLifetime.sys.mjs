/* SPDX-License-Identifier: AGPL-3.0-only */
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";

const KEEP = "bashkitten.desktop.keepInTray";

export const DesktopLifetime = {
  autostart: false,
  quitting: false,
  attach(view, shutdown) {
    this.view = view;
    this.shutdown = shutdown;
    view.win.BashKittenLifetime = this;
    this.observer = { observe: (_subject, topic, action) => {
      if (topic === "bashkitten-tray") {
        if (action === "quit") view.win.goQuitApplication({});
        if (action === "changed") {
          Services.obs.notifyObservers(null, "bashkitten-tray-changed");
        }
      } else this.updateStatus();
    } };
    try {
      this.tray = Cc["@bashkitten.org/native-tray;1"].createInstance(Ci.nsIBashKittenTray);
      this.tray.init(view.win, this.observer);
    } catch (error) { this.tray?.close(); this.tray = null; console.error("BashKitten tray unavailable", error); }
    this.changes = new view.win.MutationObserver(() => this.updateStatus());
    for (const node of [view.power, view.choice, view.state]) this.changes.observe(node, { subtree: true, childList: true, characterData: true, attributes: true });
    Services.obs.addObserver(this.observer, "bashkitten-agent-remote-changed");
    view.win.addEventListener("unload", () => {
      this.changes.disconnect();
      Services.obs.removeObserver(this.observer, "bashkitten-agent-remote-changed");
      this.tray?.close(); this.tray = null; this.view = null;
    }, { once: true });
    this.updateStatus();
  },
  async updateStatus() {
    const view = this.view;
    if (!view || !this.tray) return;
    const sequence = this.statusSequence = (this.statusSequence || 0) + 1;
    const selected = view.remote?.name || "Local";
    const state = this.quitting ? "Stopping safely…" : view.power.textContent === "Turn off" ? "On" : view.power.textContent === "Turn on" ? "Off" : view.power.textContent;
    const remotes = await AgentRemotes.list().catch(() => null);
    if (sequence !== this.statusSequence || !this.tray) return;
    const connected = remotes?.filter(remote => remote.state === "ready").length;
    this.tray.setStatus(`${selected}: ${state}${remotes === null ? " · Remote status unavailable" : connected ? ` · ${connected} remote${connected === 1 ? "" : "s"} connected` : ""}`);
  },
  started() {
    if (this.autostart && !this.view?.off) this.hide();
    this.autostart = false;
  },
  hide() {
    if (this.quitting || !Services.prefs.getBoolPref(KEEP, true)) return false;
    return this.tray?.hide() || false;
  },
  reveal() {
    this.autostart = false;
    this.tray?.reveal();
    this.view?.win.focus();
  },
  quit() {
    if (this.quitting) return;
    this.quitting = true;
    this.reveal();
    const view = this.view;
    view.off = true;
    view.power.disabled = view.choice.disabled = true;
    view.show();
    view.message("Quitting BashKitten", "Stopping owned services safely. Any active package transaction must finish first.");
    this.updateStatus();
    this.shutdown().then(() => {
      // A tab's beforeunload handler can still cancel Gecko's final quit.
      if (!Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit)) {
        this.quitting = false;
        view.power.disabled = view.choice.disabled = false;
        delete view.win.skipNextCanClose;
        view.stopped();
      }
    }).catch(error => {
      this.quitting = false;
      view.message("Quit has not completed", `${error.message || error} Choose Quit to retry.`);
      const retry = view.doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      retry.textContent = "Retry Quit";
      retry.addEventListener("click", () => this.quit());
      view.state.append(retry);
      this.updateStatus();
    });
  },
  shutdownStatus(status) {
    const job = status.packages?.job, view = this.view;
    if (!this.quitting || !view || !job) return;
    view.state.querySelector("p").textContent = job.progress?.message || job.phase || "Stopping owned services safely…";
    if (!job.log) return;
    let output = view.state.querySelector("pre");
    if (!output) {
      const details = view.doc.createElementNS("http://www.w3.org/1999/xhtml", "details");
      const label = view.doc.createElementNS("http://www.w3.org/1999/xhtml", "summary");
      label.textContent = "Package output";
      output = view.doc.createElementNS("http://www.w3.org/1999/xhtml", "pre");
      output.style.cssText = "max-height:16em;overflow:auto;white-space:pre-wrap";
      details.append(label, output); view.state.append(details);
    }
    output.textContent = job.log;
  },
};
