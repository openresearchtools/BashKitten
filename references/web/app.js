// SPDX-License-Identifier: AGPL-3.0-only
import { createApi } from "./api.js";
import {
  node,
  button,
  field,
  human,
  title,
  creators,
  year,
  query,
  dialog,
  promptFields,
  debounce,
  renderedHTML,
} from "./common.js";
import { VirtualList } from "./virtual-list.js";
import { ReferenceGrid } from "./reference-grid.js";
import { createSidecars } from "./sidecars.js";
import { createReferenceToolbar } from "./toolbar.js";
import { icon, iconButton } from "./icons.js";
import { chooseCitation } from "./shared-citation-dialog.js";
import {
  exportReferences,
  importReferences,
  exportDownloadLink,
} from "./transfer-dialogs.js";
import { manageLibrary } from "./library-dialog.js";
import { uploadFile } from "./uploads.js";
const $ = (selector) => document.querySelector(selector),
  api = createApi(),
  selection = new Map(),
  jobs = new Map(),
  jobListeners = new Map();
let projectId,
  scope,
  schema,
  context,
  projectList,
  projectRecords = [],
  projectReady = false,
  items,
  sort = "title",
  direction = "asc",
  detail = null,
  detailDirty = false,
  view = 0,
  detailController,
  rangeController,
  jobListController,
  anchor = null,
  jobTimer,
  jobsPolling = false,
  appRetired = false,
  selectionPending = false,
  activeSearch = "",
  deleted = false;
const notify = (message) => {
  const target = $("#status");
  if (target) target.textContent = message?.message || message || "";
};
const pane = (name) => {
  if (name === "details") sidecars.show("details");
  else if (name === "libraries") sidecars.show("projects");
  else sidecars.showMain();
};
const grid = new ReferenceGrid({
  root: $("#referenceGrid"), header: $("#itemHeader"),
  selected: item => selection.has(item.key),
  onActivate: activateItem,
  onSelect: (item, event) => {
    if (items) items.focusIndex = event.index;
    return selectItem(item, event);
  },
  onSort: column => {
    cancelSelection();
    direction = sort === column && direction === "asc" ? "desc" : "asc";
    sort = column;
    grid.setSort(sort, direction);
    selection.clear();
    items?.reset({ preserveSelection: false });
    updateSelectionActions();
  },
  onColumns: () => {
    cancelSelection();
    items?.reset({ preservePosition: true });
  },
});
for (const [id, artwork, caption] of [
  ["newItem", "add", "New item"], ["identifiers", "identifier", "Add by identifier"],
  ["importReferences", "import", "Import references"], ["openalex", "literature", "Search literature with OpenAlex"],
  ["refresh", "refresh", "Reload references"], ["jobHistory", "jobs", "Jobs"],
  ["settings", "settings", "References settings"], ["about", "info", "About References"],
  ["toggleProjects", "sidebar-left", "Projects sidecar"], ["toggleDetails", "sidebar-right", "Item details sidecar"],
  ["closeProjects", "close", "Close Projects"], ["closeDetails", "close", "Close item details"],
]) iconButton($("#" + id), artwork, caption);
const sidecars = createSidecars({
  app: $("#app"), header: $(".app-header"), main: $("#referenceMain"),
  projects: $("#projectsPanel"), details: $("#detailsPanel"),
  projectsToggle: $("#toggleProjects"), detailsToggle: $("#toggleDetails"),
  projectsClose: $("#closeProjects"), detailsClose: $("#closeDetails"),
  backdrop: $("#sidecarBackdrop"),
  onLayout: () => { grid.applyWidths(); items?.draw(); },
});
$("#searchIcon").append(icon("search"));
$("#menuIcon").replaceChildren(icon("menu"));
const referenceToolbar = createReferenceToolbar({
  toolbar: $(".reference-toolbar"), button: $("#referenceMenuButton"), menu: $("#referenceMenu"),
});
$("#selectNone").onclick = () => {
  cancelSelection();
  selection.clear();
  anchor = null;
  syncSelection();
  notify("No items selected.");
};
$("#selectAll").onclick = async () => {
  if (!scope || !items || !projectReady) return;
  cancelSelection();
  const targetScope = scope, list = items, generation = list.generation,
    configuration = itemQuery(), controller = (rangeController = new AbortController()),
    signal = AbortSignal.any([controller.signal, list.controller.signal]), chosen = new Map();
  const current = () => !signal.aborted && scope === targetScope && items === list &&
    generation === list.generation && rangeController === controller;
  let cursor, start = 0, version = list.version;
  selectionPending = true;
  updateSelectionActions();
  try {
    do {
      signal.throwIfAborted();
      const page = await targetScope.request("items?" + query({ ...configuration, start, limit: 200, cursor }), { signal });
      if (!current()) return;
      version ??= page.version;
      if ((version !== undefined && page.version !== version) ||
          (list.version !== null && page.version !== list.version))
        throw Error("The library changed. Reload references before selecting all.");
      for (const item of page.items) chosen.set(item.key, selectedIdentity(item));
      notify("Selecting " + chosen.size + " references…");
      start += page.items.length;
      cursor = page.next;
    } while (cursor);
    if (!current()) return;
    selection.clear();
    for (const [key, identity] of chosen) selection.set(key, identity);
    anchor = null;
    syncSelection();
    notify(selection.size + " selected");
  } catch (error) {
    if (current()) notify(error);
  } finally {
    if (rangeController === controller) {
      rangeController = null;
      selectionPending = false;
      updateSelectionActions();
    }
  }
};
$("#columns").onclick = () => grid.chooseColumns();
// The pinned native schema supplies every type-specific field. These work
// identities are the narrow References additions stored by the shared backend.
const workIdentifierLabels = {
  DOI: "DOI",
  PMID: "PMID",
  PMCID: "PMCID",
  OpenAlex: "OpenAlex work ID",
  arXiv: "arXiv ID",
};
const label = (kind, value) =>
  schema?.locales?.["en-US"]?.[kind]?.[value] || human(value);
function selectedIdentity(item) {
  return { key: item.key, id: item.id, version: item.version };
}
function activateItem(item) {
  void openDetail(item.key);
  pane("details");
}
function updateSelectionActions() {
  const all = $("#selectAll"), none = $("#selectNone"), actions = $("#actions");
  if (!all || !none || !actions) return;
  const available = !!scope && projectReady;
  all.disabled = !available || selectionPending;
  all.setAttribute("aria-busy", String(selectionPending));
  none.disabled = !available || (!selection.size && !selectionPending);
  actions.disabled = !available || selectionPending || !selection.size;
  actions.options[0].textContent = selection.size > 1 ? selection.size + " selected items…"
    : selection.size === 1 ? "Selected item…" : "Selected items…";
}
function syncSelection() {
  items?.setSelection(selection.keys());
  updateSelectionActions();
}
function cancelSelection() {
  rangeController?.abort();
  rangeController = null;
  selectionPending = false;
  updateSelectionActions();
}
async function boot() {
  context = await api.request("context");
  projectRecords = await api.request("projects?includeArchived=true");
  const list = projectRecords;
  const remembered = history.state?.referencesProject;
  const selected = list.find((project) => remembered?.backendId === context.backendId && project.id === remembered.projectId)
    || list.find((project) => !project.archived && project.id === (context.referenceProjectId || context.projectId || context.defaultProjectId))
    || list.find((project) => !project.archived);
  if (selected?.archived)
    $("#showArchived").checked = true;
  renderProjectList();
  if (!selected) {
    notify("Create a References project or show archived projects to continue.");
    return;
  }
  await selectProject(selected.id);
  if (context.unmappedDatabases?.length)
    notify(context.unmappedDatabases.length + " existing References database folder(s) were preserved but need identity reconciliation before they can be listed.");
}
async function reloadProjects() {
  projectRecords = await api.request("projects?includeArchived=true");
  renderProjectList();
}
$("#newProject").onclick = async () => {
  if (detailDirty && !confirm("Discard unsaved item changes?")) return;
  const name = node("input", { required: true, maxlength: 200, autocomplete: "off" });
  const folder = node("input", { placeholder: "Use the managed References folder" });
  if (!(await promptFields("New References project", [
    field("Name", name),
    field("Parent folder for Bibliography (optional absolute path)", folder),
  ], { submit: "Create project" }))) return;
  try {
    const result = await api.request("projects", { method: "POST", body: { name: name.value, ...(folder.value.trim() ? { cwd: folder.value.trim() } : {}) } });
    await reloadProjects();
    await selectProject((result.project || result).id);
  } catch (error) { notify(error); }
};
function renderProjectList() {
  const list = projectRecords.filter(
    (project) => !project.archived || $("#showArchived").checked,
  );
  projectList?.destroy();
  $("#projects").replaceChildren();
  const nameCounts = new Map();
  for (const project of list)
    nameCounts.set(project.name, (nameCounts.get(project.name) || 0) + 1);
  projectList = new VirtualList({
    element: $("#projects"),
    label: "Projects",
    rowHeight: 52,
    total: list.length,
    key: (project) => project.id,
    load: async ({ start, limit }) => ({
      items: list.slice(start, start + limit),
      total: list.length,
    }),
    render: (project) => node("div", { class: "project-row" },
      node(
        "span",
        { class: "source-label" },
        node("strong", {}, project.name),
        node(
          "small",
          {},
          project.backendName || context.backendName || "",
          project.isDefault ? " · Default" : "",
          project.archived ? " · Archived" : "",
          nameCounts.get(project.name) > 1 && project.cwd
            ? " · " + project.cwd
            : "",
        ),
      ),
      button("⚙", (event) => { event.stopPropagation(); openProjectSettings(project); }, { class: "project-settings", "aria-label": "Settings for " + project.name, title: "Project settings" })),
    onSelect: (project) => selectProject(project.id),
  });
  if (projectId) projectList.setSelection([projectId]);
}
$("#showArchived").onchange = renderProjectList;
function currentProject() {
  return projectRecords.find((project) => project.id === projectId);
}
function updateProjectActions() {
  const available = !!scope && projectReady;
  const editable = available && !currentProject()?.archived;
  for (const id of [
    "newItem",
    "identifiers",
    "importReferences",
    "openalex",
  ]) {
    $("#" + id).disabled = !editable;
  }
  for (const id of [
    "savedSearches",
    "settings",
    "cite",
    "jobHistory",
    "exportReferences",
    "columns",
  ]) {
    $("#" + id).disabled = !available;
  }
  for (const option of $("#actions").options)
    option.disabled = !!option.value && option.value !== "export" && !editable;
  updateSelectionActions();
}
function clearProjectSelection() {
  ++view;
  detailController?.abort(); cancelSelection(); jobListController?.abort();
  items?.destroy(); items = null; scope = null; projectId = null; projectReady = false;
  detailDirty = false; detail = null; selection.clear(); activeSearch = "";
  $("#search").value = "";
  $("#items").replaceChildren(); $("#details").replaceChildren(); $("#jobs").replaceChildren();
  history.replaceState({ ...history.state, referencesProject: null }, "");
}
let projectSettingsController;
async function openProjectSettings(project) {
  if (!project) return;
  if (detailDirty && !confirm("Discard unsaved item changes?")) return;
  projectSettingsController?.abort();
  const controller = projectSettingsController = new AbortController();
  try {
    project = await api.request("projects/" + encodeURIComponent(project.id), { signal: controller.signal });
    if (controller.signal.aborted) return;
  } catch (error) { if (!controller.signal.aborted) notify(error); return; }
  manageLibrary({
    api,
    project,
    onChanged: async changed => {
      if (changed?.id === projectId && changed.archived) clearProjectSelection();
      await reloadProjects();
      const next = projectRecords.find(item => !item.archived);
      if (!scope && next) await selectProject(next.id);
      else { updateProjectActions(); if (!scope) notify("Create a References project or show archived projects to continue."); }
    },
    onDeleted: async id => {
      for (const [key, job] of jobs) if (job.projectId === id) jobs.delete(key);
      if (projectId === id) clearProjectSelection();
      await reloadProjects();
      const next = projectRecords.find(item => !item.archived);
      if (!scope && next) await selectProject(next.id);
      else { updateProjectActions(); if (!scope) notify("Create a References project or show archived projects to continue."); }
    },
    onRetired: () => {
      appRetired = true;
      referenceToolbar.destroy();
      sidecars.destroy();
      detailDirty = false;
      ++view;
      detailController?.abort();
      cancelSelection();
      jobListController?.abort();
      clearTimeout(jobTimer);
      items?.destroy();
      projectList?.destroy();
      scope = null;
      $("#app").replaceChildren(
        node(
          "p",
          { class: "empty-details" },
          "This project's references need to be reopened. Use the dialog, or open References again from Taskarian.",
        ),
      );
    },
  });
};
$("#importReferences").onclick = () => {
  if (!scope) return;
  const id = projectId;
  importReferences({
    scope,
    onJob: (job) => trackJob(id, job),
  });
};
$("#exportReferences").onclick = () => {
  if (!scope || !projectReady) return;
  const id = projectId,
    version = items.version ?? undefined,
    order = { sort, direction, version },
    selections = [],
    projectName = currentProject()?.name || "this project";
  if (selection.size)
    selections.push({
      label: selection.size + " selected references",
      selection: { scope: "selected", keys: [...selection.keys()], version },
    });
  if (activeSearch || deleted)
    selections.push({
      label:
        (deleted
          ? "Deleted items"
          : "Search results") +
        (activeSearch ? " · “" + activeSearch + "”" : ""),
      selection: {
        scope: "search",
        q: activeSearch,
        deleted: deleted ? 1 : 0,
        ...order,
      },
    });
  selections.push({
    label: "All project references · " + projectName + " (excluding deleted items)",
    selection: { scope: "library", deleted: 0, ...order },
  });
  void exportReferences({
    scope,
    selections,
    onJob: (job) => trackJob(id, job),
  });
};
async function selectProject(id) {
  if (detailDirty && !confirm("Discard unsaved item changes?")) {
    projectList.setSelection([projectId]);
    return;
  }
  const generation = ++view;
  detailController?.abort();
  cancelSelection();
  jobListController?.abort();
  items?.destroy();
  $("#items").replaceChildren();
  selection.clear();
  deleted = false;
  detail = null;
  detailDirty = false;
  projectId = id;
  projectReady = false;
  projectList.setSelection([id]);
  scope = api.project(id);
  activeSearch = "";
  $("#search").value = "";
  updateProjectActions();
  notify("Loading project references…");
  $("#details").replaceChildren(
    node(
      "p",
      { class: "empty-details" },
      "Select an item to view and edit its details.",
    ),
  );
  try {
    const loadedSchema = await scope.request("schema");
    if (generation !== view) return;
    schema = loadedSchema;
    grid.typeLabel = type => label("itemTypes", type);
    grid.configure(schema);
    grid.setSort(sort, direction);
    items = new VirtualList({
      element: $("#items"),
      label: "Project references",
      load: (args) => loadPage(args),
      render: (item, index) => grid.render(item, index),
      header: grid.header,
      role: "grid",
      rowRole: "row",
      updateRow: (row, item) => {
        const checkbox = row.querySelector(".row-checkbox");
        if (checkbox) checkbox.checked = selection.has(item.key);
      },
      onSelect: selectItem,
      onActivate: activateItem,
      onStatus: (text, error) => {
        updateSelectionActions();
        if (error) notify(error);
        else
          notify(
            text ||
              (selection.size
                ? selection.size + " selected"
                : "Project ready."),
          );
      },
    });
    notify("Project ready.");
    projectReady = true;
    history.replaceState({ ...history.state, referencesProject: { backendId: context.backendId, projectId: id } }, "");
    updateProjectActions();
    sidecars.showMain();
    void restoreJobs(id, generation);
    pollJobs();
  } catch (error) {
    if (generation === view) notify(error);
  }
}
function itemQuery() {
  return { q: activeSearch, sort, direction, deleted: deleted ? 1 : undefined,
    fields: grid.fields().join(",") };
}
function loadPage({ start, limit, cursor, signal }) {
  return scope.request(
    "items?" +
      query({
        ...itemQuery(),
        start,
        limit,
        cursor,
      }),
    { signal },
  );
}
async function selectItem(item, event) {
  cancelSelection();
  if (
    detailDirty &&
    detail?.key !== item.key &&
    !confirm("Discard unsaved item changes?")
  )
    return;
  if (detailDirty && detail?.key !== item.key) detailDirty = false;
  if (
    event.range &&
    anchor?.view === view &&
    anchor.generation === items.generation
  ) {
    const from = Math.min(anchor.index, event.index),
      to = Math.max(anchor.index, event.index),
      generation = view, list = items, listGeneration = list.generation,
      controller = (rangeController = new AbortController()), chosen = new Map(),
      signal = AbortSignal.any([controller.signal, list.controller.signal]);
    const current = () => !signal.aborted && generation === view && items === list &&
      listGeneration === list.generation && rangeController === controller;
    selectionPending = true;
    updateSelectionActions();
    try {
      for await (const page of list.range(from, to, { signal })) {
        if (!current()) return;
        for (const record of page)
          chosen.set(record.key, selectedIdentity(record));
      }
      if (!current()) return;
      selection.clear();
      for (const [key, identity] of chosen) selection.set(key, identity);
      syncSelection();
      notify(selection.size + " selected");
    } catch (error) {
      if (current()) notify(error);
      return;
    } finally {
      if (rangeController === controller) {
        rangeController = null;
        selectionPending = false;
        updateSelectionActions();
      }
    }
  } else {
    anchor = { index: event.index, view, generation: items.generation };
    if (!event.toggle) selection.clear();
    if (event.toggle && selection.has(item.key)) selection.delete(item.key);
    else selection.set(item.key, selectedIdentity(item));
    syncSelection();
    notify(selection.size + " selected");
  }
  if (selection.has(item.key) && !detailDirty) await openDetail(item.key);
}
const searchChanged = debounce(() => {
  activeSearch = $("#search").value;
  cancelSelection();
  selection.clear();
  items?.reset({ preserveSelection: false });
  updateSelectionActions();
});
$("#search").addEventListener("input", () => {
  items?.controller.abort();
  cancelSelection();
  searchChanged();
});
$("#refresh").onclick = () => {
  cancelSelection();
  items?.reset({ preservePosition: true });
  if (detail && !detailDirty) void openDetail(detail.key);
};
async function openDetail(key, discard = false) {
  if (detailDirty && !discard && !confirm("Discard unsaved item changes?"))
    return;
  const generation = view,
    controller = new AbortController(),
    targetScope = scope;
  detailController?.abort();
  detailController = controller;
  try {
    const item = await targetScope.request("items/" + encodeURIComponent(key), {
      signal: controller.signal,
    });
    if (generation !== view || controller.signal.aborted) return;
    detail = item;
    detailDirty = false;
    renderDetail(item, targetScope);
  } catch (error) {
    if (!controller.signal.aborted) notify(error);
  }
}
function renderDetail(item, targetScope) {
  const root = $("#details");
  root.replaceChildren();
  const edited = structuredClone(item.data),
    form = node("form", { class: "detail-form" }),
    heading = node("h2", { class: "detail-title" }, title(item)),
    notice = node("p", { class: "notice", role: "status" });
  root.append(heading, notice, form);
  const archived = !!currentProject()?.archived;
  const controller = detailController;
  let activeEditKey = null;
  async function saveField(data) {
    if (archived || detail !== item || !root.contains(form)) return;
    const controls = [...form.querySelectorAll("input,select,textarea,button")].map(control => [control, control.disabled]);
    for (const [control] of controls) control.disabled = true;
    try {
      const result = await targetScope.request("items/" + encodeURIComponent(item.key), {
        method: "PATCH", body: { version: item.version, data }, signal: controller.signal,
      });
      if (scope !== targetScope || detail !== item || !root.contains(form)) return;
      detailDirty = false;
      detail = result;
      if (selection.has(result.key)) selection.set(result.key, selectedIdentity(result));
      renderDetail(result, targetScope);
      items?.reset({ preservePosition: true });
      notify("Field saved.");
    } catch (error) {
      if (!controller.signal.aborted && root.contains(form)) notice.textContent = error.status === 412
        ? "This item changed elsewhere. Your edit is kept here; reload the item before saving."
        : error.message;
    } finally {
      if (root.contains(form)) for (const [control, disabled] of controls) control.disabled = disabled;
    }
  }
  function guardField(row, controls, values, caption, key = caption) {
    const state = controls.filter(control => !control.hasAttribute('data-read-action')).map(control => ({ control, disabled: control.disabled, readOnly: control.readOnly }));
    const actions = node("span", { class: "field-edit-actions" });
    const edit = iconButton(button("", async event => {
      event.preventDefault();
      if (activeEditKey === key) { await saveField(values()); return; }
      if (activeEditKey !== null || detailDirty) {
        notice.textContent = "Save or cancel your current edit first.";
        return;
      }
      activeEditKey = key;
      apply();
      controls.find(control => !control.disabled && control.matches('input,select,textarea'))?.focus();
    }, { disabled: archived }), 'edit', 'Edit ' + caption);
    const cancel = iconButton(button("", () => void openDetail(item.key, true)), 'close', 'Cancel ' + caption + ' edit');
    actions.append(edit, cancel); row.append(actions); row.classList.add('editable-field');
    function apply() {
      const editing = activeEditKey === key;
      row.classList.toggle('field-is-editing', editing);
      for (const { control, disabled, readOnly } of state) {
        if (control.matches('input:not([type="checkbox"]),textarea')) control.readOnly = archived || !editing || readOnly;
        else control.disabled = archived || !editing || disabled;
        control.setAttribute('aria-readonly', String(!editing));
      }
      cancel.hidden = !editing;
      edit.type = editing ? "submit" : "button";
      iconButton(edit, editing ? 'save' : 'edit', (editing ? 'Save ' : 'Edit ') + caption);
    }
    apply();
  }
  form.addEventListener('click', event => {
    const control = event.target.closest('button');
    if (activeEditKey === null || !control || control.closest('.field-is-editing,.detail-actions') || control.hasAttribute('data-read-action')) return;
    event.preventDefault(); event.stopPropagation();
    notice.textContent = "Save or cancel your current edit first.";
  }, true);
  function readOnlyControls(container) {
    if (!archived) return;
    for (const control of container.querySelectorAll(
      "input,select,textarea,button",
    )) {
      if (control.hasAttribute("data-read-action")) continue;
      if (control.matches('textarea,input:not([type="checkbox"])'))
        control.readOnly = true;
      else control.disabled = true;
    }
  }
  if (archived)
    notice.textContent = "Archived library · unarchive it to edit metadata.";
  else if (Object.values(edited.provenance?.identifierAliases || {}).some(values => values?.length))
    notice.textContent = "This item has alternative identifiers. Review or edit them in Identifiers.";
  if (item.data.itemType === "attachment" && item.data.linkMode !== "embedded_image") {
    const parentSection = node("details", { open: true }),
      parentStatus = node("p", { class: "notice", role: "status" });
    const controller = detailController;
    parentSection.append(node("summary", {}, "Parent item"), parentStatus);
    parentStatus.textContent = item.data.parentItem
      ? "Parent item · " + item.data.parentItem
      : "Standalone attachment";
    if (item.data.parentItem)
      void targetScope.request("items/" + encodeURIComponent(item.data.parentItem), {
        signal: controller.signal,
      }).then(parent => {
        if (detail === item && root.contains(parentSection))
          parentStatus.textContent = "Parent item · " + title(parent);
      }).catch(error => {
        if (!controller.signal.aborted && detail === item && root.contains(parentSection))
          parentStatus.textContent = error.message;
      });
    const updateParent = async (parent) => {
      if (scope !== targetScope || detail !== item || controller.signal.aborted) return;
      if (detailDirty) {
        notice.textContent = "Save or reload metadata changes before changing the parent.";
        return;
      }
      const controls = [...form.querySelectorAll("input,select,textarea,button")]
        .map(control => [control, control.disabled]);
      for (const [control] of controls) control.disabled = true;
      try {
        const data = { parentItem: parent?.key || null };
        const result = await targetScope.request("items/" + encodeURIComponent(item.key), {
          method: "PATCH",
          body: { version: item.version, data },
          signal: controller.signal,
        });
        if (scope !== targetScope || detail !== item || !root.contains(form)) return;
        if (selection.has(result.key)) selection.set(result.key, selectedIdentity(result));
        detail = result;
        renderDetail(result, targetScope);
        items.reset({ preservePosition: true });
        notify(parent ? "Attachment parent updated." : "Attachment is now standalone.");
      } catch (error) {
        if (!controller.signal.aborted && detail === item && root.contains(form))
          notice.textContent = error.status === 412
            ? "This attachment changed elsewhere. Reload it before changing the parent."
            : error.message;
      } finally {
        for (const [control, disabled] of controls) control.disabled = disabled;
      }
    };
    parentSection.append(node("div", { class: "toolbar" },
      button(item.data.parentItem ? "Change parent" : "Attach to item", async () => {
        if (detailDirty) {
          notice.textContent = "Save or reload metadata changes before changing the parent.";
          return;
        }
        try {
          const parent = await chooseLibraryItem(targetScope, {
            heading: "Choose parent item",
            isSelectable: candidate => candidate.key !== item.key &&
              !["attachment", "note", "annotation"].includes(candidate.data.itemType),
            signal: controller.signal,
          });
          if (parent) await updateParent(parent);
        } catch (error) {
          if (!controller.signal.aborted && detail === item && root.contains(form))
            notice.textContent = error.message;
        }
      }),
      button("Leave standalone", () => updateParent(null), { disabled: !item.data.parentItem }),
    ));
    form.append(parentSection);
  }
  const type = node("select");
  for (const info of schema.itemTypes)
    type.add(new Option(label("itemTypes", info.itemType), info.itemType));
  type.value = edited.itemType;
  const typeField = field("Item type", type);
  typeField.classList.add("metadata-field");
  form.append(typeField);
  guardField(typeField, [type], () => ({ itemType: edited.itemType, creators: edited.creators }), "item type");
  const titleFields = node("div", { class: "metadata-fields" }),
    fields = node("div", { class: "metadata-fields" }),
    creatorSection = node("details", { open: true }),
    creatorRows = node("div"),
    creatorActions = node("div", { class: "toolbar" }),
    creatorTitle = node("summary", {}, "Creators");
  creatorSection.append(creatorTitle, creatorRows, creatorActions);
  form.append(titleFields, creatorSection, fields);
  let creatorStart = 0;
  const removedCreators = new Set();
  edited.creators ||= [];
  function renderCreators() {
    creatorRows.replaceChildren();
    const types =
      schema.itemTypes.find((x) => x.itemType === edited.itemType)
        ?.creatorTypes || [];
    creatorTitle.textContent = "Creators · " + edited.creators.length;
    for (
      let i = creatorStart;
      i < Math.min(creatorStart + 20, edited.creators.length);
      i++
    ) {
      const creator = edited.creators[i],
        role = node("select", { "aria-label": "Creator role" });
      for (const r of types)
        role.add(
          new Option(label("creatorTypes", r.creatorType), r.creatorType),
        );
      if (!types.some((r) => r.creatorType === creator.creatorType))
        role.add(new Option(human(creator.creatorType), creator.creatorType));
      role.value = creator.creatorType;
      role.onchange = () => {
        creator.creatorType = role.value;
        detailDirty = true;
      };
      const singleField = Object.hasOwn(creator, "name");
      const single = node("input", {
          type: "checkbox",
          checked: singleField,
          "aria-label": "Single-field name",
        }),
        first = node("input", {
          value: singleField ? creator.name : creator.firstName || "",
          placeholder: singleField ? "Name" : "First name",
          "aria-label": singleField ? "Name" : "First name",
        }),
        last = node("input", {
          value: creator.lastName || "",
          placeholder: "Last name",
          "aria-label": "Last name",
          disabled: singleField,
        });
      first.oninput = () => {
        if (single.checked) creator.name = first.value;
        else creator.firstName = first.value;
        detailDirty = true;
      };
      last.oninput = () => {
        creator.lastName = last.value;
        detailDirty = true;
      };
      single.onchange = () => {
        if (single.checked) {
          creator.name = [creator.firstName, creator.lastName]
            .filter(Boolean)
            .join(" ");
          delete creator.firstName;
          delete creator.lastName;
        } else {
          creator.lastName = creator.name || "";
          creator.firstName = "";
          delete creator.name;
        }
        detailDirty = true;
        renderCreators();
      };
      const move = (delta) => {
        if (i + delta < 0 || i + delta >= edited.creators.length) return;
        activeEditKey = 'creator:' + (i + delta);
        creatorStart = Math.floor((i + delta) / 20) * 20;
        [edited.creators[i], edited.creators[i + delta]] = [
          edited.creators[i + delta],
          edited.creators[i],
        ];
        detailDirty = true;
        renderCreators();
      };
      creatorRows.append(
        node(
          "div",
          { class: "creator-row" },
          role,
          first,
          last,
          node(
            "div",
            { class: "creator-actions" },
            single,
            button("↑", () => move(-1), { "aria-label": "Move creator up" }),
            button("↓", () => move(1), { "aria-label": "Move creator down" }),
            button(
              "×",
              () => {
                removedCreators.add(creator);
                detailDirty = true;
                notice.textContent = "Save this creator row to remove it, or cancel the edit.";
                renderCreators();
              },
              { "aria-label": "Remove creator" },
            ),
          ),
        ),
      );
      const identifiers = node("details", { class: "creator-identifiers" });
      identifiers.append(node("summary", {}, "Creator identifiers"));
      for (const [name, caption] of [["ORCID", "ORCID"], ["OpenAlex", "OpenAlex author ID"]]) {
        const input = node("input", { value: creator[name] || "", "aria-label": caption });
        input.oninput = () => { creator[name] = input.value; detailDirty = true; };
        identifiers.append(field(caption, input));
      }
      creatorRows.lastElementChild.append(identifiers);
      const creatorRow = creatorRows.lastElementChild;
      creatorRow.classList.toggle('pending-removal', removedCreators.has(creator));
      guardField(creatorRow, [...creatorRow.querySelectorAll('input,select,button')], () => ({ creators: edited.creators.filter(value => !removedCreators.has(value)) }), 'creator ' + (i + 1), 'creator:' + i);
    }
    creatorActions.replaceChildren(
      button("Add creator", () => {
        if (activeEditKey !== null || detailDirty) { notice.textContent = "Save or cancel your current edit first."; return; }
        edited.creators.push({
          creatorType: types[0]?.creatorType || "author",
          firstName: "",
          lastName: "",
        });
        creatorStart = Math.floor((edited.creators.length - 1) / 20) * 20;
        activeEditKey = 'creator:' + (edited.creators.length - 1);
        detailDirty = true;
        renderCreators();
      }),
      button(
        "Previous",
        () => {
          if (activeEditKey?.startsWith('creator:')) { notice.textContent = "Save or cancel this creator edit first."; return; }
          creatorStart = Math.max(0, creatorStart - 20);
          renderCreators();
        },
        { disabled: creatorStart === 0, "data-read-action": "" },
      ),
      button(
        "Next",
        () => {
          if (activeEditKey?.startsWith('creator:')) { notice.textContent = "Save or cancel this creator edit first."; return; }
          creatorStart += 20;
          renderCreators();
        },
        {
          disabled: creatorStart + 20 >= edited.creators.length,
          "data-read-action": "",
        },
      ),
    );
    readOnlyControls(creatorRows);
    readOnlyControls(creatorActions);
  }
  function renderFields() {
    titleFields.replaceChildren();
    fields.replaceChildren();
    const definitions =
      schema.itemTypes.find((x) => x.itemType === edited.itemType)?.fields ||
      [];
    for (const { field: name } of definitions) {
      if (name === "abstractNote" || name in workIdentifierLabels) continue;
      const input = node(["extra", "title"].includes(name) ? "textarea" : "input", {
        value: edited[name] ?? "",
        name,
        ...(name === "title" ? { rows: 2 } : {}),
      });
      input.oninput = () => {
        edited[name] = input.value;
        detailDirty = true;
      };
      const row = field(label("fields", name), input);
      row.classList.add("metadata-field");
      guardField(row, [input], () => ({ [name]: edited[name] }), label("fields", name), 'field:' + name);
      (name === "title" ? titleFields : fields).append(row);
    }
    if (!["attachment", "note", "annotation"].includes(edited.itemType)) {
      const identifiers = node("details", { open: true, class: "work-identifiers" }, node("summary", {}, "Identifiers"));
      const aliases = node("details", { class: "identifier-aliases" }, node("summary", {}, "Alternative identifier values"));
      if (Object.values(edited.provenance?.identifierAliases || {}).some(values => values?.length)) aliases.open = true;
      const aliasInputs = new Map();
      for (const [name, caption] of Object.entries(workIdentifierLabels)) {
        const input = node("input", { name, value: edited[name] || "", spellcheck: false, autocomplete: "off", ...(name === "OpenAlex" ? { placeholder: "W…" } : {}) });
        input.oninput = () => {
          edited[name] = input.value;
          if (edited.provenance?.identifierAliases) delete edited.provenance.identifierAliases[name];
          if (aliasInputs.has(name)) {
            aliasInputs.get(name).value = "";
            aliasInputs.get(name).disabled = true;
          }
          detailDirty = true;
        };
        const row = field(caption, input);
        row.classList.add("metadata-field");
        identifiers.append(row);
        guardField(row, [input], () => ({ [name]: edited[name], provenance: edited.provenance }), caption, 'identifier:' + name);
        const alternate = node("textarea", { name: "identifierAliases." + name, rows: 2, value: (edited.provenance?.identifierAliases?.[name] || []).join("\n"), spellcheck: false });
        aliasInputs.set(name, alternate);
        alternate.oninput = () => {
          edited.provenance ||= {};
          edited.provenance.identifierAliases ||= {};
          edited.provenance.identifierAliases[name] = alternate.value.split("\n").map(value => value.trim()).filter(Boolean);
          detailDirty = true;
        };
        const alternateRow = field(caption + " · one per line", alternate);
        alternateRow.classList.add("metadata-field");
        aliases.append(alternateRow);
        guardField(alternateRow, [alternate], () => ({ provenance: edited.provenance }), caption + ' alternatives', 'alias:' + name);
      }
      identifiers.append(node("p", { class: "notice" }, "Changing or clearing a primary identifier replaces all active values of that kind. Save it before adding verified alternatives."), aliases);
      fields.append(identifiers);
    }
    renderCreators();
  }
  type.onchange = () => {
    edited.itemType = type.value;
    detailDirty = true;
    renderFields();
  };
  renderFields();
  const abstract = node("textarea", {
      value: edited.abstractNote || "",
      rows: 6,
    }),
    tags = node("textarea", {
      value: (edited.tags || [])
        .map((t) => (typeof t === "string" ? t : t.tag))
        .join("\n"),
      rows: 3,
    });
  for (const [heading, input] of [
    ["Abstract", abstract],
    ["Tags · one per line", tags],
  ]) {
    const section = node("details", heading === "Abstract" ? { open: true } : {}, node("summary", {}, heading));
    const row = node('div', { class: 'metadata-field section-field' }, input);
    section.append(row); form.append(section);
    guardField(row, [input], () => input === abstract ? { abstractNote: abstract.value } : {
      tags: tags.value.split('\n').map(tag => tag.trim()).filter(Boolean).map(tag => item.data.tags?.find(existing => existing.tag === tag) || { tag }),
    }, heading);
  }
  abstract.oninput = () => {
    edited.abstractNote = abstract.value;
    detailDirty = true;
  };
  tags.oninput = () => (detailDirty = true);
  const related = node("details", {}, node("summary", {}, "Related items")),
    relatedRows = node("div");
  edited.relations ||= {};
  let relatedPage = 0;
  const relationNames = new Map();
  function renderRelated() {
    const values = [].concat(edited.relations["dc:relation"] || []);
    relatedRows.replaceChildren();
    for (const id of values.slice(relatedPage * 10, relatedPage * 10 + 10)) {
      relatedRows.append(
        node(
          "div",
          { class: "attachment-row" },
          node("span", {}, relationNames.get(id) || id),
          button("Remove", () => saveField({ relations: { ...edited.relations,
            "dc:relation": values.filter(value => value !== id),
          } })),
        ),
      );
    }
    relatedRows.append(
      node(
        "div",
        { class: "toolbar" },
        button(
          "Previous",
          () => {
            --relatedPage;
            renderRelated();
          },
          { disabled: relatedPage === 0, "data-read-action": "" },
        ),
        button(
          "Next",
          () => {
            ++relatedPage;
            renderRelated();
          },
          {
            disabled: (relatedPage + 1) * 10 >= values.length,
            "data-read-action": "",
          },
        ),
      ),
    );
    readOnlyControls(relatedRows);
  }
  related.addEventListener("toggle", async () => {
    if (!related.open) return;
    const prefix = item.id.slice(0, item.id.lastIndexOf("/") + 1),
      signal = detailController.signal;
    try {
      for (const id of []
        .concat(edited.relations["dc:relation"] || [])
        .slice(relatedPage * 10, relatedPage * 10 + 10)) {
        if (!id.startsWith(prefix) || relationNames.has(id)) continue;
        const target = await targetScope.request(
          "items/" + encodeURIComponent(id.slice(prefix.length)),
          { signal },
        );
        if (signal.aborted || !root.contains(form)) return;
        relationNames.set(id, title(target));
      }
      renderRelated();
    } catch (error) {
      if (!signal.aborted) notice.textContent = error.message;
    }
  });
  related.append(
    relatedRows,
    button("Add related item", async () => {
      const selected = await chooseLibraryItem(targetScope, { signal: controller.signal });
      if (!selected || selected.id === item.id) return;
      const values = new Set([].concat(edited.relations["dc:relation"] || []));
      values.add(selected.id);
      await saveField({ relations: { ...edited.relations, "dc:relation": [...values] } });
    }),
  );
  renderRelated();
  form.append(related);
  if (edited.itemType === "note") {
    const note = node("textarea", { value: edited.note || "", rows: 8 });
    note.oninput = () => {
      edited.note = note.value;
      detailDirty = true;
    };
    const row = field("Note", note);
    row.classList.add('metadata-field'); form.append(row);
    guardField(row, [note], () => ({ note: note.value }), 'note');
  }
  const itemActions =
    node(
      "div",
      { class: "toolbar detail-actions" },
      button(
        "Reload item",
        () => {
          if (!detailDirty || confirm("Discard unsaved item changes?"))
            void openDetail(item.key, true);
        },
        { "data-read-action": "" },
      ),
    );
  if (!["attachment", "note", "annotation"].includes(item.data.itemType))
    itemActions.append(button("Enrich metadata", async (event) => {
      if (detailDirty) {
        notice.textContent = "Save or reload your edits before enriching metadata.";
        return;
      }
      const enrich = event.currentTarget;
      const targetProject = projectId, controller = detailController;
      enrich.disabled = true;
      try {
        const job = await targetScope.request("items/enrich", {
          method: "POST",
          body: { keys: [item.key], requestId: crypto.randomUUID() },
          signal: controller.signal,
        });
        trackJob(targetProject, job);
        notice.textContent = "Metadata enrichment queued. Progress and cancellation are available in Jobs.";
      } catch (error) { if (error.name !== "AbortError") notice.textContent = error.message; }
      finally { enrich.disabled = archived; }
    }));
  for (const control of itemActions.querySelectorAll('button')) {
    const name = control.textContent.trim();
    iconButton(control, name === 'Reload item' ? 'refresh' : 'identifier', name);
  }
  form.prepend(itemActions);
  form.onsubmit = (event) => {
    event.preventDefault();
    form.querySelector(".field-is-editing .field-edit-actions > button")?.click();
  };
  const attachments = node("details", { open: true }),
    children = node("div");
  attachments.append(
    node("summary", {}, "Attachments and notes"),
    children,
    node('div', { class: 'toolbar item-child-actions' },
      iconButton(button('', () => uploadDialog(item.key, targetScope), { disabled: archived }), 'attachment', 'Add attachment to this item'),
      iconButton(button('', () => void addNote(item.key), { disabled: archived }), 'note', 'Add note to this item'),
    ),
  );
  root.append(attachments);
  readOnlyControls(form);
  void loadChildren(item, targetScope, children);
}
async function loadChildren(item, targetScope, target, cursor, history = []) {
  try {
    const result = await targetScope.request(
      "items/" + item.key + "/children?" + query({ limit: 80, cursor }),
      { signal: detailController.signal },
    );
    if (detail?.key !== item.key || scope !== targetScope) return;
    target.replaceChildren();
    const rows =
      item.data.itemType === "attachment"
        ? [item, ...result.items]
        : result.items;
    for (const child of rows) {
      const row = node("div", { class: "attachment-row" });
      if (child.data.itemType === "attachment") {
        const url =
          child.data.linkMode === "linked_url"
            ? child.data.url
            : targetScope.url("items/" + child.key + "/file").href;
        if (/^https?:\/\//.test(url))
          row.append(
            node(
              "a",
              { href: url, target: "_blank", rel: "noopener noreferrer" },
              title(child),
            ),
          );
      } else row.append(button(title(child), () => openDetail(child.key)));
      row.append(button("Edit", () => openDetail(child.key)));
      row.append(button("Move to deleted items", async () => {
        if (detailDirty) {
          notify("Save or reload metadata changes before deleting an attachment or note.");
          return;
        }
        if (!confirm("Move “" + title(child) + "” to deleted items?")) return;
        try {
          await targetScope.request("items/" + encodeURIComponent(child.key), {
            method: "DELETE", body: { version: child.version }, signal: detailController.signal,
          });
          if (detail?.key !== item.key || scope !== targetScope) return;
          selection.delete(child.key);
          syncSelection();
          items.reset({ preservePosition: true });
          if (child.key === item.key) { detail = null; $("#details").replaceChildren(); }
          else await loadChildren(item, targetScope, target, cursor, history);
          notify("Moved to deleted items.");
        } catch (error) { if (error.name !== "AbortError") notify(error); }
      }, { disabled: !!currentProject()?.archived, class: "attachment-delete" }));
      target.append(row);
    }
    if (!rows.length)
      target.append(node("p", { class: "notice" }, "No attachments or notes."));
    if (history.length)
      target.append(
        button("Previous page", () =>
          loadChildren(
            item,
            targetScope,
            target,
            history.at(-1),
            history.slice(0, -1),
          ),
        ),
      );
    if (result.next)
      target.append(
        button("Next page", () =>
          loadChildren(item, targetScope, target, result.next, [
            ...history,
            cursor,
          ]),
        ),
      );
  } catch (error) {
    if (error.name !== "AbortError") target.textContent = error.message;
  }
}
$("#newItem").onclick = async () => {
  if (!schema) return;
  const targetScope = scope;
  const type = node("select"),
    name = node("input", { required: true });
  for (const info of schema.itemTypes.filter(
    (x) => !["annotation", "attachment", "note"].includes(x.itemType),
  ))
    type.add(new Option(label("itemTypes", info.itemType), info.itemType));
  type.value = "journalArticle";
  if (
    !(await promptFields(
      "New item",
      [field("Item type", type), field("Title", name)],
      { submit: "Create" },
    ))
  )
    return;
  try {
    const [item] = await targetScope.request("items", {
      method: "POST",
      body: [
        {
          data: {
            itemType: type.value,
            title: name.value,
          },
        },
      ],
    });
    if (scope === targetScope) {
      items.reset();
      await openDetail(item.key);
      pane("details");
    }
  } catch (error) {
    notify(error);
  }
};
async function addNote(parent = detail?.key || null) {
  if (!scope) return;
  const targetScope = scope;
  const text = node("textarea", { rows: 8, required: true }),
    name = node("input", { placeholder: "Note title" });
  if (
    !(await promptFields(
      "New note",
      [field("Title", name), field("Note", text)],
      { submit: "Create" },
    ))
  )
    return;
  try {
    const [item] = await targetScope.request("items", {
      method: "POST",
      body: [
        {
          data: {
            itemType: "note",
            title: name.value,
            note: text.value,
            ...(parent ? { parentItem: parent } : {}),
          },
        },
      ],
    });
    if (scope === targetScope) {
      items.reset();
      await openDetail(item.key);
      pane("details");
    }
  } catch (error) {
    notify(error);
  }
};
$("#identifiers").onclick = async () => {
  if (!scope) return;
  const targetScope = scope,
    id = projectId,
    input = node("textarea", {
      rows: 7,
      required: true,
      placeholder: "DOI, PMID, PMCID, ISBN or arXiv identifiers — one per line",
    });
  if (
    !(await promptFields(
      "Add by Identifier",
      [
        node(
          "p",
          {},
          "Project: " + currentProject().name,
        ),
        field("Identifiers", input),
      ],
      { submit: "Import" },
    ))
  )
    return;
  try {
    const job = await targetScope.request("identifiers/import", {
      method: "POST",
      body: {
        identifiers: input.value
          .split(/\n|;/)
          .map((x) => x.trim())
          .filter(Boolean),
        requestId: crypto.randomUUID(),
      },
    });
    trackJob(id, job);
  } catch (error) {
    notify(error);
  }
};
$("#actions").onchange = async () => {
  const action = $("#actions").value;
  $("#actions").value = "";
  if (!action || selectionPending) return;
  if (!selection.size) {
    notify("Select one or more items first.");
    return;
  }
  const id = projectId,
    targetScope = scope,
    selected = [...selection.values()];
  try {
    if (action === "export") {
      await exportReferences({
        scope: targetScope,
        selections: [
          {
            label: selected.length + " selected references",
            selection: {
              scope: "selected",
              keys: selected.map((item) => item.key),
              version: items.version ?? undefined,
            },
          },
        ],
        onJob: (job) => trackJob(id, job),
      });
      return;
    }
    if (["enrich", "resolve-pdfs"].includes(action)) {
      trackJob(
        id,
        await targetScope.request("items/" + action, {
          method: "POST",
          body: {
            keys: selected.map((x) => x.key),
            requestId: crypto.randomUUID(),
          },
        }),
      );
      return;
    }
    if (
      action === "delete" &&
      !confirm("Move " + selected.length + " selected items to deleted items?")
    )
      return;
    trackJob(
      id,
      await targetScope.request("items/manage", {
        method: "POST",
        body: {
          operation: action,
          items: selected.map(({ key, version }) => ({ key, version })),
          requestId: crypto.randomUUID(),
        },
      }),
    );
  } catch (error) {
    notify(error);
  }
};
function trackJob(id, job) {
  storeJob(id, job);
  pollJobs();
}
function storeJob(id, job) {
  const key = id + ":" + job.id,
    value = { ...job, projectId: id };
  jobs.set(key, value);
  for (const callback of jobListeners.get(key) || []) callback(value);
}
function jobProgress(job) {
  const exported = job.progress?.export;
  if (exported)
    return `${human(exported.phase)} · ${exported.completed}${exported.total === undefined ? "" : "/" + exported.total} records`;
  const progress = job.progress?.import || job.progress?.["openalex-import"];
  return progress
    ? `${progress.completed}/${progress.total} records`
    : `${job.completed}/${job.total}`;
}
async function restoreJobs(id, generation) {
  const controller = (jobListController = new AbortController());
  try {
    const result = await api
      .project(id)
      .request("jobs?limit=8", { signal: controller.signal });
    if (generation !== view || controller.signal.aborted) return;
    for (const job of result.items) {
      const key = id + ":" + job.id;
      if (!jobs.has(key)) storeJob(id, job);
    }
    pollJobs();
  } catch (error) {
    if (!controller.signal.aborted && generation === view) notify(error);
  }
}
$("#jobHistory").onclick = () => {
  if (!scope) return;
  const id = projectId,
    target = scope,
    d = dialog("Library jobs"),
    rows = node("div", { class: "search-results" });
  d.body.append(rows);
  const list = new VirtualList({
    element: rows,
    label: "Library jobs",
    key: (job) => job.id,
    rowHeight: 60,
    load: async ({ start, limit, signal }) => {
      const result = await target.request("jobs?" + query({ start, limit }), {
        signal,
      });
      return {
        items: result.items,
        hasMore: result.nextStart !== null && result.nextStart !== undefined,
      };
    },
    render: (job) =>
      node(
        "span",
        { class: "source-label" },
        node("strong", {}, human(job.kind) + " · " + human(job.status)),
        node(
          "small",
          {},
          job.completed +
            "/" +
            job.total +
            " · " +
            new Date(job.createdAt).toLocaleString(),
        ),
      ),
    onSelect: (job) => showJob({ ...job, projectId: id }),
    onStatus: (text, error) => {
      d.notice.textContent = error?.message || text;
    },
  });
  d.actions.append(
    button("Close", () => d.el.close()),
    button("Refresh", () => list.reset({ preservePosition: true })),
  );
  d.el.addEventListener("close", () => list.destroy(), { once: true });
  d.open();
};
async function pollJobs() {
  clearTimeout(jobTimer);
  if (appRetired || document.hidden || jobsPolling) return;
  jobsPolling = true;
  for (const [key, job] of jobs) {
    if (["queued", "running"].includes(job.status)) {
      try {
        const latest = await api
          .project(job.projectId)
          .request("jobs/" + job.id);
        storeJob(job.projectId, latest);
        if (
          !["queued", "running"].includes(latest.status) &&
          job.projectId === projectId &&
          job.kind !== "metadata-export"
        ) {
          items?.reset({ preservePosition: true });
        }
      } catch (error) {
        job.error = error.message;
      }
    }
  }
  if (appRetired) {
    jobsPolling = false;
    return;
  }
  $("#jobs").replaceChildren();
  for (const job of [...jobs.values()]
    .filter((job) => job.projectId === projectId)
    .slice(-8)) {
    const label =
      human(job.kind) + " · " + human(job.status) + " · " + jobProgress(job);
    $("#jobs").append(button(label, () => showJob(job)));
  }
  if ([...jobs.values()].some((j) => ["queued", "running"].includes(j.status)))
    jobTimer = setTimeout(pollJobs, 1500);
  jobsPolling = false;
}
async function showJob(job) {
  const d = dialog(human(job.kind)),
    controller = new AbortController();
  d.actions.append(button("Close", () => d.el.close()));
  d.el.addEventListener("close", () => controller.abort(), { once: true });
  d.notice.textContent = "Loading operation…";
  d.open();
  try {
    job = {
      ...(await api
        .project(job.projectId)
        .request("jobs/" + job.id, { signal: controller.signal })),
      projectId: job.projectId,
    };
    if (controller.signal.aborted) return;
    storeJob(job.projectId, job);
    d.notice.textContent = "";
  } catch (error) {
    if (!controller.signal.aborted) d.notice.textContent = error.message;
    return;
  }
  const summary = node("p", {}, human(job.status) + " · " + jobProgress(job)),
    errorNotice = node("p", { class: "notice" }, job.error || ""),
    browserNotice = node("div", { class: "notice", role: "status" });
  d.body.append(summary, errorNotice, browserNotice);
  const results = node("div", { class: "search-results" });
  d.body.append(results);
  const list = new VirtualList({
    element: results,
    label: "Operation results",
    load: async ({ start, limit }) => ({
      items: (job.results || []).slice(start, start + limit),
      hasMore: start + limit < (job.results || []).length,
    }),
    key: (x) => x.index,
    render: (x) =>
      node(
        "span",
        { class: "result-label" },
        String(x.index + 1) +
          " · " +
          x.status +
          " · " +
          (x.error || x.result?.status || ""),
      ),
    onActivate: (result) => showJobResult(job, result),
    onSelect: (result) => showJobResult(job, result),
  });
  d.el.addEventListener("close", () => list.destroy(), { once: true });
  const resume = button("Resume", async () => {
    resume.disabled = true;
    try {
      trackJob(
        job.projectId,
        await api
          .project(job.projectId)
          .request("jobs/" + job.id + "/resume", { method: "POST" }),
      );
      d.el.close();
    } catch (error) {
      d.notice.textContent = error.message;
      resume.disabled = false;
    }
  });
  const cancel = button("Cancel work", async () => {
    cancel.disabled = true;
    try {
      await api
        .project(job.projectId)
        .request("jobs/" + job.id, { method: "DELETE" });
      storeJob(
        job.projectId,
        await api.project(job.projectId).request("jobs/" + job.id),
      );
      d.el.close();
      pollJobs();
    } catch (error) {
      d.notice.textContent = error.message;
      cancel.disabled = false;
    }
  });
  d.actions.append(resume, cancel);
  if (job.kind === "openalex-search-import")
    d.actions.append(
      button("Browse source outcomes", () => showSearchOutcomes(job)),
    );
  const key = job.projectId + ":" + job.id,
    listeners = jobListeners.get(key) || new Set();
  const updated = (latest) => {
    job = latest;
    summary.textContent = human(job.status) + " · " + jobProgress(job);
    errorNotice.textContent = job.error || "";
    browserNotice.replaceChildren();
    const browserSteps = Object.values(job.progress || {}).filter((step) =>
      step.browser?.status === "waiting");
    for (const step of browserSteps.slice(0, 8))
      browserNotice.append(resolverBrowserStatus(step.browser));
    if (browserSteps.length > 8)
      browserNotice.append(node("p", {}, `${browserSteps.length - 8} more browser steps in the operation results.`));
    list.reset({ preservePosition: true });
    resume.hidden = !["interrupted", "failed", "partial"].includes(job.status);
    cancel.hidden = !["queued", "running", "waiting-for-browser"].includes(
      job.status,
    );
  };
  listeners.add(updated);
  jobListeners.set(key, listeners);
  updated(job);
  d.el.addEventListener(
    "close",
    () => {
      listeners.delete(updated);
      if (!listeners.size) jobListeners.delete(key);
    },
    { once: true },
  );
}
function showSearchOutcomes(job) {
  const d = dialog("Imported source outcomes"),
    rows = node("div", { class: "search-results" }),
    targetScope = api.project(job.projectId);
  d.body.append(rows);
  let list;
  list = new VirtualList({
    element: rows,
    label: "Source outcomes",
    key: (item) => item.sourceId,
    rowHeight: 60,
    load: ({ start, limit, cursor, signal }) =>
      targetScope.request(
        "jobs/" +
          job.id +
          "/results?" +
          query({
            start,
            limit,
            cursor,
            version: list?.version ?? undefined,
          }),
        { signal },
      ),
    render: (item) =>
      node(
        "span",
        { class: "source-label" },
        node("strong", {}, item.sourceId),
        node(
          "small",
          {},
          human(item.status) +
            (resolverSteps(item).length ? " · Browser step required" : "") +
            (item.error ? " · " + item.error : ""),
        ),
      ),
    onSelect: (item) =>
      showJobResult(job, {
        status: item.status,
        error: item.error,
        result: item,
      }),
    onStatus: (text, error) => {
      d.notice.textContent = error?.message || text;
    },
  });
  d.actions.append(
    button("Close", () => d.el.close()),
    button("Refresh", () => list.reset({ preservePosition: true })),
  );
  d.el.addEventListener("close", () => list.destroy(), { once: true });
  d.open();
}
function resolverSteps(result) {
  const pending = [],
    stack = [result];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (value.status === "challenge-required" && value.requestId)
      pending.push(value);
    else
      for (const child of Object.values(value))
        if (child && typeof child === "object") stack.push(child);
  }
  return pending;
}
function resolverBrowserStatus(browser) {
  const row = node("p", {}, `Waiting in background browser tab ${browser.tabId}. `);
  try {
    const url = new URL(browser.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return row;
    row.append(node("a", { href: url.href, target: "_blank", rel: "noopener noreferrer" }, url.hostname));
  } catch {}
  return row;
}
function showJobResult(job, result) {
  const d = dialog("Operation result"),
    controller = new AbortController(),
    pending = resolverSteps(result);
  d.body.append(node("p", {}, result.error || human(result.status)));
  if (job.kind === "file-import" && Number.isSafeInteger(result.result?.count))
    d.body.append(
      node(
        "p",
        {},
        `${result.result.count} reference${result.result.count === 1 ? "" : "s"} imported.`,
      ),
    );
  if (result.result?.downloadPath) {
    if (Number.isSafeInteger(result.result.count))
      d.body.append(
        node(
          "p",
          {},
          `${result.result.count} reference${result.result.count === 1 ? "" : "s"} exported.`,
        ),
      );
    d.body.append(
      exportDownloadLink(api.project(job.projectId), result.result),
    );
    if (result.result.expiresAt)
      d.body.append(
        node(
          "p",
          { class: "notice" },
          "Download available until " +
            new Date(result.result.expiresAt).toLocaleString() +
            ".",
        ),
      );
  }
  if (Number.isSafeInteger(result.result?.processed)) {
    const outcome = result.result;
    d.body.append(
      node(
        "p",
        {},
        `${outcome.processed} processed · ${outcome.imported} imported · ${outcome.skipped} skipped · ${outcome.failed} failed`,
      ),
      node(
        "p",
        {},
        `${outcome.totalResultsReported} matching results reported · requested limit ${outcome.limit} · ${outcome.stoppedBecause === "limit" ? "requested limit reached" : "end of results"}`,
      ),
      button("Browse all source outcomes", () => showSearchOutcomes(job)),
    );
    if (outcome.pendingBrowserRequests)
      d.body.append(
        node(
          "p",
          { class: "notice" },
          `${outcome.pendingBrowserRequests} browser steps remain. Browse the source outcomes to continue them.`,
        ),
      );
  }
  if (result.result?.sourceId)
    d.body.append(node("p", {}, "Source: " + result.result.sourceId));
  if (pending.length)
    d.body.append(
      node(
        "p",
        { class: "notice" },
        "The source requires a visible browser step to retrieve the file.",
      ),
    );
  const rows = node("div", {
    class: "search-results",
    hidden: !pending.length,
  });
  d.body.append(rows);
  const list = new VirtualList({
    element: rows,
    label: "Browser resolver steps",
    rowHeight: 60,
    key: (item) => item.requestId,
    load: async ({ start, limit }) => ({
      items: pending.slice(start, start + limit),
      hasMore: start + limit < pending.length,
    }),
    render: (item) => {
      const action = button("Continue in browser", async () => {
        action.disabled = true;
        d.notice.textContent = "Waiting for the browser step…";
        try {
          await api.request("resolve", {
            method: "POST",
            body: { projectId: job.projectId, requestId: item.requestId },
            signal: controller.signal,
          });
          const latest = await api
            .project(job.projectId)
            .request("jobs/" + job.id, { signal: controller.signal });
          storeJob(job.projectId, latest);
          pollJobs();
          if (projectId === job.projectId)
            items?.reset({ preservePosition: true });
          d.notice.textContent = "Browser step completed.";
          action.textContent = "Completed";
        } catch (error) {
          if (!controller.signal.aborted) {
            d.notice.textContent = error.message;
            action.disabled = false;
          }
        }
      });
      return node(
        "div",
        { class: "attachment-row" },
        node("span", {}, item.attachment?.title || "Full text"),
        item.browser ? resolverBrowserStatus(item.browser) : null,
        action,
      );
    },
  });
  d.actions.append(button("Close", () => d.el.close()));
  d.el.addEventListener(
    "close",
    () => {
      controller.abort();
      list.destroy();
    },
    { once: true },
  );
  d.open();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(jobTimer);
  else {
    pollJobs();
    if (!detailDirty) items?.reset();
  }
});

async function uploadDialog(parentKey, targetScope = scope) {
  if (!targetScope) return;
  const targetProject = projectId,
    d = dialog("Add attachment");
  const file = node("input", { type: "file" }),
    link = node("input", { type: "url", placeholder: "https://…" });
  const name = node("input", { placeholder: "Attachment title" });
  const progress = node("progress", { max: 1, value: 0, hidden: true });
  d.body.append(
    field("File", file),
    field("Or link to a web page", link),
    field("Title", name),
    progress,
  );
  const controller = new AbortController();
  const submit = button(
    "Add attachment",
    async () => {
      submit.disabled = true;
      try {
        if (link.value) {
          const url = new URL(link.value);
          if (!["https:", "http:"].includes(url.protocol))
            throw Error("Use an HTTP or HTTPS web address.");
          await targetScope.request("items", {
            method: "POST",
            body: [
              {
                data: {
                  itemType: "attachment",
                  linkMode: "linked_url",
                  title: name.value || url.href,
                  url: url.href,
                  ...(parentKey ? { parentItem: parentKey } : {}),
                },
              },
            ],
            signal: controller.signal,
          });
        } else {
          const selected = file.files[0];
          if (!selected) throw Error("Choose a file or enter a web address.");
          const requestId = crypto.randomUUID();
          await uploadFile({
            scope: targetScope,
            file: selected,
            body: {
              method: parentKey ? "saveAttachment" : "saveStandaloneAttachment",
              ...(parentKey ? { parentKey } : {}),
              requestId,
              queryString: query({ sessionID: requestId }),
              headers: {
                "X-Metadata": JSON.stringify({
                  parentItemID: parentKey,
                  title: name.value || selected.name,
                  contentType: selected.type || "application/octet-stream",
                  filename: selected.name,
                }),
              },
            },
            signal: controller.signal,
            onProgress({ loaded, total }) {
              progress.hidden = false;
              progress.value = loaded / Math.max(1, total);
              d.notice.textContent =
                "Uploading · " + Math.round(progress.value * 100) + "%";
            },
          });
        }
        controller.signal.throwIfAborted();
        d.el.close();
        if (projectId === targetProject) {
          items.reset();
          if (parentKey && detail?.key === parentKey)
            await openDetail(parentKey);
        }
      } catch (error) {
        if (!controller.signal.aborted) d.notice.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    },
    { class: "primary" },
  );
  d.actions.append(
    button("Cancel", () => d.el.close()),
    submit,
  );
  d.el.addEventListener("close", () => controller.abort(), { once: true });
  d.open();
}
$("#about").onclick = async () => {
  const d = dialog('About References'), controller = new AbortController();
  d.el.classList.add('references-about');
  d.actions.append(button('Close', () => d.el.close()));
  d.el.addEventListener('close', () => controller.abort(), { once: true });
  d.body.append(node('p', {}, 'Taskarian reference management, page and PDF capture, and document citations.'));
  d.open();
  try {
    if (!scope) throw Error('Select a References project to load its packaged source and licenses.');
    const about = await scope.request('about', { signal: controller.signal });
    if (controller.signal.aborted) return;
    d.body.replaceChildren(node('p', {}, about.description));
    const attribution = node('details', {}, node('summary', {}, 'Source and attribution'), node('pre', {}, about.attribution));
    d.body.append(attribution, node('h3', {}, 'Component licenses'));
    for (const component of about.components) {
      const entry = node('details', {}, node('summary', {}, [component.name, component.version, component.license].filter(Boolean).join(' · ')));
      if (/^https?:\/\//i.test(component.source || '')) entry.append(node('a', { href: component.source, target: '_blank', rel: 'noopener noreferrer' }, 'Original source'));
      entry.append(node('pre', {}, component.text)); d.body.append(entry);
    }
  } catch (error) { if (!controller.signal.aborted) d.notice.textContent = error.message; }
};

$("#settings").onclick = async () => {
  if (!scope) return;
  const targetScope = scope,
    d = dialog("References settings"),
    controller = new AbortController();
  d.el.addEventListener("close", () => controller.abort(), { once: true });
  d.actions.append(button("Close", () => d.el.close()));
  d.open();
  try {
    const settings = await targetScope.request("settings", {
      signal: controller.signal,
    });
    const key = node("input", {
      type: "password",
      autocomplete: "new-password",
      placeholder: settings.openalexKeyConfigured
        ? "Configured · leave blank to retain"
        : "OpenAlex API key",
    });
    const removeKey = node("input", { type: "checkbox" }),
      crossref = node("input", {
        type: "email",
        value: settings.crossrefEmail,
      });
    const crossrefKey = node("input", {
        type: "password",
        autocomplete: "new-password",
        placeholder: settings.crossrefKeyConfigured
          ? "Configured · leave blank to retain"
          : "Optional Metadata Plus API key",
      }),
      removeCrossrefKey = node("input", { type: "checkbox" });
    const unpaywall = node("input", {
        type: "email",
        value: settings.unpaywallEmail,
      }),
      automatic = node("input", {
        type: "checkbox",
        checked: settings.automaticPDFs,
      }),
      regeneration = node("select");
    for (const [value, text] of [
      [-1, "Ask before changing edited citations"],
      [1, "Always regenerate edited citations"],
      [0, "Keep edited citation text"],
    ])
      regeneration.add(new Option(text, String(value)));
    regeneration.value = String(settings.citationAutoRegenerate ?? -1);
    const resolvers = node("textarea", {
      rows: 10,
      value: settings.resolvers,
      spellcheck: "false",
    });
    let defaultCitationStyle = settings.defaultCitationStyle || null;
    const styleName = node('span', {}, defaultCitationStyle ? defaultCitationStyle.id : 'Use the document default');
    const styleSetting = node('div', { class: 'default-style-setting' }, styleName,
      button('Choose style…', async () => {
        try {
          const chosen = await selectStyle(targetScope, defaultCitationStyle || undefined);
          if (chosen) { defaultCitationStyle = chosen; styleName.textContent = chosen.id; }
        } catch (error) { d.notice.textContent = error.message; }
      }),
      button('Clear', () => { defaultCitationStyle = null; styleName.textContent = 'Use the document default'; }),
      node('p', { class: 'notice' }, 'Used when citations are first added to a document. Existing document styles and later document-specific choices are preserved.'),
    );
    const form = node(
      "form",
      {},
      node('h3', {}, 'Default citation style'), styleSetting,
      field("OpenAlex API key", key),
      field("Remove stored OpenAlex key", removeKey),
      field("Crossref contact email", crossref),
      field("Crossref Metadata Plus key", crossrefKey),
      field("Remove stored Crossref key", removeCrossrefKey),
      field("Unpaywall contact email", unpaywall),
      field("Find available PDFs after import", automatic),
      field("Edited citation previews", regeneration),
      field("Custom PDF resolvers · native JSON configuration", resolvers),
    );
    d.body.append(
      form,
      node(
        "p",
        { class: "notice" },
        "Settings apply to this environment’s shared References service. Resolver requests retain their native pacing and retries.",
      ),
    );
    const save = button("Save", () => form.requestSubmit(), {
      class: "primary",
    });
    d.actions.append(save);
    form.onsubmit = async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        const body = {
          crossrefEmail: crossref.value,
          unpaywallEmail: unpaywall.value,
          automaticPDFs: automatic.checked,
          citationAutoRegenerate: Number(regeneration.value),
          defaultCitationStyle,
          resolvers: resolvers.value,
        };
        if (removeKey.checked) body.openalexKey = "";
        else if (key.value) body.openalexKey = key.value;
        if (removeCrossrefKey.checked) body.crossrefKey = "";
        else if (crossrefKey.value) body.crossrefKey = crossrefKey.value;
        await targetScope.request("settings", {
          method: "PATCH",
          body,
          signal: controller.signal,
        });
        d.el.close();
      } catch (error) {
        if (!controller.signal.aborted) d.notice.textContent = error.message;
      } finally {
        save.disabled = false;
      }
    };
  } catch (error) {
    if (!controller.signal.aborted) d.notice.textContent = error.message;
  }
};

$("#openalex").onclick = () => openAlexDialog();
function openAlexDialog(saved) {
  if (!scope) return;
  const targetScope = scope,
    targetProject = projectId,
    d = dialog("OpenAlex Search");
  const text = node("input", { type: "search", placeholder: "Search works" }),
    searchMode = node("select"),
    queryMode = node("select"),
    exact = node("input", { type: "checkbox" });
  queryMode.add(new Option("Boolean search", "boolean"));
  queryMode.add(new Option("Semantic search", "semantic"));
  searchMode.add(new Option("All searchable fields", "all"));
  searchMode.add(new Option("Title", "title"));
  searchMode.add(new Option("Title and abstract", "title_and_abstract"));
  searchMode.add(
    new Option("Title, abstract and keywords", "title_abstract_keywords"),
  );
  const order = node("select");
  for (const [value, label] of [
    ["", "Relevance"],
    ["publication_date:desc", "Newest"],
    ["publication_date:asc", "Oldest"],
    ["cited_by_count:desc", "Most cited"],
  ])
    order.add(new Option(label, value));
  const from = node("input", { type: "date" }),
    to = node("input", { type: "date" }),
    limit = node("input", { type: "number", min: 1, step: 1, value: 1000 }),
    modeNotice = node("p", { class: "notice" });
  const article = node("input", { type: "checkbox" }),
    abstract = node("input", { type: "checkbox" }),
    oa = node("input", { type: "checkbox" }),
    pdf = node("input", { type: "checkbox" });
  const custom = node("input", {
      placeholder: "e.g. institutions.id:I123,language:en",
    }),
    filters = node("div", { class: "filter-chips" });
  const filterSearch = node("input", {
      type: "search",
      placeholder: "Find a filter",
      "aria-label": "Find a filter",
    }),
    filterGroups = node("div", { class: "filter-groups" });
  const definitions = [
    ["Basics", "Articles only", article],
    ["Access", "Has abstract", abstract],
    ["Access", "Open access", oa],
    ["Access", "Has PDF", pdf],
    ["Publication", "From date", from],
    ["Publication", "Through date", to],
    ["Advanced", "Additional OpenAlex filters", custom],
  ];
  for (const group of ["Basics", "Access", "Publication", "Advanced"]) {
    const section = node("details", { open: true }, node("summary", {}, group));
    for (const [, label, input] of definitions.filter(
      (entry) => entry[0] === group,
    ))
      section.append(field(label, input));
    filterGroups.append(section);
  }
  filterSearch.oninput = () => {
    const term = filterSearch.value.trim().toLowerCase();
    for (const section of filterGroups.children) {
      let visible = false;
      for (const label of section.querySelectorAll(".field")) {
        label.hidden = !label.textContent.toLowerCase().includes(term);
        visible ||= !label.hidden;
      }
      section.hidden = !visible;
    }
  };
  const form = node(
    "form",
    {},
    field("Query", text),
    node(
      "div",
      { class: "search-filters" },
      field("Search mode", queryMode),
      field("Search fields", searchMode),
      field("Exact search without stemming", exact),
      field("Sort", order),
      field("Maximum results", limit),
    ),
    filterSearch,
    filterGroups,
    filters,
    modeNotice,
  );
  const summary = node("p", { class: "notice", role: "status" }),
    results = node("div", { class: "search-results" }),
    details = node(
      "details",
      {},
      node("summary", {}, "Selected result details"),
    ),
    detailBody = node("div");
  details.append(detailBody);
  const resolve = node("input", { type: "checkbox" }),
    multiSelect = node("input", { type: "checkbox" }),
    selection = new Map();
  let searchSpec = null,
    request,
    searchImportAttempt,
    submittingSearchImport = false,
    generation = 0;
  d.body.append(
    node(
      "p",
      {},
      "Project: " + currentProject().name,
    ),
    form,
    summary,
    results,
    details,
    field("Multiple selection", multiSelect),
    field("Find available PDFs for imported results", resolve),
  );
  const list = new VirtualList({
    element: results,
    label: "OpenAlex search results",
    rowHeight: 48,
    key: (item) => item.id,
    load: async ({ start, limit: pageSize, cursor, signal }) => {
      const specification = searchSpec;
      if (!specification || start >= specification.limit)
        return { items: [], hasMore: false };
      const result = await targetScope.request("openalex/search", {
        method: "POST",
        body: {
          ...specification,
          page: Math.floor(start / pageSize) + 1,
          pageSize:
            specification.queryMode === "semantic"
              ? Math.min(50, specification.limit)
              : pageSize,
          cursor,
        },
        signal,
      });
      signal.throwIfAborted();
      if (start === 0 && !submittingSearchImport)
        importAll.disabled = !result.records.length;
      const records = result.records.slice(
        0,
        Math.max(0, specification.limit - start),
      );
      summary.textContent =
        result.totalResultsReported +
        " matching works reported by OpenAlex · " +
        (start + records.length) +
        " reached · limit " +
        specification.limit;
      const more =
        !!(result.nextPage || result.nextCursor) &&
        start + records.length < specification.limit;
      return {
        items: records,
        next: more ? result.nextCursor : null,
        hasMore: more,
      };
    },
    onStatus: (text, error) => {
      if (error) summary.textContent = error.message;
    },
    render: (item) =>
      node(
        "span",
        { class: "source-label" },
        node("strong", {}, item.raw.title || "Untitled"),
        node(
          "small",
          {},
          (item.raw.authorships || [])
            .map((a) => a.author?.display_name)
            .filter(Boolean)
            .join("; "),
        ),
      ),
    onSelect: (item, event) => {
      event.toggle ||= multiSelect.checked;
      if (!event.toggle) selection.clear();
      if (event.toggle && selection.has(item.id)) selection.delete(item.id);
      else selection.set(item.id, item);
      list.setSelection(selection.keys());
      detailBody.replaceChildren(
        node("h3", {}, item.raw.title || "Untitled"),
        node(
          "p",
          {},
          (item.raw.authorships || [])
            .map((author) => author.author?.display_name)
            .filter(Boolean)
            .join("; "),
        ),
        node(
          "p",
          { class: "notice" },
          [item.raw.publication_date, item.doi, item.pmid]
            .filter(Boolean)
            .join(" · "),
        ),
        node(
          "p",
          {},
          item.abstract || item.abstractIssue?.reason || "Abstract unavailable",
        ),
        node(
          "a",
          {
            href: item.sourceUrl,
            target: "_blank",
            rel: "noopener noreferrer",
          },
          "OpenAlex source",
        ),
      );
      importButton.disabled = !selection.size;
    },
  });
  function filterParts() {
    const parts = [];
    if (from.value) parts.push("from_publication_date:" + from.value);
    if (to.value) parts.push("to_publication_date:" + to.value);
    if (article.checked) parts.push("type:article");
    if (abstract.checked) parts.push("has_abstract:true");
    if (oa.checked) parts.push("is_oa:true");
    if (pdf.checked) parts.push("has_pdf_url:true");
    if (custom.value.trim()) parts.push(custom.value.trim());
    return parts;
  }
  function chips() {
    filters.replaceChildren();
    for (const [, label, input] of definitions)
      if (input.type === "checkbox" ? input.checked : input.value)
        filters.append(
          button(
            label +
              (input.type === "checkbox" ? "" : ": " + input.value) +
              " ×",
            () => {
              if (input.type === "checkbox") input.checked = false;
              else input.value = "";
              chips();
            },
          ),
        );
  }
  form.addEventListener("change", chips);
  const updateMode = () => {
    const semantic = queryMode.value === "semantic";
    searchMode.disabled = semantic;
    exact.disabled = semantic;
    order.disabled = semantic;
    limit.setCustomValidity("");
    text.setCustomValidity("");
    if (semantic) limit.max = "50";
    else limit.removeAttribute("max");
    modeNotice.textContent = semantic
      ? "OpenAlex semantic search supports up to 50 results and 2,000 query characters."
      : "Imports beyond the first 10,000 results require an OpenAlex key in References Settings.";
  };
  limit.addEventListener("input", () => limit.setCustomValidity(""));
  text.addEventListener("input", () => text.setCustomValidity(""));
  queryMode.addEventListener("change", updateMode);
  const search = button("Search", () => form.requestSubmit(), {
      class: "primary",
    }),
    cancelSearch = button(
      "Cancel search",
      () => {
        request?.abort();
        list.controller.abort();
        summary.textContent = "Search cancelled. Loaded results are retained.";
      },
      {
        disabled: true,
      },
    );
  form.append(
    node(
      "div",
      { class: "toolbar" },
      search,
      cancelSearch,
      button("Estimate results", () => runSearch(true)),
    ),
  );
  async function runSearch(estimate = false) {
    limit.setCustomValidity(
      Number.isSafeInteger(Number(limit.value)) && Number(limit.value) > 0
        ? ""
        : "Enter a positive whole number of results.",
    );
    text.setCustomValidity(
      queryMode.value === "semantic" && text.value.length > 2000
        ? "OpenAlex semantic search accepts up to 2,000 query characters."
        : "",
    );
    if (!form.reportValidity()) return;
    request?.abort();
    request = new AbortController();
    const signal = request.signal,
      current = ++generation;
    search.disabled = true;
    cancelSearch.disabled = false;
    summary.textContent = "Searching OpenAlex…";
    const specification = {
      query: text.value,
      queryMode: queryMode.value,
      field: queryMode.value === "semantic" ? "all" : searchMode.value,
      exact: queryMode.value === "boolean" && exact.checked,
      filter: filterParts().join(","),
      sort: queryMode.value === "semantic" ? "" : order.value,
      limit: Number(limit.value),
    };
    if (!estimate) {
      searchSpec = specification;
      searchImportAttempt = null;
      selection.clear();
      list.reset({ preserveSelection: false });
      importButton.disabled = true;
      importAll.disabled = true;
      importAll.textContent =
        "Import up to " + specification.limit + " results";
      detailBody.replaceChildren();
      search.disabled = false;
      return;
    }
    try {
      const result = await targetScope.request("openalex/search", {
        method: "POST",
        body: { ...specification, estimate: true, page: 1 },
        signal,
      });
      if (signal.aborted || current !== generation) return;
      summary.textContent =
        result.totalResultsReported +
        " matching works reported by OpenAlex" +
        (estimate
          ? " · estimate only"
          : "; " + result.count + " loaded · " + result.stopReason) +
        (result.warnings?.malformedAbstracts
          ? " · " +
            result.warnings.malformedAbstracts +
            " unavailable abstracts"
          : "");
    } catch (error) {
      if (current === generation)
        summary.textContent = signal.aborted
          ? "Search cancelled. Previous results are retained."
          : error.message;
    } finally {
      if (current === generation) {
        search.disabled = false;
        cancelSearch.disabled = true;
      }
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    void runSearch();
  };
  const importButton = button(
    "Import selected",
    async () => {
      importButton.disabled = true;
      try {
        const job = await targetScope.request("openalex/import", {
          method: "POST",
          body: {
            records: [...selection.values()].map((x) => x.raw),
            resolvePDFs: resolve.checked,
            requestId: crypto.randomUUID(),
              },
        });
        trackJob(targetProject, job);
        d.notice.textContent = selection.size + " results queued for import.";
      } catch (error) {
        d.notice.textContent = error.message;
      } finally {
        importButton.disabled = !selection.size;
      }
    },
    { disabled: true },
  );
  const importAll = button(
    "Import matching results",
    async () => {
      if (!searchSpec || submittingSearchImport) return;
      submittingSearchImport = true;
      importAll.disabled = true;
      const { limit: maximum, ...search } = searchSpec,
        body = {
          search,
          limit: maximum,
            resolvePDFs: resolve.checked,
        },
        fingerprint = JSON.stringify(body);
      if (searchImportAttempt?.fingerprint !== fingerprint)
        searchImportAttempt = { fingerprint, requestId: crypto.randomUUID() };
      try {
        const job = await targetScope.request("openalex/import", {
          method: "POST",
          body: { ...body, requestId: searchImportAttempt.requestId },
        });
        trackJob(targetProject, job);
        d.notice.textContent =
          "Import of up to " +
          maximum +
          " matching results queued. Progress, cancellation and source outcomes are in Jobs.";
      } catch (error) {
        d.notice.textContent = error.message;
      } finally {
        submittingSearchImport = false;
        importAll.disabled = !searchSpec || !list.length;
      }
    },
    { disabled: true },
  );
  d.actions.append(
    button("Close", () => d.el.close()),
    button("Save search", () =>
      saveSearch(
        targetScope,
        {
          provider: "openalex",
          query: text.value,
          queryMode: queryMode.value,
          field: searchMode.value,
          exact: exact.checked,
          filter: filterParts().join(","),
          sort: order.value,
          limit: Number(limit.value),
        },
        d.notice,
      ),
    ),
    button("Select loaded results", () => {
      for (const page of list.pages.values())
        for (const record of page.items) selection.set(record.id, record);
      list.setSelection(selection.keys());
      importButton.disabled = !selection.size;
    }),
    importButton,
    importAll,
  );
  d.el.addEventListener(
    "close",
    () => {
      request?.abort();
      list.destroy();
    },
    { once: true },
  );
  d.open();
  if (saved) {
    text.value = saved.query || "";
    custom.value = saved.filter || "";
    order.value = saved.sort || "";
    limit.value = saved.limit || 1000;
    queryMode.value = saved.queryMode || "boolean";
    searchMode.value = saved.field || "all";
    exact.checked = !!saved.exact;
    chips();
  }
  updateMode();
  text.focus();
}

async function chooseLibraryItem(targetScope, {
  heading = "Choose related item", isSelectable = () => true, signal,
} = {}) {
  signal?.throwIfAborted();
  const d = dialog(heading),
    search = node("input", { type: "search", "aria-label": "Search library" }),
    rows = node("div", { class: "search-results" });
  let selected = null,
    accepted = false,
    term = "";
  d.body.append(search, rows);
  const choose = button("Choose", () => {
    if (selected) { accepted = true; d.el.close(); }
  }, { class: "primary", disabled: true });
  const select = item => {
    selected = isSelectable(item) ? item : null;
    choose.disabled = !selected;
    list.setSelection(selected ? [item.key] : []);
    d.notice.textContent = selected ? "" : "Choose a regular top-level reference.";
  };
  const list = new VirtualList({
    element: rows,
    label: "Library references",
    rowHeight: 48,
    load: (args) =>
      targetScope.request(
        "items?" +
          query({
            q: term,
            start: args.start,
            limit: args.limit,
            cursor: args.cursor,
          }),
        { signal: args.signal },
      ),
    render: (item) =>
      node(
        "span",
        { class: "source-label" },
        node("strong", {}, title(item)),
        node("small", {}, creators(item)),
      ),
    rowAttributes: item => ({ "aria-disabled": !isSelectable(item) }),
    onSelect: select,
    onActivate: (item) => {
      select(item);
      if (selected) { accepted = true; d.el.close(); }
    },
  });
  const change = debounce(() => {
    term = search.value;
    selected = null;
    choose.disabled = true;
    list.reset({ preserveSelection: false });
  });
  search.oninput = () => {
    selected = null;
    choose.disabled = true;
    list.controller.abort();
    change();
  };
  const abort = () => d.el.close();
  signal?.addEventListener("abort", abort, { once: true });
  d.actions.append(button("Cancel", () => d.el.close()), choose);
  const result = new Promise((resolve) =>
    d.el.addEventListener(
      "close",
      () => {
        list.destroy();
        change.cancel();
        signal?.removeEventListener("abort", abort);
        resolve(accepted && !signal?.aborted ? selected : null);
      },
      { once: true },
    ),
  );
  d.open();
  search.focus();
  return result;
}

async function saveSearch(targetScope, configuration, notice) {
  const name = node("input", { required: true, placeholder: "Search name" });
  if (!(await promptFields("Save search", [field("Name", name)]))) return;
  try {
    await targetScope.request("searches", {
      method: "POST",
      body: { ...configuration, name: name.value },
    });
    notice.textContent = "Search saved.";
  } catch (error) {
    notice.textContent = error.message;
  }
}
$("#deletedItems").onclick = () => {
  deleted = true;
  selection.clear();
  cancelSelection();
  items.reset({ preserveSelection: false });
  updateSelectionActions();
  notify(
    "Deleted items · select items and choose Restore to return them to the library.",
  );
  pane("items");
};
$("#savedSearches").onclick = () => {
  if (!scope) return;
  const targetScope = scope,
    d = dialog("Saved searches"),
    rows = node("div", { class: "search-results" });
  let selected;
  d.body.append(rows);
  const list = new VirtualList({
    element: rows,
    label: "Saved searches",
    load: async ({ start, limit, signal }) => {
      const result = await targetScope.request(
        "searches?" + query({ start, limit }),
        { signal },
      );
      return { ...result, hasMore: result.items.length === limit };
    },
    render: (item) =>
      node(
        "span",
        { class: "source-label" },
        node("strong", {}, item.data.name),
        node(
          "small",
          {},
          item.data.provider +
            " · " +
            (item.data.query || item.data.filter || "All items"),
        ),
      ),
    onSelect: (item) => {
      selected = item;
      list.setSelection([item.key]);
    },
  });
  d.actions.append(
    button("Close", () => d.el.close()),
    button("Save current library search", () =>
      saveSearch(
        targetScope,
        {
          provider: "library",
          query: activeSearch,
            sort,
          direction,
          deleted,
        },
        d.notice,
      ),
    ),
    button("Rename", async () => {
      if (!selected) return;
      const target = selected,
        name = node("input", { required: true, value: target.data.name });
      if (!(await promptFields("Rename search", [field("Name", name)]))) return;
      try {
        await targetScope.request("searches/" + target.key, {
          method: "PATCH",
          body: {
            version: target.version,
            data: { ...target.data, name: name.value },
          },
        });
        list.reset();
      } catch (error) {
        d.notice.textContent = error.message;
      }
    }),
    button("Delete", async () => {
      if (!selected || !confirm("Delete this saved search?")) return;
      try {
        await targetScope.request("searches/" + selected.key, {
          method: "DELETE",
          body: { version: selected.version },
        });
        selected = null;
        list.reset();
      } catch (error) {
        d.notice.textContent = error.message;
      }
    }),
    button(
      "Open",
      async () => {
        if (!selected || scope !== targetScope) return;
        const data = selected.data;
        d.el.close();
        if (data.provider === "openalex") {
          openAlexDialog(data);
          return;
        }
        if (data.provider !== "library") {
          notify("This search provider is unavailable.");
          return;
        }
        activeSearch = data.query || "";
        $("#search").value = activeSearch;
        sort = data.sort || "title";
        direction = data.direction || "asc";
        deleted = !!data.deleted;
        try {
          if (data.collection) throw Error("This saved search used a retired collection filter. Save a new search for this project.");
          if (scope !== targetScope) return;
          cancelSelection();
          selection.clear();
          items.reset({ preserveSelection: false });
          updateSelectionActions();
          pane("items");
        } catch (error) {
          notify(error);
        }
      },
      { class: "primary" },
    ),
  );
  d.el.addEventListener("close", () => list.destroy(), { once: true });
  d.open();
};

async function selectStyle(
  targetScope,
  initial,
) {
  let styleOptions;
  if (!initial) { styleOptions = await targetScope.request('citation-options'); initial = styleOptions.defaultCitationStyle || { id: 'apa', locale: 'en-US' }; }
  const d = dialog("Citation style"),
    search = node("input", {
      type: "search",
      placeholder: "Search all citation styles",
    }),
    rows = node("div", { class: "search-results" }),
    locale = node("select");
  let chosen = initial.id,
    accepted = false,
    term = "",
    showAll = false;
  const allStyles = button('Load all styles', () => { showAll = true; allStyles.disabled = true; list.reset(); });
  d.body.append(field("Find a style", search), allStyles, rows, field("Language", locale));
  d.notice.textContent = 'Zotero’s bundled styles are shown first. Search finds matches across the full catalogue.';
  const list = new VirtualList({
    element: rows,
    label: "Citation styles",
    key: (item) => item.id,
    load: async ({ start, limit, signal }) => {
      const result = await targetScope.request(
        "styles?" + query({ query: term, start, limit, all: showAll ? 1 : undefined, selected: initial.id }),
        { signal },
      );
      return {
        ...result,
        hasMore: result.nextStart !== null && result.nextStart !== undefined,
      };
    },
    render: (item) => node("span", { class: "result-label" }, item.title),
    onSelect: (item) => {
      chosen = item.id;
      list.setSelection([chosen]);
    },
  });
  const change = debounce(() => {
    term = search.value;
    list.reset();
  });
  search.addEventListener("input", () => {
    list.controller.abort();
    change();
  });
  const controller = new AbortController();
  d.actions.append(
    button("Cancel", () => d.el.close()),
    button(
      "Choose style",
      () => {
        if (!chosen) return;
        accepted = true;
        d.el.close();
      },
      { class: "primary" },
    ),
  );
  const result = new Promise((resolve) =>
    d.el.addEventListener(
      "close",
      () => {
        controller.abort();
        change.cancel();
        list.destroy();
        resolve(
          accepted
            ? { id: chosen, locale: locale.value || initial.locale }
            : null,
        );
      },
      { once: true },
    ),
  );
  d.open();
  list.setSelection([chosen]);
  try {
    const options = styleOptions || await targetScope.request("citation-options", {
      signal: controller.signal,
    });
    for (const value of options.locales) locale.add(new Option(value, value));
    locale.value = initial.locale;
  } catch (error) {
    if (!controller.signal.aborted) d.notice.textContent = error.message;
  }
  return result;
}
$("#cite").onclick = async () => {
  if (!scope) return;
  const targetScope = scope,
    targetProject = projectId,
    selected = [...selection.values()];
  try {
    const style = await selectStyle(targetScope);
    if (!style) return;
    const initial = {
      id: crypto.randomUUID(),
      items: selected.map((item) => ({ id: item.id })),
    };
    const citation = await chooseCitation({
      api,
      projectId: targetProject,
      initial,
      style,
    });
    if (!citation) return;
    const output = await targetScope.request("citations/render", {
      method: "POST",
      body: { version: 1, style, citations: [{ ...citation, noteIndex: 1 }] },
    });
    const d = dialog("Citation and bibliography"),
      citationBox = node("div", { class: "citation-preview" }),
      bibliographyBox = node("div", { class: "bibliography-preview" });
    renderedHTML(citationBox, output.citations[0].html);
    renderedHTML(bibliographyBox, output.bibliography?.html || "");
    if (!output.bibliography)
      bibliographyBox.textContent =
        "This style does not generate a bibliography.";
    d.body.append(
      node("h3", {}, "Citation"),
      citationBox,
      node("h3", {}, "Bibliography"),
      bibliographyBox,
    );
    async function copy(value) {
      try {
        await navigator.clipboard.writeText(value);
        d.notice.textContent = "Copied.";
      } catch (error) {
        d.notice.textContent = error.message;
      }
    }
    d.actions.append(
      button("Close", () => d.el.close()),
      button("Copy citation", () => copy(output.citations[0].text)),
      button("Copy bibliography", () =>
        copy(output.bibliography?.textEntries?.join("\n\n") || ""),
      ),
      button("Copy managed citation", () =>
        copy(JSON.stringify({ version: 1, style, citations: [citation] })),
      ),
    );
    d.open();
  } catch (error) {
    notify(error);
  }
};
window.addEventListener("beforeunload", (event) => {
  if (detailDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
updateProjectActions();
void boot().catch(notify);
