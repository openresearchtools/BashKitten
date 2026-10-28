// SPDX-License-Identifier: AGPL-3.0-only
// The existing project catalogue and References lifecycle owner perform all
// archive/relink/deletion work. This module only collects explicit UI choices.
import { node, button, field, dialog } from "./common.js";

export function manageLibrary({ api, project, onRetired = () => {} }) {
  const d = dialog("Library · " + project.name),
    controller = new AbortController(),
    scope = api.project(project.id),
    actions = node("div", { class: "toolbar" }),
    output = node("div"),
    folder = node("input", { value: project.cwd, required: true }),
    relink = node("details"),
    deletion = node("details"),
    confirmation = node("input", { autocomplete: "off" }),
    attachments = node("select");
  let busy = false,
    retired = false;
  d.body.classList.add("detail-form");
  attachments.append(
    node("option", { value: "keep" }, "Keep attachment files"),
    node(
      "option",
      { value: "delete" },
      "Delete this library’s attachment files",
    ),
  );
  function renewal(result) {
    if (!result.reopen && !result.reopenError) return;
    retired = true;
    onRetired();
    for (const control of d.body.querySelectorAll("button,input,select"))
      control.disabled = true;
    const path = result.reopen?.openPath;
    if (typeof path === "string" && path.startsWith("/apps/references/")) {
      const url = new URL(path, location.origin);
      if (
        url.origin === location.origin &&
        url.pathname.startsWith("/apps/references/")
      ) {
        d.actions.append(
          button("Reopen References", () => location.assign(url.href), {
            class: "primary",
          }),
        );
        return;
      }
    }
    output.append(
      node(
        "p",
        { class: "notice" },
        "Reopen References from BashKitten to continue.",
      ),
    );
  }
  function report(result) {
    const reconciliation = result.reconciliation;
    if (reconciliation) {
      output.append(
        node(
          "p",
          {},
          `${reconciliation.verified} of ${reconciliation.attachmentCount} attachment files verified; ${reconciliation.missing} missing; ${reconciliation.mismatched} mismatched.`,
        ),
      );
      if (reconciliation.issues?.length) {
        const details = node(
            "details",
            {},
            node("summary", {}, "Attachment reconciliation details"),
          ),
          rows = node("ul");
        for (const issue of reconciliation.issues.slice(0, 100))
          rows.append(node("li", {}, issue.path + " · " + issue.error));
        details.append(rows);
        output.append(details);
      }
    }
    renewal(result);
  }
  async function run(action, method, body) {
    if (busy || retired) return;
    busy = true;
    output.replaceChildren();
    d.notice.textContent = "Updating library…";
    try {
      const result = await scope.request(action, {
        method,
        body,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      d.notice.textContent =
        action === "library"
          ? "Library deleted."
          : action === "relink"
            ? "Project folder relinked."
            : body.archived
              ? "Library archived."
              : "Library unarchived.";
      report(result);
    } catch (error) {
      if (!controller.signal.aborted) {
        d.notice.textContent = error.message;
        report(error.details || {});
      }
    } finally {
      busy = false;
    }
  }
  actions.append(
    button(project.archived ? "Unarchive library" : "Archive library", () =>
      run("archive", "POST", { archived: !project.archived }),
    ),
  );
  relink.append(
    node("summary", {}, "Relink project folder"),
    node(
      "p",
      { class: "notice" },
      "Choose the new absolute folder after moving or copying its files. Attachment files are checked before the project folder is updated.",
    ),
    field("New project folder", folder),
    button("Verify attachments and relink", () => {
      if (!folder.reportValidity()) return;
      void run("relink", "POST", {
        cwd: folder.value,
        expectedCwd: project.cwd,
      });
    }),
  );
  const remove = button(
    "Delete library",
    () => {
      if (confirmation.value !== project.name) {
        d.notice.textContent =
          "Type the project name exactly to delete its library.";
        return;
      }
      void run("library", "DELETE", {
        confirmProjectId: project.id,
        attachments: attachments.value,
      });
    },
    { class: "danger" },
  );
  deletion.append(
    node("summary", {}, "Delete library…"),
    node(
      "p",
      { class: "notice" },
      "Delete this project’s reference database and saved import jobs. This cannot be undone here. Choose whether its attachment files are also deleted. The project and chat history remain.",
    ),
    field("Type “" + project.name + "” to confirm", confirmation),
    field("Attachments", attachments),
    remove,
  );
  d.body.append(
    node("p", { class: "detail-title" }, project.cwd),
    node(
      "p",
      { class: "notice" },
      project.archived
        ? "Archived library. Unarchive it before making changes."
        : "Archiving keeps references and attachments and removes this project from active navigation.",
    ),
    actions,
    relink,
    deletion,
    output,
  );
  d.actions.append(button("Close", () => d.el.close()));
  d.el.addEventListener("close", () => controller.abort(), { once: true });
  d.open();
}
