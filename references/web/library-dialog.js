// SPDX-License-Identifier: AGPL-3.0-only
// The existing project catalogue and References lifecycle owner perform all
// archive/relink/deletion work. This module only collects explicit UI choices.
import { node, button, field, dialog } from "./common.js";

export function manageLibrary({ api, project, onRetired = () => {}, onChanged = () => {}, onDeleted = () => {} }) {
  const d = dialog("Project · " + project.name),
    controller = new AbortController(),
    scope = api.project(project.id),
    actions = node("div", { class: "toolbar" }),
    output = node("div"),
    name = node("input", { value: project.name, required: true, maxlength: 200 }),
    folder = node("input", { value: project.bibliographyPath || project.initialBibliographyPath || "", required: true }),
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
      "Delete this project's reference attachment files",
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
    if (Number.isInteger(result.moved)) output.append(node("p", {}, `${result.moved} attachment files moved.`));
    if (result.cleanupPending) output.append(node("p", { class: "notice" }, result.warning || "The new folder is active. Retry to finish removing the old copies."));
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
    d.notice.textContent = "Updating project references…";
    try {
      const result = await scope.request(action, {
        method,
        body,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      d.notice.textContent =
        action === "library"
          ? "Project reference data deleted."
          : action === "relink"
            ? result.cleanupPending ? "Bibliography moved; old-copy cleanup needs a retry." : "Bibliography folder changed."
            : body.archived
              ? "Project archived."
              : "Project unarchived.";
      report(result);
      if (action === "archive") {
        project = { ...project, ...result.project };
        archiveButton.textContent = project.archived ? "Unarchive project" : "Archive project";
      }
      if (action === "library") { await onDeleted(project.id); d.el.close(); return; }
      if (action === "relink" && result.bibliographyPath) {
        project = { ...project, bibliographyPath: result.bibliographyPath };
        folder.value = result.bibliographyPath;
        currentFolder.textContent = result.bibliographyPath;
      }
      if (action !== "library") await onChanged(project);
    } catch (error) {
      if (!controller.signal.aborted) {
        d.notice.textContent = error.message;
        report(error.details || {});
      }
    } finally {
      busy = false;
    }
  }
  const archiveButton = button(project.archived ? "Unarchive project" : "Archive project", () =>
    run("archive", "POST", { archived: !project.archived }));
  actions.append(
    button("Rename project", async () => {
      if (busy || retired || !name.reportValidity()) return;
      busy = true;
      try {
        const result = await api.request("projects/" + encodeURIComponent(project.id), { method: "PATCH", body: { name: name.value }, signal: controller.signal });
        project = result.project || result;
        d.el.querySelector("h2").textContent = "Project · " + project.name;
        confirmation.closest("label").querySelector("span").textContent = "Type “" + project.name + "” to confirm";
        confirmation.value = "";
        d.notice.textContent = "Project renamed.";
        await onChanged(project);
      } catch (error) { if (!controller.signal.aborted) d.notice.textContent = error.message; }
      finally { busy = false; }
    }),
    archiveButton,
  );
  relink.append(
    node("summary", {}, "Bibliography folder"),
    node(
      "p",
      { class: "notice" },
      "Choose the actual folder for this project's saved attachments. Changing it moves the files and updates their paths. Existing files in the destination are kept.",
    ),
    field("Bibliography folder", folder),
    button("Move attachments and change folder", () => {
      if (!folder.reportValidity()) return;
      void run("relink", "POST", {
        bibliographyPath: folder.value,
        expectedBibliographyPath: project.bibliographyPath,
      });
    }),
  );
  const remove = button(
    "Delete reference data",
    () => {
      if (confirmation.value !== project.name) {
        d.notice.textContent =
          "Type the project name exactly to delete its reference data.";
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
    node("summary", {}, "Delete project reference data…"),
    node(
      "p",
      { class: "notice" },
      "Delete this project’s reference database and saved import jobs. This cannot be undone here. Choose whether its attachment files are also deleted. Existing documents and BashKitten workspace history remain.",
    ),
    field("Type “" + project.name + "” to confirm", confirmation),
    field("Attachments", attachments),
    remove,
  );
  const currentFolder = node("p", { class: "detail-title" }, project.bibliographyPath || project.initialBibliographyPath || "");
  d.body.append(
    field("Project name", name),
    currentFolder,
    node(
      "p",
      { class: "notice" },
      project.archived
        ? "Archived project. Unarchive it before making changes."
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
