/* SPDX-License-Identifier: AGPL-3.0-only */
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";

/** Native connection controls; no commands or enrollment secrets enter a page. */
export async function remoteServices(parent, id, win, openAgent) {
  const doc = parent.ownerDocument;
  const node = (tag, text = "") => { const value = doc.createElementNS("http://www.w3.org/1999/xhtml", tag); value.textContent = text; return value; };
  const body = node("div"), error = node("p"); error.setAttribute("role", "alert"); parent.append(body, error);
  let busy = false;
  const run = async (task, status = error) => {
    if (busy || !parent.isConnected) return;
    busy = true; error.textContent = ""; status.textContent = "Working…";
    try {
      // Read and validate the form before disabling it for the async operation.
      const pending = task();
      if (!pending?.then) return;
      for (const control of parent.querySelectorAll("button,input")) control.disabled = true;
      await pending;
    } catch (failure) { if (parent.isConnected) (status.isConnected ? status : error).textContent = failure.message; }
    finally {
      busy = false;
      if (status.textContent === "Working…") status.textContent = "";
      for (const control of parent.querySelectorAll("button,input")) control.disabled = false;
    }
  };
  const button = (title, task, status = error) => {
    const value = node("button", title); value.type = "button"; value.addEventListener("click", () => run(task, status)); return value;
  };
  const draw = result => {
    if (!parent.isConnected) return;
    body.replaceChildren();
    for (const service of result.services) {
      const card = node("section"); card.className = "connection-card"; body.append(card);
      const status = node("p"); status.setAttribute("role", "status");
      card.append(node("strong", service.name), node("p", `${service.state} · ${service.reachable ? "Target reachable" : "Target unavailable"}`));
      if (service.error) card.append(node("p", service.error));
      if (service.id === "agent") { card.append(button("Open Agent", openAgent, status), status); continue; }
      for (const action of service.actions) card.append(button(`${action === "start" ? "Start" : action === "stop" ? "Stop" : "Reload"} on host`, async () => {
        if (action !== "start" && !Services.prompt.confirm(win, "Change host service?", `${action === "stop" ? "Stop" : "Restart"} “${service.name}” for all clients? Active streams will end.`)) return;
        draw(await AgentRemotes.serviceAction(id, service.id, action));
      }, status));
      const form = node("form"), label = node("label", "Local access"), enabled = node("input");
      enabled.type = "checkbox"; enabled.checked = service.choice.enabled; label.prepend(enabled); form.append(label);
      const portLabel = node("label", "Port (blank for Automatic)"), port = node("input");
      port.type = "number"; port.min = 1; port.max = 65535; port.placeholder = "Automatic";
      port.value = service.choice.port || ""; portLabel.append(port); form.append(portLabel);
      const importChoice = node("input"), key = node("input");
      importChoice.type = "checkbox"; importChoice.checked = service.choice.importToPi === true;
      key.type = "password"; key.autocomplete = "off"; key.value = service.choice.apiKey || "";
      if (service.kind === "llama") {
        form.append(button("Add to Pi", () => { importChoice.checked = true; importChoice.focus(); }, status));
        const label = node("label", "Import this configuration into the coding agent"); label.prepend(importChoice); form.append(label);
        const keyLabel = node("label", "Service API key (if required)"); keyLabel.append(key); form.append(keyLabel);
        if (service.choice.importState) form.append(node("p", service.choice.importState));
      }
      form.append(button("Save changes", async () => {
        if (!form.reportValidity()) return;
        draw(await AgentRemotes.saveMapping(id, service.id, { enabled: enabled.checked, port: port.value === "" ? 0 : Number(port.value), importToPi: importChoice.checked, apiKey: key.value }));
      }, status));
      form.addEventListener("submit", event => event.preventDefault()); card.append(form);
      if (service.choice.error || service.mapping?.error) card.append(node("p", service.choice.error || service.mapping.error));
      if (service.url) {
        const address = node("code", service.url); card.append(node("p")); card.lastChild.append(address);
        card.append(button("Open", () => AgentRemotes.openService(id, service.id, win), status), button("Copy URL", () => {
          Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(service.url);
          address.textContent = `${service.url} · Copied`;
        }, status));
        if (service.kind === "llama") card.append(node("p", new URL("/v1", service.url).href));
      }
      card.append(status);
    }
  };
  parent.append(button("Refresh services", async () => draw(await AgentRemotes.services(id))));
  await run(async () => draw(await AgentRemotes.services(id)));
}
