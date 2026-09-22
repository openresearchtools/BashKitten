/* SPDX-License-Identifier: GPL-3.0-only */

import { BrowserControl } from "chrome://remote/content/bashkitten/BrowserControl.sys.mjs";
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

/** An authenticated outbound channel. It never opens a browser-control listener. */
export const BrowserControlChannel = {
  current: null,
  declined: new Set(),
  pending: null,
  epoch: 0,

  observe(_subject, topic, connectionId) {
    if (topic === "bashkitten-agent-control-revoke" &&
        (this.current?.connection.id === connectionId || this.pending?.id === connectionId)) {
      void this.close("authentication or selection changed");
    }
  },

  get status() {
    return this.current ? { connected: true, connectionId: this.current.connection.id } : { connected: false };
  },

  start(connection, options = {}) {
    const key = `${connection.id}\0${connection.url}`;
    if (this.pending?.key === key) return this.pending.task;
    const pending = { key, id: connection.id };
    pending.task = this.startConnection(connection, options).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending.task;
  },

  async startConnection(connection, { local = false, window = null } = {}) {
    if (this.current?.connection.id === connection.id &&
        this.current.connection.url === connection.url) return this.status;
    const closing = this.close("connection changed");
    const epoch = this.epoch;
    await closing;
    if (this.declined.has(connection.id)) return this.status;
    // Check the protected cookie context before prompting; a login page isn't a grant.
    const bootstrap = await AgentRemotes.request(connection, "/api/bootstrap");
    if (epoch !== this.epoch) return this.status;
    if (bootstrap.status !== 200 || !bootstrap.data?.authenticated || !bootstrap.data.csrf) return this.status;
    if (!local) {
      const allowed = Services.prompt.confirmEx(window, "Allow browser control?",
        `Allow the selected Agent server “${connection.name || connection.id}” to control ordinary tabs in this browser? Agent, login and connection settings stay protected.`,
        Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0 |
        Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1 |
        Services.prompt.BUTTON_POS_1_DEFAULT,
        "Allow", null, null, null, {});
      if (allowed !== 0) {
        this.declined.add(connection.id);
        return this.status;
      }
    }
    if (epoch !== this.epoch) return this.status;
    let clientId = Services.prefs.getStringPref("bashkitten.agent.browserClientId", "");
    if (!clientId) {
      clientId = crypto.randomUUID();
      Services.prefs.setStringPref("bashkitten.agent.browserClientId", clientId);
    }
    const controller = new AbortController();
    const state = { connection, controller, csrf: bootstrap.data.csrf, channelId: null, results: new Map() };
    const capabilities = await BrowserControl.execute({ method: "capabilities" });
    const opened = await this.post(state, "open", { clientId, name: "BashKitten desktop", platform: "linux", capabilities });
    if (!opened.channelId) throw new Error("Agent server did not create a browser channel");
    state.channelId = opened.channelId;
    if (epoch !== this.epoch) {
      await this.post(state, "close", { channelId: state.channelId }).catch(() => {});
      controller.abort();
      return this.status;
    }
    this.current = state;
    state.task = this.poll(state).catch(() => {
      // No reconnect or command replay without a fresh native grant.
      if (this.current === state) {
        this.current = null;
        controller.abort();
        Services.obs.notifyObservers(null, "bashkitten-browser-control-disconnected", connection.id);
      }
    });
    return this.status;
  },

  async post(state, operation, body) {
    const response = await AgentRemotes.request(state.connection, `/api/browser-channel/${operation}`, {
      method: "POST", body, signal: state.controller.signal, csrf: state.csrf,
    });
    if (response.status !== 200) {
      const error = new Error(response.status === 401 || response.status === 403 ?
        "Browser control needs a current Agent login" : "Browser control connection ended");
      error.status = response.status;
      throw error;
    }
    return response.data;
  },

  async poll(state) {
    while (this.current === state && !state.controller.signal.aborted) {
      const started = Date.now();
      const response = await this.post(state, "poll", { channelId: state.channelId });
      const commands = response.commands ?? [];
      if (!Array.isArray(commands) || commands.length > 64) throw new Error("Invalid browser command batch");
      await Promise.all(commands.map(async command => {
        if (!command || typeof command.id !== "string") throw new Error("Invalid browser command identity");
        let completed = state.results.get(command.id);
        if (!completed) {
          completed = BrowserControl.execute({ method: command.method, params: command.params }, {
            signal: state.controller.signal,
          }).then(result => ({ result }), error => ({ error: { code: "browser_command_failed", message: error.message } }));
          state.results.set(command.id, completed);
          while (state.results.size > 256) state.results.delete(state.results.keys().next().value);
        }
        const result = await completed;
        if (state.controller.signal.aborted) return;
        await this.post(state, "result", { channelId: state.channelId, id: command.id, ...result });
      }));
      if (Date.now() - started < 1000) {
        await new Promise(resolve => {
          const id = setTimeout(done, 1000);
          function done() { clearTimeout(id); state.controller.signal.removeEventListener("abort", done); resolve(); }
          state.controller.signal.addEventListener("abort", done, { once: true });
        });
      }
    }
  },

  async close(reason = "closed") {
    this.epoch++;
    this.pending = null;
    const state = this.current;
    this.current = null;
    if (!state) return;
    state.controller.abort(reason);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      await AgentRemotes.request(state.connection, "/api/browser-channel/close", {
        method: "POST", body: { channelId: state.channelId }, csrf: state.csrf, signal: controller.signal,
      });
    } catch {} finally { clearTimeout(timeout); }
  },

  async revoke(connectionId) {
    this.declined.add(connectionId);
    if (this.current?.connection.id === connectionId) await this.close("revoked");
  },

  allowAgain(connectionId) {
    this.declined.delete(connectionId);
  },
};

Services.obs.addObserver(BrowserControlChannel, "bashkitten-agent-control-revoke");
