/* SPDX-License-Identifier: AGPL-3.0-only */
import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
import { AsyncShutdown } from "resource://gre/modules/AsyncShutdown.sys.mjs";
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";

const connections = new Map(), routes = new Map(), generations = new Map();
const proxy = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
const filter = {
  applyFilter(channel, previous, callback) {
    const id = channel.loadInfo?.originAttributes.userContextId;
    if (!routes.has(id) && !AgentRemotes.isMachineContext(id)) { callback.onProxyFilterResult(previous); return; }
    const item = routes.get(id);
    if (!item || !["https", "wss"].includes(channel.URI.scheme) || channel.URI.hostPort !== new URL(item.url).host) {
      channel.cancel(Cr.NS_ERROR_PROXY_CONNECTION_REFUSED); callback.onProxyFilterResult(null); return;
    }
    callback.onProxyFilterResult(proxy.newProxyInfoWithAuth("socks", "127.0.0.1", item.route.port,
      item.route.username, item.route.password, "", `machine-${id}`,
      Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST, 10, null));
  },
};
proxy.registerChannelFilter(filter, 1);
AsyncShutdown.profileBeforeChange.addBlocker("BashKitten: close machine views", () =>
  Promise.allSettled([...connections.keys()].map(id => disconnectMachine(id))));

export async function disconnectMachine(id, expectedGeneration) {
  const item = connections.get(id);
  if (expectedGeneration !== undefined && item?.generation !== expectedGeneration) return;
  generations.set(id, (generations.get(id) || 0) + 1);
  if (!item) return;
  connections.delete(id);
  if (item.context) routes.set(item.context, null);
  Services.obs.notifyObservers(null, "bashkitten-agent-control-revoke", "machine:" + id);
  Services.obs.notifyObservers(null, "net:prune-all-connections");
  await item.process.stdin.close().catch(() => {});
  await item.process.kill(1000); await item.process.wait();
}

export async function connectMachine(id, control, onClose, isSelected = () => true) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid machine identifier.");
  const retiring = disconnectMachine(id), generation = generations.get(id);
  const pending = () => { if (generations.get(id) !== generation || !isSelected()) throw new Error("Machine connection was replaced."); };
  await retiring; pending();
  const details = await control("machines.get", { id });
  pending();
  const process = await Subprocess.call({ command: "/usr/bin/bashkittenctl", arguments: ["machine-transport", id], stderr: "pipe" });
  if (generations.get(id) !== generation || !isSelected()) {
    await process.stdin.close().catch(() => {}); await process.kill(1000); await process.wait();
    pending();
  }
  const item = { process, generation }; connections.set(id, item);
  // Neither diagnostics nor the native bootstrap cookie belong in browser logs.
  let diagnostic = "";
  const errors = (async () => { for (let part; (part = await process.stderr.readString());) diagnostic = (diagnostic + part).slice(-4096); })();
  const current = () => { pending(); if (connections.get(id) !== item) throw new Error("Machine connection was closed."); };
  process.wait().then(async () => {
    if (connections.get(id) !== item) return;
    if (item.context) routes.set(item.context, null);
    connections.delete(id); Services.obs.notifyObservers(null, "bashkitten-agent-control-revoke", "machine:" + id);
    Services.obs.notifyObservers(null, "net:prune-all-connections");
    await errors.catch(() => {});
    let message = "The private container connection stopped.";
    try { message = JSON.parse(diagnostic).error || message; } catch { /* No diagnostics or bootstrap secrets enter logs. */ }
    onClose?.(new Error(message));
  }).catch(() => {});
  try {
    let line = "";
    while (!line.includes("\n")) {
      const part = await process.stdout.readString();
      if (!part) { await errors; throw new Error(diagnostic ? JSON.parse(diagnostic).error : "Machine connection stopped."); }
      line += part;
    }
    current(); const endpoint = JSON.parse(line.trim());
    const cookieName = "__Host-bashkitten_local_" + endpoint.identity?.instanceId?.replaceAll("-", "");
    if (!endpoint.generation || endpoint.cookie?.name !== cookieName || !/^[a-f0-9]{64}$/.test(endpoint.cookie?.value || "") ||
        endpoint.route?.username !== "machine" || !/^[a-f0-9]{64}$/.test(endpoint.route?.password || "") ||
        !Number.isInteger(endpoint.route.port) || endpoint.route.port < 1 || endpoint.route.port > 65535) throw new Error("Invalid private machine bootstrap.");
    const trusted = await AgentRemotes.trustMachine("machine:" + id, details.machine.name, { url: endpoint.url, ...endpoint.identity });
    current(); item.context = trusted.userContextId;
    routes.set(item.context, { url: endpoint.url, route: endpoint.route });
    Services.cookies.add("127.0.0.1", "/", cookieName, endpoint.cookie.value, true, true, true,
      Date.now() + 400 * 86400000, { userContextId: item.context }, Ci.nsICookie.SAMESITE_STRICT, Ci.nsICookie.SCHEME_HTTPS);
    endpoint.cookie.value = "";
    const connection = await AgentRemotes.activate(trusted.id); current();
    return { ...connection, machineId: id, generation: endpoint.generation, transportGeneration: generation };
  } catch (error) { await disconnectMachine(id, generation); throw error; }
}
