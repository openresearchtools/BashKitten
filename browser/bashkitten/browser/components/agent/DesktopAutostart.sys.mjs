/* SPDX-License-Identifier: AGPL-3.0-only */
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";

const LOCAL = "bashkitten.agent.autostart";
const LOGIN = "[Desktop Entry]\nType=Application\nName=BashKitten\nExec=/usr/bin/bashkitten --start-in-tray\nTryExec=/usr/bin/bashkitten\nIcon=com.bashkitten\nTerminal=false\nStartupNotify=false\n";
function loginFile() {
  const xdg = Services.env.get("XDG_CONFIG_HOME"), home = Services.dirsvc.get("Home", Ci.nsIFile).path;
  return PathUtils.join(xdg && PathUtils.isAbsolute(xdg) ? xdg : PathUtils.join(home, ".config"), "autostart", "com.bashkitten.desktop");
}
export function localAutostart() { return Services.prefs.getBoolPref(LOCAL, true); }
export function setLocalAutostart(enabled) {
  if (typeof enabled !== "boolean") throw new Error("Choose whether Local starts with BashKitten.");
  Services.prefs.setBoolPref(LOCAL, enabled); return { enabled };
}
export async function loginAutostart() {
  const file = loginFile();
  if (!await IOUtils.exists(file)) return false;
  if (await IOUtils.readUTF8(file) !== LOGIN) throw new Error("The BashKitten autostart file was edited outside the browser. Update or remove it there first.");
  return true;
}
export async function setLoginAutostart(enabled) {
  if (typeof enabled !== "boolean") throw new Error("Choose whether BashKitten starts at login.");
  await loginAutostart();
  const file = loginFile();
  if (enabled) {
    await IOUtils.makeDirectory(PathUtils.parent(file), { permissions: 0o700, ignoreExisting: true });
    await IOUtils.writeUTF8(file, LOGIN, { tmpPath: file + ".tmp", flush: true });
  } else await IOUtils.remove(file, { ignoreAbsent: true });
}

/** The view's immutable owner selects services; app startup lists owned machines. */
export function autostartController({ control, request, backend, current, startupStatus }) {
  const check = () => { if (!current()) throw new Error("The Autostart view is closed."); };
  const machines = async () => (await control("machines.list")).machines;
  const environmentCall = async (id, name, value = {}) => {
    let result;
    try { result = await (id === "local" ? control(name, value) : control(`machines.${name}`, { ...value, id })); }
    catch (error) { if (id === "local" && name === "autostart-status") startupStatus?.({ error: error.message }); throw error; }
    if (id === "local") startupStatus?.(result);
    return result;
  };
  const environment = async id => {
    if (id === "local") return { id, name: "Local", call: (name, value) => environmentCall(id, name, value) };
    const machine = (await machines()).find(item => item.id === id);
    check();
    if (!machine) throw new Error("This container is no longer available.");
    return { id, name: machine.name, call: (name, value) => environmentCall(id, name, value) };
  };
  const entry = (id, label, group, enabled, detail = "", available = true) => ({ id, label, group, enabled, detail, available });
  async function snapshot() {
    check();
    const entries = [], environments = [];
    // Failure in one owner must not hide unrelated saved startup choices.
    const add = async (id, label, group, read) => {
      try { entries.push(...await read()); }
      catch (error) { entries.push(entry(id, label, group, null, error.message, false)); }
    };
    await add("login", "Start BashKitten at login", "Application", async () => [entry("login", "Start BashKitten at login", "Application", await loginAutostart())]);
    entries.push(entry("local", "Start Local when BashKitten opens", "Application", localAutostart()));
    let catalogue = [];
    await add("machines", "Containers", "Containers", async () => {
      catalogue = await machines();
      return catalogue.flatMap(machine => [
        entry(`machine:${machine.id}`, machine.name, "Containers", machine.autostart === true, "Start this container and its Agent in the background."),
        entry(`display:${machine.id}`, `Display — ${machine.name}`, "Containers", machine.displayAutostart === true, "Start its desktop when this container starts, without opening a Display tab."),
      ]);
    });
    await add("remotes", "Saved connections", "Remote connections", async () => (await AgentRemotes.list()).map(remote =>
      entry(`remote:${remote.id}`, remote.name, "Remote connections", remote.autostart, "Connect through its saved encrypted route. Sign-in may still be required.")));
    if (["local", "machine"].includes(backend.kind)) {
      await add("engines", "Local AI", backend.name, async () => {
        const state = await request("localai-status");
        return [["llama", "llama.cpp router"], ["whisper", "Speech recognition"], ["tts", "Text to speech"]].map(([engine, label]) => {
          const value = state[engine], capability = value.startupCapability || { available: engine !== "tts" };
          return entry(`engine:${engine}`, label, backend.name, typeof value.config.startup === "boolean" ? value.config.startup : null,
            [capability.detail || "Start the saved service when this environment starts.", value.error || value.service?.error].filter(Boolean).join(" "), capability.available);
        });
      });
      await add("publishing", "Publish this environment", backend.name, async () => {
        const state = await request("share-status");
        return [entry("publishing", "Publish this environment", backend.name, state.startup === true,
          [state.phase === "ready" ? "Uses the saved Tor, Chisel, Caddy and Authelia setup when its Agent is running." : "Complete Share Local setup first.", state.error].filter(Boolean).join(" "), state.phase === "ready")];
      });
      await add("services", "Hosted services", backend.name, async () => {
        const state = await request("service-status");
        return state.services.filter(service => service.command && !service.id.startsWith("localai-")).map(service =>
          entry(`service:${service.id}`, service.name, backend.name, service.startup, ["Start its saved command with this environment.", service.error].filter(Boolean).join(" ")));
      });
    }
    for (const owner of [{ id: "local", name: "Local" }, ...catalogue]) {
      check();
      try {
        const state = await environmentCall(owner.id, "autostart-status");
        const errors = [state.error, ...Object.entries(state.startupErrors || {}).map(([name, message]) => `${name}: ${message}`)].filter(Boolean);
        environments.push({ id: owner.id, name: owner.name, available: true, detail: errors.join("; "), file: state.file, revision: state.revision, commands: state.commands,
          status: (state.status || []).map(({ id, state, error, exitCode, savedForNextStart }) => ({ id, state, error, exitCode, savedForNextStart })) });
      } catch (error) { environments.push({ id: owner.id, name: owner.name, available: false, detail: error.message }); }
    }
    check(); return { entries, environments };
  }
  return async (name, value) => {
    check();
    if (name === "autostart.get") return snapshot();
    if (name === "autostart.commands.save") {
      const target = await environment(value.environmentId); check();
      return target.call("autostart-save", { revision: value.revision, commands: value.commands });
    }
    if (name !== "autostart.set" || typeof value.id !== "string" || typeof value.enabled !== "boolean") throw new Error("Invalid startup choice.");
    const { id, enabled } = value;
    if (id === "login") { await setLoginAutostart(enabled); return { enabled }; }
    if (id === "local") return setLocalAutostart(enabled);
    if (id.startsWith("remote:")) return AgentRemotes.setAutostart(id.slice(7), enabled);
    if (id.startsWith("machine:") || id.startsWith("display:")) {
      const target = await environment(id.slice(8));
      const saved = await control("machines.get", { id: target.id }); check();
      const config = id.startsWith("display:")
        ? { ...saved.config, display: { ...saved.config.display, startup: enabled } }
        : { ...saved.config, autostart: enabled };
      return control("machines.save", { id: target.id, config });
    }
    if (!["local", "machine"].includes(backend.kind)) throw new Error("Configure services on their owning device.");
    if (id.startsWith("engine:")) {
      const engine = id.slice(7);
      if (!["llama", "whisper"].includes(engine)) throw new Error("This engine has no persistent startup service.");
      const state = await request("localai-status"); check();
      if (state[engine].startupCapability?.available === false) throw new Error(state[engine].startupCapability.detail);
      return request("localai-save", { engine, revision: state.revision, config: { ...state[engine].config, startup: enabled } });
    }
    if (id === "publishing") return request("share-startup", { enabled });
    if (id.startsWith("service:")) {
      const state = await request("service-status"), service = state.services.find(item => item.id === id.slice(8)); check();
      if (!service?.command || service.id.startsWith("localai-")) throw new Error("Choose an existing hosted command.");
      return request("service-save", { revision: state.revision, service: { ...service, startup: enabled } });
    }
    throw new Error("This startup choice is no longer available.");
  };
}
