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
import { Collections } from "./collections.js";
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
  collections,
  collection = null,
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
  activeSearch = "",
  deleted = false;
const notify = (message) => {
  const target = $("#status");
  if (target) target.textContent = message?.message || message || "";
};
const pane = (name) => ($("#app").dataset.pane = name);
for (const button of document.querySelectorAll("[data-pane]"))
  button.addEventListener("click", () => pane(button.dataset.pane));
const itemLabel = (item) =>
  node(
    "div",
    { class: "record-row" },
    node("span", { title: title(item) }, title(item)),
    node("span", { title: creators(item) }, creators(item)),
    node(
      "span",
      { class: "record-type" },
      label("itemTypes", item.data.itemType),
    ),
    node("span", {}, year(item)),
    node(
      "span",
      {
        "aria-label":
          item.meta?.attachmentCount || item.data.itemType === "attachment"
            ? "Attachments"
            : "",
      },
      item.meta?.attachmentCount || item.data.itemType === "attachment"
        ? "↧"
        : "",
    ),
  );
const label = (kind, value) =>
  schema?.locales?.["en-US"]?.[kind]?.[value] || human(value);
function selectedIdentity(item) {
  return { key: item.key, id: item.id, version: item.version };
}
async function boot() {
  context = await api.request("context");
  projectRecords = await api.request("projects?includeArchived=true");
  const list = projectRecords;
  if (list.find((project) => project.id === context.projectId)?.archived)
    $("#showArchived").checked = true;
  renderProjectList();
  if (!list.length) {
    notify("Create a project in BashKitten to start its library.");
    return;
  }
  if (list.some((project) => project.id === context.projectId))
    await selectProject(context.projectId);
  else notify("Select a project library.");
}
function renderProjectList() {
  const list = projectRecords.filter(
    (project) => !project.archived || $("#showArchived").checked,
  );
  projectList?.destroy();
  $("#projects").replaceChildren();
  const nameCounts = new Map();
  $("#projects").style.flexBasis =
    Math.max(52, Math.min(156, list.length * 52)) + "px";
  for (const project of list)
    nameCounts.set(project.name, (nameCounts.get(project.name) || 0) + 1);
  projectList = new VirtualList({
    element: $("#projects"),
    label: "Project libraries",
    rowHeight: 52,
    total: list.length,
    key: (project) => project.id,
    load: async ({ start, limit }) => ({
      items: list.slice(start, start + limit),
      total: list.length,
    }),
    render: (project) =>
      node(
        "span",
        { class: "source-label" },
        node("strong", {}, project.name),
        node(
          "small",
          {},
          project.backendName || context.backendName || context.backendId,
          project.archived ? " · Archived" : "",
          nameCounts.get(project.name) > 1 && project.cwd
            ? " · " + project.cwd
            : "",
        ),
      ),
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
    "newCollection",
    "collectionMenu",
    "newItem",
    "identifiers",
    "importReferences",
    "attachment",
    "note",
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
  ]) {
    $("#" + id).disabled = !available;
  }
  $("#libraryMenu").disabled = !currentProject();
  for (const option of $("#actions").options)
    option.disabled = !!option.value && option.value !== "export" && !editable;
  $("#actions").disabled = !available;
}
$("#libraryMenu").onclick = () => {
  const project = currentProject();
  if (!project) return;
  if (detailDirty && !confirm("Discard unsaved item changes?")) return;
  manageLibrary({
    api,
    project,
    onRetired: () => {
      appRetired = true;
      detailDirty = false;
      ++view;
      detailController?.abort();
      rangeController?.abort();
      jobListController?.abort();
      clearTimeout(jobTimer);
      items?.destroy();
      collections?.destroy();
      projectList?.destroy();
      scope = null;
      $("#app").replaceChildren(
        node(
          "p",
          { class: "empty-details" },
          "This library needs to be reopened. Use the dialog, or open References again from BashKitten.",
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
    target: collection,
    onJob: (job) => trackJob(id, job),
  });
};
$("#exportReferences").onclick = () => {
  if (!scope || !projectReady) return;
  const id = projectId,
    version = items.version ?? undefined,
    order = { sort, direction, version },
    selections = [],
    projectName = currentProject()?.name || "this library";
  if (selection.size)
    selections.push({
      label: selection.size + " selected references",
      selection: { scope: "selected", keys: [...selection.keys()], version },
    });
  if (activeSearch || collection || deleted)
    selections.push({
      label:
        (deleted
          ? "Deleted items"
          : activeSearch
            ? "Search results"
            : "Collection") +
        (collection ? " · " + collection.data.name : "") +
        (activeSearch ? " · “" + activeSearch + "”" : ""),
      selection: {
        scope: "search",
        q: activeSearch,
        collection: collection?.key,
        deleted: deleted ? 1 : 0,
        ...order,
      },
    });
  if (collection && activeSearch && !deleted)
    selections.push({
      label: "Entire collection · " + collection.data.name,
      selection: { scope: "collection", collection: collection.key, ...order },
    });
  selections.push({
    label: "Entire library · " + projectName + " (excluding deleted items)",
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
  rangeController?.abort();
  jobListController?.abort();
  items?.destroy();
  collections?.destroy();
  $("#items").replaceChildren();
  $("#collections").replaceChildren();
  selection.clear();
  collection = null;
  deleted = false;
  detail = null;
  detailDirty = false;
  projectId = id;
  projectReady = false;
  projectList.setSelection([id]);
  scope = api.project(id);
  updateProjectActions();
  notify("Loading library…");
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
    collections = new Collections({
      element: $("#collections"),
      api: scope,
      onSelect: (item) => {
        collection = item;
        deleted = false;
        rangeController?.abort();
        selection.clear();
        items.reset({ preserveSelection: false });
        notify(item ? "Collection: " + item.data.name : "All references");
      },
    });
    items = new VirtualList({
      element: $("#items"),
      label: "Library items",
      load: (args) => loadPage(args),
      render: itemLabel,
      onSelect: selectItem,
      onActivate: (item) => {
        void openDetail(item.key);
        pane("details");
      },
      onStatus: (text, error) => {
        if (error) notify(error);
        else
          notify(
            text ||
              (selection.size
                ? selection.size + " selected"
                : "Library ready."),
          );
      },
    });
    notify("Library ready.");
    projectReady = true;
    updateProjectActions();
    void restoreJobs(id, generation);
    pollJobs();
  } catch (error) {
    if (generation === view) notify(error);
  }
}
function loadPage({ start, limit, cursor, signal }) {
  return scope.request(
    "items?" +
      query({
        q: activeSearch,
        collection: collection?.key,
        sort,
        direction,
        start,
        limit,
        cursor,
        deleted: deleted ? 1 : undefined,
      }),
    { signal },
  );
}
async function selectItem(item, event) {
  event.toggle ||= $("#multiSelect").checked;
  if (
    detailDirty &&
    detail?.key !== item.key &&
    !confirm("Discard unsaved item changes?")
  )
    return;
  if (detailDirty && detail?.key !== item.key) detailDirty = false;
  rangeController?.abort();
  if (
    event.range &&
    anchor?.view === view &&
    anchor.generation === items.generation
  ) {
    const from = Math.min(anchor.index, event.index),
      to = Math.max(anchor.index, event.index),
      generation = view,
      controller = (rangeController = new AbortController());
    selection.clear();
    try {
      for await (const page of items.range(from, to, {
        signal: controller.signal,
      })) {
        if (generation !== view || controller.signal.aborted) return;
        for (const record of page)
          selection.set(record.key, selectedIdentity(record));
        items.setSelection(selection.keys());
        notify(selection.size + " selected");
      }
    } catch (error) {
      if (generation === view && !controller.signal.aborted) {
        selection.clear();
        items.setSelection([]);
        notify(error);
      }
      return;
    }
  } else {
    anchor = { index: event.index, view, generation: items.generation };
    if (!event.toggle) selection.clear();
    if (event.toggle && selection.has(item.key)) selection.delete(item.key);
    else selection.set(item.key, selectedIdentity(item));
    items.setSelection(selection.keys());
    notify(selection.size + " selected");
  }
  if (selection.has(item.key) && !detailDirty) await openDetail(item.key);
}
const searchChanged = debounce(() => {
  activeSearch = $("#search").value;
  rangeController?.abort();
  selection.clear();
  items?.reset({ preserveSelection: false });
});
$("#search").addEventListener("input", () => {
  items?.controller.abort();
  rangeController?.abort();
  searchChanged();
});
$("#refresh").onclick = () => {
  rangeController?.abort();
  items?.reset({ preservePosition: true });
  collections?.refresh();
  if (detail && !detailDirty) void openDetail(detail.key);
};
for (const button of document.querySelectorAll("[data-sort]"))
  button.onclick = () => {
    direction =
      sort === button.dataset.sort && direction === "asc" ? "desc" : "asc";
    sort = button.dataset.sort;
    for (const b of document.querySelectorAll("[data-sort]"))
      b.setAttribute(
        "aria-sort",
        b === button
          ? direction === "asc"
            ? "ascending"
            : "descending"
          : "none",
      );
    items?.reset();
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
  root.append(heading, form, notice);
  const archived = !!currentProject()?.archived;
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
  const type = node("select");
  for (const info of schema.itemTypes)
    type.add(new Option(label("itemTypes", info.itemType), info.itemType));
  type.value = edited.itemType;
  form.append(field("Item type", type));
  const fields = node("div", { class: "metadata-fields" }),
    creatorSection = node("details", { open: true }),
    creatorRows = node("div"),
    creatorActions = node("div", { class: "toolbar" }),
    creatorTitle = node("summary", {}, "Creators");
  creatorSection.append(creatorTitle, creatorRows, creatorActions);
  form.append(creatorSection, fields);
  let creatorStart = 0;
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
      const single = node("input", {
          type: "checkbox",
          checked: !!creator.name,
          "aria-label": "Single-field name",
        }),
        first = node("input", {
          value: creator.name || creator.firstName || "",
          placeholder: creator.name ? "Name" : "First name",
          "aria-label": creator.name ? "Name" : "First name",
        }),
        last = node("input", {
          value: creator.lastName || "",
          placeholder: "Last name",
          "aria-label": "Last name",
          disabled: !!creator.name,
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
                edited.creators.splice(i, 1);
                detailDirty = true;
                renderCreators();
              },
              { "aria-label": "Remove creator" },
            ),
          ),
        ),
      );
    }
    creatorActions.replaceChildren(
      button("Add creator", () => {
        edited.creators.push({
          creatorType: types[0]?.creatorType || "author",
          firstName: "",
          lastName: "",
        });
        creatorStart = Math.floor((edited.creators.length - 1) / 20) * 20;
        detailDirty = true;
        renderCreators();
      }),
      button(
        "Previous",
        () => {
          creatorStart = Math.max(0, creatorStart - 20);
          renderCreators();
        },
        { disabled: creatorStart === 0, "data-read-action": "" },
      ),
      button(
        "Next",
        () => {
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
    fields.replaceChildren();
    const definitions =
      schema.itemTypes.find((x) => x.itemType === edited.itemType)?.fields ||
      [];
    for (const { field: name } of definitions) {
      if (name === "abstractNote") continue;
      const input = node(name === "extra" ? "textarea" : "input", {
        value: edited[name] || "",
      });
      input.oninput = () => {
        edited[name] = input.value;
        detailDirty = true;
      };
      fields.append(field(label("fields", name), input));
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
  ])
    form.append(node("details", {}, node("summary", {}, heading), input));
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
          button("Remove", () => {
            edited.relations["dc:relation"] = values.filter(
              (value) => value !== id,
            );
            detailDirty = true;
            renderRelated();
          }),
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
      const selected = await chooseLibraryItem(targetScope);
      if (!selected || selected.id === item.id) return;
      const values = new Set([].concat(edited.relations["dc:relation"] || []));
      values.add(selected.id);
      edited.relations["dc:relation"] = [...values];
      relationNames.set(selected.id, title(selected));
      detailDirty = true;
      renderRelated();
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
    form.append(field("Note", note));
  }
  const save = node(
    "button",
    { type: "submit", class: "primary" },
    "Save changes",
  );
  form.append(
    node(
      "div",
      { class: "toolbar" },
      save,
      button(
        "Reload item",
        () => {
          if (!detailDirty || confirm("Discard unsaved item changes?"))
            void openDetail(item.key, true);
        },
        { "data-read-action": "" },
      ),
    ),
  );
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      edited.tags = tags.value
        .split("\n")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map(
          (tag) =>
            item.data.tags?.find((existing) => existing.tag === tag) || { tag },
        );
      const result = await targetScope.request("items/" + item.key, {
        method: "PUT",
        body: { version: item.version, data: edited },
      });
      if (scope === targetScope && root.contains(form) && detail === item) {
        detailDirty = false;
        detail = result;
        renderDetail(result, targetScope);
        items.reset({ preservePosition: true });
        notify("Item saved.");
      }
    } catch (error) {
      notice.textContent =
        error.status === 412
          ? "This item changed elsewhere. Your edits are kept here; reload before saving a revised version."
          : error.message;
    } finally {
      save.disabled = false;
    }
  };
  const attachments = node("details", { open: true }),
    children = node("div");
  attachments.append(
    node("summary", {}, "Attachments and notes"),
    children,
    button("Add attachment", () => uploadDialog(item.key, targetScope), {
      disabled: archived,
    }),
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
$("#newCollection").onclick = async () => {
  if (!scope) return;
  const targetScope = scope,
    parent = collections.parent;
  const input = node("input", {
      required: true,
      placeholder: "Collection name",
    }),
    form = await promptFields("New collection", [field("Name", input)]);
  if (!form) return;
  try {
    await targetScope.request("collections", {
      method: "POST",
      body: { name: input.value, parentCollection: parent },
    });
    if (scope === targetScope) collections.refresh();
  } catch (error) {
    notify(error);
  }
};
$("#collectionMenu").onclick = async () => {
  if (!collection) {
    notify("Select a collection first.");
    return;
  }
  const target = collection,
    targetScope = scope,
    name = node("input", { value: target.data.name, required: true }),
    d = dialog("Collection");
  let parentKey = target.data.parentCollection || null;
  const parentLabel = node(
      "span",
      {},
      parentKey ? "Current parent collection" : "Top level",
    ),
    parentRows = node("div", { class: "search-results" });
  const parentPicker = new Collections({
    element: parentRows,
    api: targetScope,
    onSelect: (item) => {
      parentKey = item?.key || null;
      parentLabel.textContent = item?.data.name || "Top level";
    },
  });
  d.body.append(
    field("Name", name),
    node("h3", {}, "Parent collection"),
    parentLabel,
    parentRows,
  );
  d.el.addEventListener("close", () => parentPicker.destroy(), { once: true });
  d.actions.append(
    button("Cancel", () => d.el.close()),
    button(
      "Delete collection",
      async () => {
        if (!confirm("Delete this collection? Its items stay in the library."))
          return;
        try {
          await targetScope.request("collections/" + target.key, {
            method: "DELETE",
            body: { version: target.version },
          });
          d.el.close();
          if (scope === targetScope) {
            collection = null;
            collections.refresh();
            items.reset();
          }
        } catch (e) {
          d.notice.textContent = e.message;
        }
      },
      { class: "danger" },
    ),
    button(
      "Save",
      async () => {
        try {
          const updated = await targetScope.request(
            "collections/" + target.key,
            {
              method: "PUT",
              body: {
                version: target.version,
                data: {
                  name: name.value,
                  parentCollection: parentKey,
                },
              },
            },
          );
          d.el.close();
          if (scope === targetScope) {
            collection = updated;
            collections.refresh();
          }
        } catch (e) {
          d.notice.textContent = e.message;
        }
      },
      { class: "primary" },
    ),
  );
  d.open();
};
$("#newItem").onclick = async () => {
  if (!schema) return;
  const targetScope = scope,
    collectionKey = collection?.key;
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
            collections: collectionKey ? [collectionKey] : [],
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
$("#note").onclick = async () => {
  if (!scope) return;
  const targetScope = scope,
    collectionKey = collection?.key;
  const text = node("textarea", { rows: 8, required: true }),
    name = node("input", { placeholder: "Note title" }),
    parent = selection.size === 1 ? [...selection.keys()][0] : null;
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
            collections: collectionKey ? [collectionKey] : [],
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
    targetCollection = collection,
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
          "Destination: " + (targetCollection?.data.name || "All references"),
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
        target: targetCollection?.key || null,
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
  if (!action) return;
  if (!selection.size) {
    notify("Select one or more items first.");
    return;
  }
  const id = projectId,
    targetScope = scope,
    selected = [...selection.values()];
  let collectionKey = collection?.key;
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
    if (action === "collection") {
      const destination = await chooseCollection(targetScope);
      if (!destination) return;
      collectionKey = destination.key;
    }
    if (
      action === "delete" &&
      !confirm("Move " + selected.length + " selected items to deleted items?")
    )
      return;
    if (["collection", "remove-collection"].includes(action) && !collectionKey)
      throw Error("Select the destination collection first.");
    const operation = action === "collection" ? "add-collection" : action;
    trackJob(
      id,
      await targetScope.request("items/manage", {
        method: "POST",
        body: {
          operation,
          collection: collectionKey,
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
          if (job.kind === "file-import") collections?.refresh();
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
        { class: "collection-label" },
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
        `${result.result.count} reference${result.result.count === 1 ? "" : "s"} imported; ${result.result.collections || 0} collection${result.result.collections === 1 ? "" : "s"} imported.`,
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
$("#attachment").onclick = () =>
  uploadDialog(selection.size === 1 ? [...selection.keys()][0] : null);

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
    const form = node(
      "form",
      {},
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
    targetCollection = collection,
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
      "Import destination: " +
        (targetCollection?.data.name || "All references"),
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
            target: targetCollection?.key || null,
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
          target: targetCollection?.key || null,
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

async function chooseCollection(targetScope) {
  const d = dialog("Choose collection"),
    rows = node("div", { class: "search-results" });
  let selected,
    accepted = false;
  d.body.append(rows);
  const tree = new Collections({
    element: rows,
    api: targetScope,
    onSelect: (item) => (selected = item),
  });
  d.actions.append(
    button("Cancel", () => d.el.close()),
    button(
      "Choose",
      () => {
        if (selected) {
          accepted = true;
          d.el.close();
        }
      },
      { class: "primary" },
    ),
  );
  const result = new Promise((resolve) =>
    d.el.addEventListener(
      "close",
      () => {
        tree.destroy();
        resolve(accepted ? selected : null);
      },
      { once: true },
    ),
  );
  d.open();
  return result;
}

async function chooseLibraryItem(targetScope) {
  const d = dialog("Choose related item"),
    search = node("input", { type: "search", "aria-label": "Search library" }),
    rows = node("div", { class: "search-results" });
  let selected = null,
    accepted = false,
    term = "";
  d.body.append(search, rows);
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
    onSelect: (item) => {
      selected = item;
      list.setSelection([item.key]);
    },
    onActivate: (item) => {
      selected = item;
      accepted = true;
      d.el.close();
    },
  });
  const change = debounce(() => {
    term = search.value;
    list.reset({ preserveSelection: false });
  });
  search.oninput = () => {
    list.controller.abort();
    change();
  };
  d.actions.append(
    button("Cancel", () => d.el.close()),
    button(
      "Choose",
      () => {
        if (selected) {
          accepted = true;
          d.el.close();
        }
      },
      { class: "primary" },
    ),
  );
  const result = new Promise((resolve) =>
    d.el.addEventListener(
      "close",
      () => {
        list.destroy();
        change.cancel();
        resolve(accepted ? selected : null);
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
  collection = null;
  selection.clear();
  rangeController?.abort();
  items.reset({ preserveSelection: false });
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
          collection: collection?.key,
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
          collection = data.collection
            ? await targetScope.request("collections/" + data.collection)
            : null;
          if (scope !== targetScope) return;
          selection.clear();
          items.reset({ preserveSelection: false });
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
  initial = { id: "apa", locale: "en-US" },
) {
  const d = dialog("Citation style"),
    search = node("input", {
      type: "search",
      placeholder: "Search installed styles",
    }),
    rows = node("div", { class: "search-results" }),
    locale = node("select");
  let chosen = initial.id,
    accepted = false,
    term = "";
  d.body.append(field("Find a style", search), rows, field("Language", locale));
  const list = new VirtualList({
    element: rows,
    label: "Citation styles",
    key: (item) => item.id,
    load: async ({ start, limit, signal }) => {
      const result = await targetScope.request(
        "styles?" + query({ query: term, start, limit }),
        { signal },
      );
      return {
        ...result,
        hasMore: result.nextStart !== null && result.nextStart !== undefined,
      };
    },
    render: (item) => node("span", { class: "collection-label" }, item.title),
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
    const options = await targetScope.request("citation-options", {
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
