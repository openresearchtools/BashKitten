/* SPDX-License-Identifier: AGPL-3.0-only */
const HTML = "http://www.w3.org/1999/xhtml";

/** Browser-owned host editor. Its caller supplies private local IPC, never HTTP. */
export async function serviceSettings(parent, control, win) {
  const doc = parent.ownerDocument;
  const node = (tag, text = "") => { const element = doc.createElementNS(HTML, tag); element.textContent = text; return element; };
  const error = node("p"), body = node("div"); error.setAttribute("role", "alert");
  parent.append(body, error);
  let state, busy = false;
  const run = async operation => {
    if (busy || !parent.isConnected) return;
    busy = true; error.textContent = "";
    for (const button of body.querySelectorAll("button")) button.disabled = true;
    try { await operation(); }
    catch (failure) { if (parent.isConnected) error.textContent = failure.message; }
    finally { busy = false; for (const button of body.querySelectorAll("button")) button.disabled = false; }
  };
  const button = (title, action) => {
    const result = node("button", title); result.type = "button";
    result.addEventListener("click", () => run(action)); return result;
  };
  const draw = result => {
    if (!parent.isConnected) return;
    state = result; body.replaceChildren();
    for (const service of state.services.filter(service => !service.id.startsWith("localai-"))) {
      const card = node("section"); card.className = "connection-card";
      card.append(node("strong", service.name), node("p", `${service.state} · ${service.reachable ? "Target reachable" : "Target unavailable"}`));
      if (service.error) card.append(node("p", service.error));
      if (service.savedForNextStart) card.append(node("p", "Saved command applies on Reload."));
      for (const action of service.actions) card.append(button(action === "reload" ? "Reload" : action === "start" ? "Start" : "Stop", async () => {
        if (action === "reload" && !Services.prompt.confirm(win, "Reload service?", "Restart this service with its saved command? Active streams will end.")) return;
        draw(await control("service-action", { id: service.id, action }));
      }));
      card.append(button("Edit", () => edit(service)), button("Remove", async () => {
        if (Services.prompt.confirm(win, "Remove service?", `Stop and remove “${service.name}”? Its files are kept.`)) {
          draw(await control("service-remove", { id: service.id, revision: state.revision }));
        }
      }));
      if (service.output) { const detail = node("details"); detail.append(node("summary", "Output"), node("pre", service.output)); card.append(detail); }
      body.append(card);
    }
    body.append(button("Add service", () => edit()), button("Refresh", async () => draw(await control("service-status"))));
  };
  const edit = (service = {}) => {
    body.replaceChildren();
    const form = node("form"); body.append(form);
    const field = (title, value = "", multiline = false) => {
      const label = node("label", title), input = node(multiline ? "textarea" : "input");
      if (multiline) input.rows = 3;
      input.value = value; label.append(input); form.append(label); return input;
    };
    const select = (title, values, selected) => {
      const label = node("label", title), input = node("select");
      for (const value of values) { const option = node("option", value); option.value = value; input.append(option); }
      input.value = selected; label.append(input); form.append(label); return input;
    };
    const check = (title, checked) => {
      const label = node("label", title), input = node("input"); input.type = "checkbox"; input.checked = checked;
      label.prepend(input); form.append(label); return input;
    };
    const name = field("Name", service.name);
    const target = field("Target — loopback address:port or /absolute/socket", service.target?.address);
    const scheme = select("Web scheme", ["http", "https"], service.scheme || "http");
    const openPath = field("Opening path", service.openPath || "/");
    const kind = select("Type", ["web", "llama"], service.kind || "web");
    const enabled = check("Available remotely", service.enabled ?? true);
    form.append(node("p", "An external service needs no launch command. For an owned service, enter its absolute executable and arguments as a JSON array. Shell syntax requires an explicit shell command."));
    const argv = field("Launch command (JSON array)", service.command ? JSON.stringify(service.command.argv, null, 2) : "", true);
    const cwd = field("Working directory", service.command?.cwd);
    const env = field("Environment (JSON object)", JSON.stringify(service.command?.env || {}), true);
    const startup = check("Launch on startup", service.startup || false);
    form.append(button("Save changes", async () => {
      const value = { id: service.id, name: name.value, target: { network: target.value.startsWith("/") ? "unix" : "tcp", address: target.value },
        scheme: scheme.value, openPath: openPath.value, kind: kind.value, enabled: enabled.checked, startup: startup.checked,
        command: argv.value.trim() ? { argv: JSON.parse(argv.value), cwd: cwd.value, env: JSON.parse(env.value) } : null };
      draw(await control("service-save", { service: value, revision: state.revision }));
    }), button("Cancel", () => draw(state)));
    form.addEventListener("submit", event => event.preventDefault());
    name.focus();
  };
  await run(async () => draw(await control("service-status")));
}
