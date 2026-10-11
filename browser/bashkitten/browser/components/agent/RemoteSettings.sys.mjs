/* SPDX-License-Identifier: AGPL-3.0-only */
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";
import { BrowserControlChannel } from "resource:///modules/BrowserControlChannel.sys.mjs";
import { localAutostart, setLocalAutostart } from "resource:///modules/DesktopAutostart.sys.mjs";
const remoteInfo = ({ id, name, url, state, error, migrationRequired, autostart }) => ({ id, name, url, state, error, migrationRequired, autostart });
function servicesInfo(result) {
  return { services: result.services.map(({ id, name, kind, state, reachable, error, actions, choice = {}, mapping, url, importState }) => ({
    id, name, kind, state, reachable, error, actions, url, importState,
    choice: { enabled: choice.enabled, port: choice.port, importToPi: choice.importToPi, hasKey: Boolean(choice.apiKey), error: choice.error, importState: choice.importState },
    mapping: mapping ? { port: mapping.port, error: mapping.error } : null,
  })) };
}

/** Only display metadata leaves the private connection owner. */
export async function remoteSettingsCall(host, name, value, current, advanceEpoch, backend) {
  const check = () => { if (!current()) throw new Error("The Remote Connections view is closed."); };
  check();
  if (name === "remotes.list") return { selected: host.selection || "local", localLabel: "Local", localAutostart: localAutostart(), shareLabel: backend.kind === "machine" ? `Share ${backend.name}` : "Share Local", remotes: (await AgentRemotes.list()).map(remoteInfo), capabilities: { scan: true, browserControl: true } };
  if (name === "remotes.local-autostart") return setLocalAutostart(value.enabled);
  if (name === "remotes.enroll") return host.enrollRemote(value.method, current);
  if (name === "remotes.share-local") { host.win.setTimeout(() => { if (current()) host.openSettings("share-local", { backendId: backend.kind === "machine" ? backend.id : "local" }).catch(console.error); }, 0); return { ok: true }; }
  if (name === "remotes.connect" && value.id === "local") { host.win.setTimeout(() => { if (current()) host.choose("").catch(console.error); }, 0); return { ok: true }; }
  const record = (await AgentRemotes.list()).find(item => item.id === value.id);
  check();
  if (!record) throw new Error("Choose an existing saved remote.");
  if (name === "remotes.autostart") return remoteInfo(await AgentRemotes.setAutostart(record.id, value.enabled));
  if (name === "remotes.connect") { host.win.setTimeout(() => { if (current()) host.choose(record.id).catch(console.error); }, 0); return { ok: true }; }
  if (name === "remotes.rename") return remoteInfo(await AgentRemotes.rename(record.id, value.name));
  if (name === "remotes.disconnect") {
    Services.obs.notifyObservers(null, "bashkitten-agent-control-revoke", record.id);
    await AgentRemotes.disconnect(record.id);
    if (current() && host.selection === record.id) {
      await host.disconnectSelected();
      if (host.selection === record.id) advanceEpoch();
    }
    return { ok: true };
  }
  if (name === "remotes.remove") {
    await AgentRemotes.remove(record.id);
    host.drafts.delete(`${record.id}:${record.identity}`);
    if (current() && host.selection === record.id) {
      await host.disconnectSelected();
      if (host.selection === record.id) advanceEpoch();
    }
    await host.refreshRemotes(); return { ok: true };
  }
  if (name === "remotes.revoke-browser") { await BrowserControlChannel.revoke(record.id); return { ok: true }; }
  if (name === "remotes.allow-browser") {
    if (host.selection !== record.id || record.state !== "ready") throw new Error("Connect to and sign in to this remote first.");
    BrowserControlChannel.allowAgain(record.id);
    await BrowserControlChannel.start(host.remote, { window: host.win }); return { ok: true };
  }
  const services = await AgentRemotes.services(record.id); check();
  if (name === "remotes.services") return servicesInfo(services);
  const service = services.services.find(item => item.id === value.serviceId);
  if (!service) throw new Error("Refresh the published services first.");
  if (name === "remotes.save-mapping") {
    if (!Number.isInteger(value.port) || value.port < 0 || value.port > 65535 || typeof value.enabled !== "boolean" || typeof value.importToPi !== "boolean") throw new Error("Choose Automatic or an integer port from 1 to 65535.");
    return servicesInfo(await AgentRemotes.saveMapping(record.id, service.id, { enabled: value.enabled, port: value.port, importToPi: value.importToPi, apiKey: service.choice.apiKey || "" }));
  }
  if (name === "remotes.service-key") {
    const secret = await host.serviceKeyPrompt(service.name, current); check();
    if (secret === null) return servicesInfo(services);
    return servicesInfo(await AgentRemotes.saveMapping(record.id, service.id, { enabled: service.choice.enabled, port: service.choice.port, importToPi: service.choice.importToPi === true, apiKey: secret }));
  }
  if (name === "remotes.service-action") return servicesInfo(await AgentRemotes.serviceAction(record.id, service.id, value.action));
  if (name === "remotes.open-service") {
    if (service.id === "agent") host.win.setTimeout(() => { if (current()) host.choose(record.id).catch(console.error); }, 0);
    else await AgentRemotes.openService(record.id, service.id, host.win);
    return { ok: true };
  }
  if (name === "remotes.copy-service") {
    if (!service.url) throw new Error("This service has no available local URL.");
    Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(service.url); return { ok: true };
  }
  throw new Error("Unsupported connection operation.");
}
