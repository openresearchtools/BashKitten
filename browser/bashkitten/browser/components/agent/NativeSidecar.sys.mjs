/* SPDX-License-Identifier: AGPL-3.0-only */
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
const NS = "http://www.w3.org/1999/xhtml";

/** Native hierarchy. The protected chat supplies only its own session catalogue. */
export class NativeSidecar {
  constructor(host, control) {
    this.host = host; this.control = control; this.doc = host.doc;
    this.cache = new Map(); this.rows = new Map(); this.expanded = new Map(); this.renderEpoch = 0;
    host.win.addEventListener("unload", () => { this.closed = true; this.renderEpoch++; clearTimeout(this.catalogueTimer); this.resize.disconnect(); }, { once: true });
    this.root = this.node("aside", { id: "bashkitten-native-sidecar", "aria-label": "Environments, projects and chats" });
    this.notice = this.node("p", { role: "status" }); this.root.append(this.notice);
    this.groups = new Map();
    for (const kind of ["local", "machine", "remote"]) {
      const group = this.node("div", { class: "native-environment-group" }); this.groups.set(kind, group); this.root.append(group);
      if (kind !== "local") group.append(this.sectionHeading(kind === "machine" ? "Containers" : "Remotes",
        kind === "machine" ? "Create container VM" : "Connect to remote",
        () => kind === "machine" ? this.createMachine() : this.host.remotes()));
    }
    this.resize = new host.win.ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width > 0) { this.narrow = width < 720; host.pane.setAttribute("data-sidecar-narrow", String(this.narrow)); }
    });
    this.resize.observe(host.pane); this.open();
  }
  node(tag, attrs = {}, text) { const node = this.doc.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); if (text !== undefined) node.textContent = text; return node; }
  icon(kind) {
    const paths = { folder: "M3 7V5h6l2 2h10v13H3V7Z" };
    const svg = this.doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = this.doc.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", paths[kind]); svg.append(path); return svg;
  }
  button(text, label, action) {
    const button = this.node("button", { type: "button", title: label, "aria-label": label }, text);
    button.addEventListener("click", async () => { button.disabled = true; try { this.notice.textContent = ""; await action(); } catch (error) { this.notice.textContent = error.message; } finally { button.disabled = false; } }); return button;
  }
  iconButton(image, label, action) {
    const button = this.button("", label, action);
    button.append(this.node("img", { src: image, alt: "", class: "native-control-icon" }));
    return button;
  }
  sectionHeading(title, label, action) {
    const heading = this.node("div", { class: "native-section-heading" });
    heading.append(this.node("span", {}, title), this.button("+", label, action)); return heading;
  }
  isOpen() { return this.host.pane.getAttribute("data-sidecar-open") !== "false"; }
  setOpen(open) { this.host.pane.setAttribute("data-sidecar-open", String(open)); this.host.chatsToggle?.setAttribute("aria-expanded", String(open)); }
  open() { this.setOpen(true); }
  close() { this.setOpen(false); }
  toggle() { this.setOpen(!this.isOpen()); }
  chatSelected() { if (this.narrow) this.close(); }
  updateDisplays(buttons = this.root.querySelectorAll("[data-display-id]")) {
    for (const button of buttons) {
      const open = this.host.machineDisplayOpen(button.dataset.displayId);
      const label = `${open ? "Close" : "Open"} ${button.dataset.displayName} Display`;
      button.setAttribute("aria-pressed", String(open));
      button.setAttribute("aria-label", label); button.title = label;
    }
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
      if (!section) { section = this.node("section", { class: "native-backend" }); this.rows.set(backend.id, section); this.groups.get(backend.kind).append(section); }
      section.replaceChildren();
      const heading = this.node("div", { class: "native-backend-heading" });
      const open = this.button(backend.name, backend.name, async () => { await this.select(backend.id); await this.refreshChats(); }); open.className = "native-title";
      heading.append(open);
      const on = backend.kind === "remote" ? backend.state === "ready" : backend.kind === "machine" ? ["running", "preparing", "starting", "stopping", "deleting"].includes(backend.state) : this.host.localOn;
      const power = this.button("", `${backend.name}: ${on ? "Turn off" : "Turn on"}`, async () => {
        if (backend.kind === "machine") {
          await this.control(on ? "machines.stop" : "machines.start", { id: backend.id, ...(!on ? { displayCapabilities: await this.displayCapabilities() } : {}) });
          if (on && backend.id === this.selected()) await this.host.disconnectSelected();
        }
        else if (backend.kind === "remote" && on) { await AgentRemotes.disconnect(backend.id); if (backend.id === this.selected()) await this.host.disconnectSelected(); }
        else if (backend.kind === "local" && on) await this.host.stopLocal();
        else await this.select(backend.id);
        await this.refresh();
      });
      power.className = "native-power-toggle";
      power.append(this.node("span", { class: "native-power-track", "aria-hidden": "true" }));
      power.disabled = ["preparing", "starting", "stopping", "deleting"].includes(backend.state);
      power.setAttribute("role", "switch"); power.setAttribute("aria-checked", String(Boolean(on))); heading.append(power);
      if (backend.kind === "machine") heading.append(this.iconButton("chrome://global/skin/icons/settings.svg", `${backend.name} settings`, () => this.machineSettings(backend.id)));
      if (backend.kind === "machine") {
        const display = this.iconButton("chrome://browser/skin/device-desktop.svg", `Open ${backend.name} Display`, () => this.host.toggleMachineDisplay(backend.id));
        display.dataset.displayId = backend.id; display.dataset.displayName = backend.name;
        this.updateDisplays([display]);
        heading.append(display);
      }
      if (backend.kind === "remote") heading.append(this.button("⋯", `${backend.name} actions`, () => this.remoteActions(backend)));
      section.append(heading);
      if (backend.kind !== "local") section.append(this.node("small", { class: "native-backend-state", role: "status" }, backend.state || "Disconnected"));
      if (backend.error || backend.lastError) section.append(this.node("p", { class: "native-error" }, backend.error || backend.lastError));
      const snapshot = this.cache.get(backend.id);
      section.append(this.sectionHeading("Projects", `Create project in ${backend.name}`, async () => { await this.select(backend.id); await this.projectPicker(); }));
      const chatsHeading = () => this.sectionHeading("Chats", `New standalone chat in ${backend.name}`, async () => {
        await this.select(backend.id); await this.navigation("new"); await this.refreshChats(); this.chatSelected();
      });
      if (!snapshot) { section.append(chatsHeading(), this.node("small", {}, "Select to load chats")); continue; }
      const sessions = snapshot.sessions || [], known = new Set(sessions.map(session => session.id));
      const roots = sessions.filter(session => !known.has(session.subagentParent));
      const appendChat = (chat, target, depth = 0, visited = new Set()) => {
        if (visited.has(chat.id)) return; visited.add(chat.id);
        const row = this.node("div", { class: "native-chat", "data-selected": backend.id === this.selected() && chat.id === snapshot.selected });
        row.style.paddingInlineStart = `${depth * 12}px`;
        const children = sessions.filter(child => child.subagentParent === chat.id);
        if (children.length) row.append(this.button(this.expanded.get(backend.id + ":" + chat.id) === false ? "▸" : "▾", "Show subagent chats", () => { this.expanded.set(backend.id + ":" + chat.id, this.expanded.get(backend.id + ":" + chat.id) === false); this.render(); }));
        const link = this.button((chat.running ? "● " : "") + chat.title, chat.title, async () => { await this.select(backend.id); await this.navigation("open", { id: chat.id }); await this.refreshChats(); this.chatSelected(); }); link.className = "native-title";
        row.append(link, this.button("⋯", "Chat actions", async () => { await this.select(backend.id); this.chatActions(chat, snapshot.projects || []); })); target.append(row);
        if (this.expanded.get(backend.id + ":" + chat.id) !== false) for (const child of children) appendChat(child, target, depth + 1, visited);
      };
      for (const project of snapshot.projects || []) {
        const group = this.node("details"); group.open = this.expanded.get(backend.id + ":" + project.id) !== false;
        group.addEventListener("toggle", () => this.expanded.set(backend.id + ":" + project.id, group.open));
        const summary = this.node("summary"); summary.append(this.icon("folder"), this.node("span", {}, project.name)); group.append(summary);
        const newProjectChat = this.button("+", "New chat in " + project.name, async () => { await this.select(backend.id); await this.navigation("new", { projectId: project.id }); await this.refreshChats(); this.chatSelected(); });
        const projectActions = this.button("⋯", "Project actions", async () => { await this.select(backend.id); this.projectActions(project); });
        for (const button of [newProjectChat, projectActions]) button.addEventListener("click", event => event.stopPropagation());
        summary.append(newProjectChat, projectActions);
        for (const chat of roots.filter(chat => chat.projectId === project.id)) appendChat(chat, group, 1);
        section.append(group);
      }
      section.append(chatsHeading());
      for (const chat of roots.filter(chat => !chat.projectId)) appendChat(chat, section);
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
    const backend = this.selected(), { dialog, content, actions } = this.host.dialog("Create project"), name = this.node("input", { placeholder: "Project name", "aria-label": "Project name" }), location = this.node("span", {}, "Loading folder…"), folders = this.node("div", { class: "native-project-folders", hidden: "", "aria-label": "Folders" }), error = this.node("p", { role: "alert" });
    const requestId = Services.uuid.generateUUID().toString(), browser = this.host.activeBrowser, global = browser?.browsingContext.currentWindowGlobal;
    dialog.classList.add("native-project-dialog"); content.className = "native-project-form";
    const header = this.node("div", { class: "native-project-header" }), heading = dialog.querySelector("h2"), close = actions.querySelector("button");
    heading.id = "project-title-" + requestId; dialog.setAttribute("aria-labelledby", heading.id);
    close.textContent = "×"; close.className = "native-project-close"; close.setAttribute("aria-label", "Close Create project"); close.title = "Close";
    header.append(heading, close); dialog.prepend(header); actions.remove();
    folders.id = "project-folders-" + requestId;
    const folderPicker = this.button("", "Choose project folder", () => { folders.hidden = !folders.hidden; folderPicker.setAttribute("aria-expanded", String(!folders.hidden)); });
    folderPicker.className = "native-project-folder"; folderPicker.setAttribute("aria-expanded", "false"); folderPicker.setAttribute("aria-controls", folders.id);
    folderPicker.append(this.icon("folder"), location);
    const current = () => dialog.open && backend === this.selected() && browser === this.host.activeBrowser && global === browser?.browsingContext.currentWindowGlobal;
    dialog.addEventListener("close", () => { global?.getActor("BashKittenAgent").sendQuery("Navigation", { action: "folders-cancel", value: { requestId } }).catch(() => {}); }, { once: true });
    let selected, generation = 0; content.append(name, folderPicker, folders, error);
    const load = async path => { if (!current()) throw new Error("The selected backend changed."); const epoch = ++generation; const result = await this.navigation("folders", { path, requestId }); if (!current() || epoch !== generation) return;
      selected = result.path; location.textContent = result.displayPath; folderPicker.title = result.displayPath; folderPicker.setAttribute("aria-label", "Project folder: " + result.displayPath); folders.replaceChildren();
      if (result.parent) folders.append(this.button("↑ Parent", "Parent folder", () => load(result.parent)));
      for (const folder of result.folders) folders.append(this.button(folder.name, folder.name, () => load(folder.path)));
    };
    content.append(this.button("Create", "Create project in selected folder", async () => { try { if (!selected || !current()) throw new Error("Choose a folder on this backend."); await this.navigation("project-create", { name: name.value, cwd: selected }); dialog.close(); await this.refreshChats(); } catch (e) { error.textContent = e.message; } }));
    name.focus();
    try { await load("~"); } catch (e) { error.textContent = e.message; }
  }
  remoteActions(remote) {
    const { dialog, content } = this.host.dialog(remote.name);
    content.append(this.button("Rename", "Rename remote", () => { dialog.close(); this.textDialog("Rename remote", remote.name, async name => { await AgentRemotes.rename(remote.id, name); await this.refresh(); }); }),
      this.button("Delete remote", "Delete saved remote", async () => { if (!Services.prompt.confirm(this.host.win, "Delete remote?", `Forget “${remote.name}” and its login? Its machine and chats are kept.`)) return; await AgentRemotes.remove(remote.id); if (this.selected() === remote.id) await this.host.disconnectSelected(); dialog.close(); await this.refresh(); }));
  }
  createMachine() {
    this.textDialog("Container name", "", async name => {
      const result = await this.control("machines.create", { name, displayCapabilities: await this.displayCapabilities() });
      // A coalesced catalogue request may have started before this machine existed.
      await this.refreshTask;
      await this.refresh();
      if (!this.closed) await this.operation(result.machine?.id || result.id);
    });
  }
  machineSettings(id) { return this.host.openSettings("machine", { backendId: id }); }
  operation(id) { return this.host.openSettings("machine", { backendId: id, operation: true }); }

}
