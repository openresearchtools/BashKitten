/* SPDX-License-Identifier: AGPL-3.0-only */
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
const NS = "http://www.w3.org/1999/xhtml";

/** Native hierarchy. The protected chat supplies only its own session catalogue. */
export class NativeSidecar {
  constructor(host, control) {
    this.host = host; this.control = control; this.doc = host.doc;
    this.cache = new Map(); this.rows = new Map(); this.expanded = new Map(); this.renderEpoch = 0;
    host.win.addEventListener("unload", () => { this.closed = true; this.renderEpoch++; clearTimeout(this.catalogueTimer); }, { once: true });
    this.root = this.node("aside", { id: "bashkitten-native-sidecar", "aria-label": "Environments, projects and chats" });
    this.notice = this.node("p", { role: "status" }); this.root.append(this.notice);
  }
  node(tag, attrs = {}, text) { const node = this.doc.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); if (text !== undefined) node.textContent = text; return node; }
  button(text, label, action) {
    const button = this.node("button", { type: "button", title: label, "aria-label": label }, text);
    button.addEventListener("click", async () => { button.disabled = true; try { this.notice.textContent = ""; await action(); } catch (error) { this.notice.textContent = error.message; } finally { button.disabled = false; } }); return button;
  }
  async navigation(action, value = {}) {
    const browser = this.host.activeBrowser, global = browser?.browsingContext.currentWindowGlobal;
    if (this.host.off || !global) throw new Error("Connect to this backend first.");
    const result = await global.getActor("BashKittenAgent").sendQuery("Navigation", { action, value });
    if (browser !== this.host.activeBrowser || global !== browser.browsingContext.currentWindowGlobal) throw new Error("The selected backend changed.");
    return result;
  }
  selected() { return this.host.selection || "local"; }
  displayCapabilities() {
    const { BashKittenDisplay } = ChromeUtils.importESModule("resource:///modules/BashKittenDisplay.sys.mjs");
    return BashKittenDisplay.capabilities();
  }
  async select(id) {
    const epoch = this.selectionEpoch = (this.selectionEpoch || 0) + 1;
    if (id !== this.selected() || this.host.off || !this.host.activeBrowser) await this.host.choose(id === "local" ? "" : id);
    const browser = this.host.activeBrowser;
    if (!browser) throw new Error("The backend did not open a protected chat.");
    const current = () => !this.closed && epoch === this.selectionEpoch && id === this.selected() && browser === this.host.activeBrowser && !this.host.off;
    let lastError = new Error("The chat is still connecting.");
    // Loading the protected document and authenticating its API are separate
    // from starting its backend. Never replay a mutation while waiting for it.
    for (const until = Date.now() + 30000; Date.now() < until;) {
      if (!current()) throw new Error("The selected backend changed.");
      if (!browser.webProgress?.isLoadingDocument) {
        try {
          const snapshot = await this.navigation("snapshot");
          if (!current()) throw new Error("The selected backend changed.");
          this.cache.set(id, snapshot); return;
        } catch (error) { lastError = error; }
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw lastError;
  }
  refresh() {
    if (this.closed) return Promise.resolve();
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = (async () => {
      clearTimeout(this.catalogueTimer);
      const previous = this.backends || [];
      const [remotes, machines] = await Promise.allSettled([AgentRemotes.list(), this.control("machines.list")]);
      if (this.closed) return;
      this.backends = [{ id: "local", name: "Local", kind: "local" },
        ...(machines.status === "fulfilled" ? (machines.value.machines || machines.value || []).map(machine => ({ ...machine, kind: "machine" })) : previous.filter(backend => backend.kind === "machine")),
        ...(remotes.status === "fulfilled" ? remotes.value.map(remote => ({ ...remote, kind: "remote" })) : previous.filter(backend => backend.kind === "remote"))];
      for (const result of [machines, remotes]) if (result.status === "rejected") this.notice.textContent = result.reason.message;
      await this.render(); await this.refreshChats();
    })().finally(() => {
      this.refreshTask = null;
      if (!this.closed && this.backends?.some(backend => backend.kind === "machine")) {
        const pending = this.backends.some(backend => ["preparing", "starting", "stopping", "deleting"].includes(backend.state));
        this.catalogueTimer = setTimeout(() => this.refresh().catch(error => { this.notice.textContent = error.message; }), pending ? 1000 : 5000);
      }
    });
    return this.refreshTask;
  }
  async refreshChats() {
    if (this.refreshing) { this.refreshAgain = true; return; }
    const id = this.selected(); this.refreshing = true;
    try { this.cache.set(id, await this.navigation("snapshot")); this.render(); }
    catch { /* Keep the named disconnected backend and its last known catalogue. */ }
    finally { this.refreshing = false; if (this.refreshAgain) { this.refreshAgain = false; void this.refreshChats(); } }
  }
  async render() {
    const epoch = ++this.renderEpoch, scroll = this.root.scrollTop; let count = 0;
    for (const backend of this.backends || []) {
      if (count++ && count % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      if (this.closed || epoch !== this.renderEpoch) return;
      let section = this.rows.get(backend.id);
      if (!section) { section = this.node("section", { class: "native-backend" }); this.rows.set(backend.id, section); this.root.append(section); }
      section.replaceChildren();
      const heading = this.node("div", { class: "native-backend-heading" });
      const open = this.button(backend.name, backend.name, async () => { await this.select(backend.id); await this.refreshChats(); }); open.className = "native-title";
      heading.append(open);
      const on = backend.kind === "remote" ? backend.state === "ready" : backend.kind === "machine" ? ["running", "preparing", "starting", "stopping", "deleting"].includes(backend.state) : this.host.localOn;
      const power = this.button(on ? "●" : "○", `${backend.name}: ${on ? "Turn off" : "Turn on"}`, async () => {
        if (backend.kind === "machine") {
          await this.control(on ? "machines.stop" : "machines.start", { id: backend.id, ...(!on ? { displayCapabilities: await this.displayCapabilities() } : {}) });
          if (on && backend.id === this.selected()) await this.host.disconnectSelected();
        }
        else if (backend.kind === "remote" && on) { await AgentRemotes.disconnect(backend.id); if (backend.id === this.selected()) await this.host.disconnectSelected(); }
        else if (backend.kind === "local" && on) await this.host.stopLocal();
        else await this.select(backend.id);
        await this.refresh();
      });
      power.disabled = ["preparing", "starting", "stopping", "deleting"].includes(backend.state);
      power.setAttribute("role", "switch"); power.setAttribute("aria-checked", String(Boolean(on))); heading.append(power);
      if (backend.kind !== "remote") heading.append(this.button("⚙", `${backend.name} settings`, () => backend.kind === "machine" ? this.machineSettings(backend.id) : this.localSettings()));
      if (backend.kind === "machine") heading.append(this.button("▣", `Open ${backend.name} Display`, () => this.host.openMachineDisplay(backend.id)));
      if (backend.kind === "remote") heading.append(this.button("⋯", `${backend.name} actions`, () => this.remoteActions(backend)));
      section.append(heading);
      if (backend.kind !== "local") section.append(this.node("small", { class: "native-backend-state", role: "status" }, backend.state || "Disconnected"));
      if (backend.error || backend.lastError) section.append(this.node("p", { class: "native-error" }, backend.error || backend.lastError));
      const snapshot = this.cache.get(backend.id), tools = this.node("div", { class: "native-chat-tools" });
      tools.append(this.button("+ Chat", "New standalone chat", async () => { await this.select(backend.id); await this.navigation("new"); await this.refreshChats(); }),
        this.button("+ Project", "Create project", async () => { await this.select(backend.id); await this.projectPicker(); })); section.append(tools);
      if (!snapshot) { section.append(this.node("small", {}, "Select to load chats")); continue; }
      const sessions = snapshot.sessions || [], known = new Set(sessions.map(session => session.id));
      const roots = sessions.filter(session => !known.has(session.subagentParent));
      const appendChat = (chat, target, depth = 0, visited = new Set()) => {
        if (visited.has(chat.id)) return; visited.add(chat.id);
        const row = this.node("div", { class: "native-chat", "data-selected": backend.id === this.selected() && chat.id === snapshot.selected });
        row.style.paddingInlineStart = `${depth * 12}px`;
        const children = sessions.filter(child => child.subagentParent === chat.id);
        if (children.length) row.append(this.button(this.expanded.get(backend.id + ":" + chat.id) === false ? "▸" : "▾", "Show subagent chats", () => { this.expanded.set(backend.id + ":" + chat.id, this.expanded.get(backend.id + ":" + chat.id) === false); this.render(); }));
        const link = this.button((chat.running ? "● " : "") + chat.title, chat.title, async () => { await this.select(backend.id); await this.navigation("open", { id: chat.id }); await this.refreshChats(); }); link.className = "native-title";
        row.append(link, this.button("⋯", "Chat actions", async () => { await this.select(backend.id); this.chatActions(chat, snapshot.projects || []); })); target.append(row);
        if (this.expanded.get(backend.id + ":" + chat.id) !== false) for (const child of children) appendChat(child, target, depth + 1, visited);
      };
      for (const chat of roots.filter(chat => !chat.projectId)) appendChat(chat, section);
      for (const project of snapshot.projects || []) {
        const group = this.node("details"); group.open = this.expanded.get(backend.id + ":" + project.id) !== false;
        group.addEventListener("toggle", () => this.expanded.set(backend.id + ":" + project.id, group.open));
        group.append(this.node("summary", {}, project.name));
        const actions = this.node("div", { class: "native-chat-tools" });
        actions.append(this.button("+ Chat", "New chat in " + project.name, async () => { await this.select(backend.id); await this.navigation("new", { projectId: project.id }); await this.refreshChats(); }),
          this.button("⋯", "Project actions", async () => { await this.select(backend.id); this.projectActions(project); })); group.append(actions);
        for (const chat of roots.filter(chat => chat.projectId === project.id)) appendChat(chat, group);
        section.append(group);
      }
      if (snapshot.nextOffset !== null) section.append(this.button("Load more", "Load more chats", async () => { await this.select(backend.id); await this.navigation("more"); await this.refreshChats(); }));
    }
    const ids = new Set((this.backends || []).map(backend => backend.id));
    for (const [id, row] of this.rows) if (!ids.has(id)) { row.remove(); this.rows.delete(id); this.cache.delete(id); }
    this.root.scrollTop = scroll;
  }
  textDialog(title, initial, save) {
    const { dialog, content } = this.host.dialog(title), input = this.node("input", { value: initial || "", "aria-label": title }), error = this.node("p", { role: "alert" });
    content.append(input, error, this.button("Save", "Save", async () => { try { await save(input.value); dialog.close(); await this.refreshChats(); } catch (e) { error.textContent = e.message; } })); input.focus();
  }
  chatActions(chat, projects) {
    const backend = this.selected(), request = (action, value) => { if (backend !== this.selected()) throw new Error("The selected backend changed."); return this.navigation(action, value); };
    const { dialog, content } = this.host.dialog(chat.title);
    content.append(this.button("Rename", "Rename chat", () => { dialog.close(); this.textDialog("Rename chat", chat.title, name => request("rename", { id: chat.id, name })); }));
    const select = this.node("select", { "aria-label": "Project" }); select.append(this.node("option", { value: "" }, "No project"));
    for (const project of projects) select.append(this.node("option", { value: project.id }, project.name)); select.value = chat.projectId || "";
    content.append(select, this.button("Move", "Move chat to project", async () => { await request("move", { id: chat.id, projectId: select.value }); dialog.close(); await this.refreshChats(); }),
      this.button("Remove chat", "Remove chat", async () => { if (!Services.prompt.confirm(this.host.win, "Remove chat?", "Stop this chat and remove it from the list? Native Pi history and working files are kept.")) return; await request("remove", { id: chat.id }); dialog.close(); await this.refreshChats(); }));
  }
  projectActions(project) {
    const backend = this.selected(), request = (action, value) => { if (backend !== this.selected()) throw new Error("The selected backend changed."); return this.navigation(action, value); };
    const { dialog, content } = this.host.dialog(project.name);
    content.append(this.node("p", {}, project.cwd), this.button("Rename", "Rename project", () => { dialog.close(); this.textDialog("Rename project", project.name, name => request("project-rename", { id: project.id, name })); }),
      this.button("Remove grouping", "Remove project; keep chats", async () => { if (!Services.prompt.confirm(this.host.win, "Remove project?", "Keep its chats directly under this backend?")) return; await request("project-remove", { id: project.id }); dialog.close(); await this.refreshChats(); }));
  }
  async projectPicker() {
    const backend = this.selected(), { dialog, content } = this.host.dialog("Create project"), name = this.node("input", { placeholder: "Project name", "aria-label": "Project name" }), location = this.node("p"), folders = this.node("div"), error = this.node("p", { role: "alert" });
    const requestId = Services.uuid.generateUUID().toString(), browser = this.host.activeBrowser, global = browser?.browsingContext.currentWindowGlobal;
    const current = () => dialog.open && backend === this.selected() && browser === this.host.activeBrowser && global === browser?.browsingContext.currentWindowGlobal;
    dialog.addEventListener("close", () => { global?.getActor("BashKittenAgent").sendQuery("Navigation", { action: "folders-cancel", value: { requestId } }).catch(() => {}); }, { once: true });
    let selected, generation = 0; content.append(name, location, folders, error);
    const load = async path => { if (!current()) throw new Error("The selected backend changed."); const epoch = ++generation; const result = await this.navigation("folders", { path, requestId }); if (!current() || epoch !== generation) return;
      selected = result.path; location.textContent = result.displayPath; folders.replaceChildren();
      if (result.parent) folders.append(this.button("↑ Parent", "Parent folder", () => load(result.parent)));
      for (const folder of result.folders) folders.append(this.button(folder.name, folder.name, () => load(folder.path)));
    };
    content.append(this.button("Create", "Create project in selected folder", async () => { try { if (!selected || !current()) throw new Error("Choose a folder on this backend."); await this.navigation("project-create", { name: name.value, cwd: selected }); dialog.close(); await this.refreshChats(); } catch (e) { error.textContent = e.message; } }));
    try { await load("~"); } catch (e) { error.textContent = e.message; }
  }
  localSettings() {
    const { dialog, content } = this.host.dialog("Local settings");
    content.append(this.button("Chat settings", "Chat settings", async () => { await this.select("local"); await this.navigation("settings"); dialog.close(); }),
      this.button("LocalAI", "LocalAI", async () => { await this.select("local"); dialog.close(); await this.host.localAI(); }),
      this.button("Share Local", "Share Local", () => { dialog.close(); return this.host.shareLocal(); }),
      this.button("Phone", "Phone registration for Local", () => { dialog.close(); return this.host.connectToPhone("local"); }));
  }
  remoteActions(remote) {
    const { dialog, content } = this.host.dialog(remote.name);
    content.append(this.button("Rename", "Rename remote", () => { dialog.close(); this.textDialog("Rename remote", remote.name, async name => { await AgentRemotes.rename(remote.id, name); await this.refresh(); }); }),
      this.button("Connect to phone", "Connect this backend to phone", () => this.host.connectToPhone(remote.id)),
      this.button("Delete remote", "Delete saved remote", async () => { if (!Services.prompt.confirm(this.host.win, "Delete remote?", `Forget “${remote.name}” and its login? Its machine and chats are kept.`)) return; await AgentRemotes.remove(remote.id); if (this.selected() === remote.id) await this.host.disconnectSelected(); dialog.close(); await this.refresh(); }));
  }
  add() {
    const { dialog, content } = this.host.dialog("Add backend");
    content.append(this.button("Connect to remote", "Connect to remote", () => { dialog.close(); return this.host.remotes(); }),
      this.button("Create container VM", "Create container VM", () => { dialog.close(); this.textDialog("Container name", "", async name => { const result = await this.control("machines.create", { name, displayCapabilities: await this.displayCapabilities() }); await this.refresh(); this.operation(result.machine?.id || result.id); }); }));
  }
  async machineSettings(id) {
    const state = await this.control("machines.get", { id }), { dialog, content } = this.host.dialog(state.machine.name + " settings");
    const name = this.node("input", { value: state.machine.name, "aria-label": "Container name" }), startup = this.node("input", { type: "checkbox" }); startup.checked = state.config.autostart;
    const label = this.node("label", {}, "Start at browser startup "); label.prepend(startup);
    const config = this.node("textarea", { rows: "14", "aria-label": "Podman launch configuration" }); config.value = JSON.stringify(state.config, null, 2);
    const helpers = this.machineHelpers(config, state.media || []);
    const containerfile = this.node("textarea", { rows: "12", "aria-label": "Containerfile" }); containerfile.value = state.containerfileText;
    content.append(name, label, helpers, this.node("p", {}, "Podman launch command, environment, ports, media and rendering settings"), config, this.node("p", {}, "Containerfile"), containerfile,
      this.button("Save", "Save container settings", async () => { const value = JSON.parse(config.value); value.name = name.value; value.autostart = startup.checked; await this.control("machines.save", { id, config: value, containerfileText: containerfile.value }); dialog.close(); await this.refresh(); }),
      this.button("Installation output", "Installation output", () => { dialog.close(); this.operation(id); }),
      this.button("Restart", "Restart container", async () => { await this.control("machines.restart", { id, displayCapabilities: await this.displayCapabilities() }); dialog.close(); this.operation(id); }),
      ...(["failed", "error"].includes(state.machine.state) ? [this.button("Retry creation", "Retry failed container creation", async () => { await this.control("machines.retry", { id, displayCapabilities: await this.displayCapabilities() }); dialog.close(); this.operation(id); })] : []),
      this.button("Share Local", "Share this container", () => this.host.shareMachine(id)),
      this.button("Connect to phone", "Phone registration for this container", () => { dialog.close(); return this.host.connectToPhone(id); }),
      this.button("Delete container", "Delete container and its files", async () => { if (!Services.prompt.confirm(this.host.win, "Delete container?", "Permanently delete this container and all files stored in it?")) return; await this.control("machines.delete", { id, confirmName: state.machine.name }); if (this.selected() === id) await this.host.disconnectSelected(); dialog.close(); await this.refresh(); }));
  }
  machineHelpers(config, status) {
    const section = this.node("section"), fields = this.node("div"), failure = this.node("p", { role: "alert" }); let devices = [];
    section.append(this.node("h3", {}, "Display, ports and media"), fields, failure);
    const apply = update => { try { const value = JSON.parse(config.value); update(value); config.value = JSON.stringify(value, null, 2); failure.textContent = ""; } catch (error) { failure.textContent = error.message; } };
    const input = (label, value, update, type = "text") => {
      const field = this.node("input", { type, "aria-label": label });
      if (type === "checkbox") field.checked = Boolean(value); else field.value = value ?? "";
      field.addEventListener("change", () => apply(value => update(value, type === "checkbox" ? field.checked : field.value)));
      const wrap = this.node("label", {}, label); wrap.append(field); return wrap;
    };
    const select = (label, selected, choices, update) => {
      const field = this.node("select", { "aria-label": label }); for (const [id, title] of choices) field.append(this.node("option", { value: id }, title)); field.value = selected;
      field.addEventListener("change", () => apply(value => update(value, field.value)));
      const wrap = this.node("label", {}, label); wrap.append(field); return wrap;
    };
    const render = () => {
      let value; try { value = JSON.parse(config.value); } catch (error) { failure.textContent = error.message; return; }
      fields.replaceChildren();
      fields.append(select("Display rendering", value.display.mode, [["auto", "GPU when supported"], ["software", "CPU"]], (v, mode) => { v.display.mode = mode; }),
        input("DRM render node", value.display.renderNode, (v, node) => { v.display.renderNode = node.trim() || null; }),
        this.button("Use detected render node", "Use this browser's detected render node", async () => { const caps = await this.displayCapabilities(); apply(v => { v.display.renderNode = caps.drmRenderNode || null; }); render(); }),
        input("NVIDIA GPU IDs (all, indexes or UUIDs)", (value.integrations.gpus || []).join(", "), (v, gpus) => { v.integrations.gpus = gpus.split(/[\s,]+/).filter(Boolean); }));
      for (const [index, port] of value.integrations.ports.entries()) {
        const row = this.node("fieldset"); row.append(this.node("legend", {}, "Port " + (index + 1)));
        const edit = (key, numeric = false) => (v, text) => { if (!v.integrations.ports[index]) throw Error("Refresh the changed port configuration."); v.integrations.ports[index][key] = numeric ? Number(text) : text; };
        row.append(input("Enabled", port.enabled, edit("enabled"), "checkbox"),
          select("Direction", port.direction, [["host-to-guest", "Host to guest"], ["guest-to-host", "Guest to host"]], edit("direction")),
          select("Protocol", port.protocol, [["tcp", "TCP"], ["udp", "UDP"]], edit("protocol")),
          input("Host address", port.hostAddress, edit("hostAddress")), input("Host port", port.hostPort, edit("hostPort", true), "number"),
          input("Guest address", port.guestAddress, edit("guestAddress")), input("Guest port", port.guestPort, edit("guestPort", true), "number"),
          this.button("Remove port", "Remove port mapping", () => { apply(v => v.integrations.ports.splice(index, 1)); render(); })); fields.append(row);
      }
      fields.append(this.button("Add port", "Add a port mapping", () => { apply(v => v.integrations.ports.push({ enabled: false, protocol: "tcp", direction: "host-to-guest", hostAddress: "127.0.0.1", hostPort: 0, guestAddress: "127.0.0.1", guestPort: 0 })); render(); }));
      for (const [key, title] of [["guest_audio_output", "Guest audio output"], ["host_microphone", "Host microphone"], ["host_camera", "Host camera"]]) {
        const media = value.integrations.media[key], choices = devices.filter(device => device.kind === key).map(device => [device.node, device.description + (device.default ? " (default)" : "")]);
        if (media.node && !choices.some(([id]) => id === media.node)) choices.unshift([media.node, media.node + " (unavailable)"]);
        const row = this.node("fieldset"); row.append(this.node("legend", {}, title), input("Enabled", media.enabled, (v, enabled) => { v.integrations.media[key].enabled = enabled; }, "checkbox"),
          select("Device", media.node || "", [["", "System default"], ...choices], (v, node) => { v.integrations.media[key].node = node || null; }));
        const live = status.find(item => item.name === key); if (live) row.append(this.node("small", {}, live.error || (live.running ? "Running" : "Stopped"))); fields.append(row);
      }
    };
    const refresh = async () => { try { const result = await this.control("machines.media-devices"); if (!section.isConnected) return; devices = result.devices || []; failure.textContent = ""; render(); } catch (error) { failure.textContent = error.message; } };
    section.append(this.button("Refresh devices", "Refresh host media devices", refresh), this.node("p", {}, "These helpers edit the configuration below. Save changes, then stop/start or restart to apply changed launch settings."));
    config.addEventListener("change", render); render(); this.host.win.setTimeout(refresh, 0); return section;
  }
  operation(id) {
    const { dialog, content } = this.host.dialog("Container preparation"), output = this.node("pre"), status = this.node("p", { role: "status" }); let cursor = 0, timer;
    content.append(status, output, this.button("Cancel operation", "Cancel container operation", () => this.control("machines.cancel", { id })));
    const refresh = async () => { try { const result = await this.control("machines.operation", { id, cursor }); if (!dialog.open) return; const read = result.cursor - cursor; cursor = result.cursor; output.append(this.doc.createTextNode(result.output || "")); status.textContent = result.error || result.phase || result.state;
      if (read >= 65536 || result.hasMore) timer = setTimeout(refresh, 0);
      else if (result.exitCode === null || result.state === "running") timer = setTimeout(refresh, 500); else await this.refresh();
    } catch (error) { status.textContent = error.message; } }; dialog.addEventListener("close", () => clearTimeout(timer), { once: true }); void refresh();
  }
}
