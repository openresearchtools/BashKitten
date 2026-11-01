/* SPDX-License-Identifier: AGPL-3.0-only */

import { BrowserControl } from "chrome://remote/content/bashkitten/BrowserControl.sys.mjs";
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
});

/** An authenticated outbound channel. It never opens a browser-control listener. */
export const BrowserControlChannel = {
  current: null,
  declined: new Set(),
  pending: null,
  epoch: 0,

  // This requests a role, not a grant. The private controller validates the
  // namespace, installed executable, parent PID and registered profile before
  // returning any commands. No page or profile file can authorize this path.
  get guestRequested() {
    return Services.appinfo.OS === "Linux" &&
      Services.env.get("BASHKITTEN_GUEST_BROWSER") === "1" &&
      Services.env.get("BASHKITTEN_EXECUTION_ROLE") === "container" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(Services.env.get("BASHKITTEN_MACHINE_ID"));
  },

  startGuest() {
    if (!this.guestRequested) return Promise.reject(new Error("Not a managed guest browser"));
    if (this.guestQuitting) return Promise.reject(new Error("Guest browser is quitting"));
    if (this.guestStartup) return this.guestStartup;
    if (!this.guestLifetime) {
      this.guestLifetime = true;
      Services.startup.enterLastWindowClosingSurvivalArea();
      Services.obs.addObserver(this, "quit-application-granted");
      lazy.AsyncShutdown.profileBeforeChange.addBlocker("Guest browser control", () => this.closeGuest());
    }
    this.guestStartup = this.openGuest().catch(() => {
      Services.obs.notifyObservers(null, "bashkitten-browser-control-disconnected", "container");
    }).finally(() => { this.guestStartup = null; });
    return this.guestStartup;
  },

  async openGuest() {
    const state = { controller: new AbortController(), results: new Map(), references: new Map(), resolvers: new Map(), write: Promise.resolve(), connected: false, generation: 0 };
    this.guest = state;
    state.process = await lazy.Subprocess.call({
      command: "/usr/lib/bashkitten/node/bin/node",
      arguments: ["/usr/lib/bashkitten/src/server/access/guest-browser-relay.mjs"],
      stderr: "pipe",
    });
    // Do not expose command content, credentials or runtime output in logs.
    const stderr = (async () => { while (await state.process.stderr.readString()) {} })().catch(() => {});
    const send = (value, current = () => true) => {
      state.write = state.write.then(() => current() ? state.process.stdin.write(JSON.stringify(value) + "\n") : undefined);
      return state.write;
    };
    state.send = send;
    try {
      if (state.controller.signal.aborted) throw new Error("Guest browser is stopping");
      const capabilities = await BrowserControl.execute({ method: "capabilities" });
      await send({ version: 1, browserPid: Services.appinfo.processID,
        profile: PathUtils.profileDir, clientId: crypto.randomUUID(), capabilities });
      let buffered = "";
      for (let chunk; (chunk = await state.process.stdout.readString());) {
        buffered += chunk;
        let newline;
        while ((newline = buffered.indexOf("\n")) !== -1) {
          const command = JSON.parse(buffered.slice(0, newline));
          buffered = buffered.slice(newline + 1);
          if (command.ready === true) {
            if (!/^[a-f0-9-]{36}$/.test(command.backendId || "") || !/^[a-f0-9-]{36}$/.test(command.channelId || "")) throw new Error("Invalid guest backend identity");
            state.controller.abort();
            state.backendId = command.backendId; state.channelId = command.channelId;
            state.controller = new AbortController(); state.generation++; state.connected = true; continue;
          }
          if (command.disconnected) {
            state.connected = false; state.generation++; state.controller.abort(); state.results.clear();
            Services.obs.notifyObservers(null, "bashkitten-browser-control-disconnected", "container");
            continue;
          }
          if (command.closed) throw new Error("Guest browser control disconnected");
          if (command.references) {
            const reply = command.references, pending = state.references.get(reply.id);
            if (pending && reply.channelId === state.channelId) pending.finish(reply.error ? new Error(reply.error) : null, reply.result);
            continue;
          }
          if (!state.connected || typeof command.id !== "string" || typeof command.method !== "string" ||
              !command.params || typeof command.params !== "object" || Array.isArray(command.params)) {
            throw new Error("Invalid guest browser command");
          }
          let entry = state.results.get(command.id);
          if (!entry) {
            entry = { complete: false };
            entry.promise = this.executeGuest(state, command).then(result => ({ result }),
              error => ({ error: { code: "browser_command_failed", message: error.message } }));
            state.results.set(command.id, entry);
          }
          // Keep reading while commands run; the normal dispatcher owns its
          // operation lifetime. Closing the helper cancels outstanding work.
          const generation = state.generation;
          void entry.promise.then(result => {
            entry.complete = true;
            for (const [id, cached] of state.results) {
              if (state.results.size <= 256) break;
              if (cached.complete) state.results.delete(id);
            }
            if (generation === state.generation && !state.controller.signal.aborted) return send({ id: command.id, ...result });
          }).catch(() => state.process.kill());
        }
      }
      throw new Error("Guest browser control closed");
    } finally {
      state.connected = false;
      state.controller.abort();
      state.process.kill();
      await state.process.wait().catch(() => {});
      await stderr;
    }
  },

  async executeGuest(state, command) {
    const { signal } = state.controller;
    if (command.method === "references.resolve") return this.resolveGuestReference(state, command.params, signal);
    if (!lazy.BrowserWindowTracker.getTopWindow() &&
        (["tabs.create", "tabs.open"].includes(command.method) ||
         (command.method === "tabs" && ["new", "open", "create"].includes(command.params.action)))) {
      // Last-window close keeps the ordinary browser runtime alive. An explicit
      // new-tab command may reveal a new ordinary window, never an Agent view.
      state.openingWindow ||= (async () => {
        const win = lazy.BrowserWindowTracker.openWindow();
        await win.delayedStartupPromise;
      })().finally(() => { state.openingWindow = null; });
      await state.openingWindow;
    }
    return BrowserControl.execute({ method: command.method, params: command.params }, { signal });
  },

  async guestReferencesRequest(envelope) {
    const state = this.guest;
    const generation = state?.generation, signal = state?.controller.signal, channelId = state?.channelId;
    const current = () => this.guestRequested && this.guest === state && state?.connected &&
      state.generation === generation && state.channelId === channelId && !signal.aborted && !this.guestQuitting;
    if (!current()) throw new Error("The container browser is not connected to its backend.");
    if (envelope?.apiVersion !== 1) throw new Error("Unsupported References host API.");
    if (envelope.operation !== "context" && (envelope.backendId !== state.backendId ||
        !((envelope.operation === "open" && envelope.projectId == null) || /^[a-f0-9-]{36}$/.test(envelope.projectId || "")))) {
      throw new Error("Select the capture's owning backend and project.");
    }
    if (envelope.operation === "resolver-result") {
      const pending = state.resolvers.get(envelope.requestId);
      if (!pending || !pending.current() || envelope.projectId !== pending.projectId || JSON.stringify(envelope).length > 8192) {
        throw new Error("Resolver request is no longer active.");
      }
      pending.finish(envelope.error ? new Error(String(envelope.error).slice(0, 500)) : null, envelope.result);
      return { apiVersion: 1, body: { ok: true } };
    }
    if (!["context", "request", "open"].includes(envelope.operation)) throw new Error("Unsupported References operation.");
    const response = await this.guestReferenceCall(state, envelope);
    if (!current()) throw new Error("The container backend changed.");
    if (response?.apiVersion !== 1) throw new Error("Incompatible References backend host.");
    if (envelope.operation === "context" && response.body?.backendId !== state.backendId) throw new Error("The References backend changed.");
    if (envelope.operation !== "open") return response;
    const launch = response.launch, url = new URL(launch?.url);
    if (launch.component !== "references" || launch.serviceId !== "files" || launch.identity?.instanceId !== state.backendId ||
        url.protocol !== "https:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.hash ||
        !/^\/apps\/references\/[a-f0-9-]{36}\//.test(url.pathname) || url.pathname + url.search !== launch.openPath) {
      throw new Error("References did not return a valid local launch address.");
    }
    const win = lazy.BrowserWindowTracker.getTopWindow();
    if (!win?.gBrowser || win.closed) throw new Error("No browser window is ready.");
    const userContextId = AgentRemotes.applicationContext("guest:" + state.backendId, Number(url.port) || 443, launch.identity);
    win.gBrowser.selectedTab = win.gBrowser.addTrustedTab(url.href, { userContextId });
    return { apiVersion: 1, body: { ok: true } };
  },

  guestReferenceCall(state, envelope) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID(), { signal } = state.controller, generation = state.generation, channelId = state.channelId;
      let timer;
      const abort = () => pending.finish(new Error("The container backend changed."));
      const pending = { finish: (error, result) => {
        if (state.references.get(id) !== pending) return;
        state.references.delete(id); clearTimeout(timer); signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(result);
      } };
      state.references.set(id, pending);
      timer = setTimeout(() => pending.finish(new Error("References request timed out.")), 120000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      void state.send({ references: { id, channelId, envelope } }, () => this.guest === state && state.connected &&
        state.generation === generation && state.channelId === channelId && !signal.aborted && !this.guestQuitting).catch(error => pending.finish(error));
    });
  },

  resolveGuestReference(state, value, signal) {
    const current = () => this.guest === state && state.connected && !this.guestQuitting && !signal.aborted;
    if (!current() || (value.backendId && value.backendId !== state.backendId) ||
        !/^[a-f0-9-]{36}$/.test(value.projectId || "") || !/^[a-f0-9-]{36}$/.test(value.requestId || "")) {
      throw new Error("Select the resolver job's owning backend and project.");
    }
    if (state.resolvers.has(value.requestId) || state.resolvers.size >= 32) throw new Error("A resolver request is already pending.");
    if (!Services.obs.enumerateObservers("bashkitten-references-resolve").hasMoreElements()) throw new Error("References capture is not ready.");
    return new Promise((resolve, reject) => {
      let timer;
      const abort = () => pending.finish(new Error("Resolver request cancelled."));
      const pending = { projectId: value.projectId, current, finish: (error, result) => {
        if (state.resolvers.get(value.requestId) !== pending) return;
        state.resolvers.delete(value.requestId); clearTimeout(timer); signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(result);
      } };
      state.resolvers.set(value.requestId, pending);
      timer = setTimeout(() => pending.finish(new Error("Resolver browser response timed out; check the job status.")), 600000);
      signal.addEventListener("abort", abort, { once: true });
      Services.obs.notifyObservers(null, "bashkitten-references-resolve", JSON.stringify({ backendId: state.backendId, projectId: value.projectId, requestId: value.requestId }));
    });
  },

  async closeGuest() {
    const state = this.guest;
    if (!state) return;
    state.controller.abort();
    state.process?.kill();
    await state.process?.wait().catch(() => {});
  },

  observe(_subject, topic, connectionId) {
    if (topic === "quit-application-granted" && this.guestLifetime) {
      // Preserve ordinary last-window Close, but let Gecko finish an explicit
      // Quit after asynchronous window destruction. Release only our own hold,
      // after quit cancellation checks, and never reacquire it during shutdown.
      this.guestQuitting = true;
      this.guestLifetime = false;
      Services.obs.removeObserver(this, "quit-application-granted");
      Services.startup.exitLastWindowClosingSurvivalArea();
      return;
    }
    if (topic === "bashkitten-agent-control-revoke" &&
        (this.current?.connection.id === connectionId || this.pending?.id === connectionId)) {
      void this.close("authentication or selection changed");
    }
  },

  get status() {
    if (this.guestRequested) return { connected: this.guest?.connected === true, connectionId: "container" };
    return this.current ? { connected: true, connectionId: this.current.connection.id } : { connected: false };
  },

  start(connection, options = {}) {
    if (this.guestRequested) return Promise.reject(new Error("Managed guests use their own browser controller"));
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
      await Promise.all(commands.map(command => {
        if (!command || typeof command.id !== "string") throw new Error("Invalid browser command identity");
        let entry = state.results.get(command.id);
        if (!entry) {
          entry = { complete: false };
          entry.promise = BrowserControl.execute({ method: command.method, params: command.params }, {
            signal: state.controller.signal,
          }).then(result => ({ result }), error => ({ error: { code: "browser_command_failed", message: error.message } }));
          state.results.set(command.id, entry);
        }
        entry.receipt ||= entry.promise.then(async result => {
          entry.complete = true;
          for (const [id, cached] of state.results) {
            if (state.results.size <= 256) break;
            if (cached.complete) state.results.delete(id);
          }
          if (state.controller.signal.aborted) return;
          await this.post(state, "result", { channelId: state.channelId, id: command.id, ...result });
        });
        if (command.method === "references.resolve") {
          // A visible human challenge must not hold the existing command poll.
          // Keep the one receipt tied to this channel's authority and lifetime.
          void entry.receipt.catch(() => {
            if (this.current === state) void this.close("Resolver browser response could not be delivered");
          });
          return;
        }
        return entry.receipt;
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
