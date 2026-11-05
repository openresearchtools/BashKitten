/* SPDX-License-Identifier: AGPL-3.0-only */

const HTML = "http://www.w3.org/1999/xhtml";
const styledWindows = new WeakSet();

function html(doc, name, attrs = {}, text) {
  const node = doc.createElementNS(HTML, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function ensureStyles(win) {
  if (styledWindows.has(win)) return;
  win.windowUtils.loadSheetUsingURIString("chrome://browser/content/taskarian/agent/about.css", Ci.nsIStyleSheetService.AUTHOR_SHEET);
  styledWindows.add(win);
}

/** Browser-owned legal information, independent of the protected Agent. */
export const TaskarianAbout = {
  onWindowOpened(win) {
    // Load shared dialog rules before Agent's more specific dialog extensions.
    // Every selector is scoped to dialogs, including in an ordinary guest.
    ensureStyles(win);
    // PanelUI owns this view in its template until the native menu first opens.
    const view = win.PanelUI.mainView;
    if (view.querySelector("#appMenu-taskarian-about")) return;
    const menu = win.document.createXULElement("toolbarbutton");
    for (const [name, value] of Object.entries({ id: "appMenu-taskarian-about", label: "About Taskarian", class: "subviewbutton" })) menu.setAttribute(name, value);
    menu.addEventListener("command", () => { win.PanelUI.hide(); win.openAboutDialog(); });
    view.querySelector("#appMenu-settings-button").before(menu);
  },

  dialog(win, title) {
    ensureStyles(win);
    const doc = win.document;
    const dialog = html(doc, "dialog", { class: "taskarian-agent-dialog" });
    dialog.append(html(doc, "h2", {}, title));
    const content = html(doc, "div");
    dialog.append(content);
    const actions = html(doc, "div", { class: "actions" });
    const close = html(doc, "button", { type: "button" }, "Close");
    close.addEventListener("click", () => dialog.close());
    actions.append(close);
    dialog.append(actions);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    doc.documentElement.append(dialog);
    dialog.showModal();
    return { dialog, content, actions };
  },

  async licenses(win) {
    const doc = win.document;
    const { dialog, content } = this.dialog(win, "Licenses and source");
    // Downloaded runtime notices remain with their existing real Agent owner.
    // A managed guest never creates that owner or calls its local controller.
    if (win.TaskarianAgent) {
      const downloaded = html(doc, "button", { type: "button" }, "AI runtimes and models");
      downloaded.addEventListener("click", () => { dialog.close(); win.TaskarianAgent.aiLicenses(); }); content.append(downloaded);
    }
    try {
      const records = await IOUtils.readJSON("/usr/lib/taskarian/licenses.json");
      if (!dialog.open || !dialog.isConnected || win.closed) return;
      content.append(html(doc, "h3", {}, "Bundled components"));
      content.append(html(doc, "p", {}, "Full notices and source information for the bundled browser, Agent, References, Files, Office, private Node/npm, Pi, search and authentication components. Python and Linux system libraries retain their separately installed package licenses."));
      const appendText = (parent, value) => {
        const text = String(value), links = /https?:\/\/[^\s<>"']+/g;
        let offset = 0;
        for (const match of text.matchAll(links)) {
          const source = match[0].replace(/[),.;\]]+$/, "");
          let url;
          try { url = new URL(source); } catch { continue; }
          if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
          parent.append(doc.createTextNode(text.slice(offset, match.index)));
          const link = html(doc, "a", { href: url.href, rel: "noreferrer noopener" }, source);
          link.addEventListener("click", event => { event.preventDefault(); win.openTrustedLinkIn(url.href, "tab"); });
          parent.append(link);
          offset = match.index + source.length;
        }
        parent.append(doc.createTextNode(text.slice(offset)));
      };
      for (const record of records) {
        const detail = html(doc, "details");
        detail.append(html(doc, "summary", {}, [record.name, record.version, record.license].filter(Boolean).join(" · ")));
        detail.addEventListener("toggle", () => {
          if (detail.open && detail.childElementCount === 1) {
            const fields = [["source", "Source"], ["sourceCommit", "Source revision"], ["commit", "Revision"],
              ["sourceProvenance", "Source provenance"], ["modifications", "Modifications"], ["attribution", "Attribution"]];
            for (const [key, label] of fields) {
              if (record[key] == null) continue;
              const value = typeof record[key] === "string" ? record[key] : JSON.stringify(record[key], null, 2);
              const metadata = html(doc, "pre", { style: "white-space:pre-wrap;overflow-wrap:anywhere" });
              appendText(metadata, label + ": " + value); detail.append(metadata);
            }
            const text = html(doc, "pre", { style: "max-height:24rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere" });
            appendText(text, record.text); detail.append(text);
          }
        });
        content.append(detail);
      }
    } catch (error) {
      if (dialog.open && dialog.isConnected && !win.closed) content.append(html(doc, "p", {}, `Offline license files could not be opened: ${error.message || error}`));
    }
  },
};
