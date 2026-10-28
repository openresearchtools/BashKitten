/*
 * Copyright © 2009 Center for History and New Media, George Mason University.
 * BashKitten web adaptation, 2026. SPDX-License-Identifier: AGPL-3.0-or-later
 * Behavior port of Zotero 7.0.32 addCitationDialog.js/.xhtml, exact donor
 * 188c54c186fbbaa6889145986d43ba64160a44fa, preserved in vendor/classic-dialog.
 * Native DOM replaces XUL; API pages replace Zotero's native virtualized trees.
 * The caller retains the explicit document/view and owns the final mutation.
 */
import {
  node,
  button,
  dialog,
  field,
  title,
  creators,
  year,
  query,
  debounce,
  renderedHTML,
} from "./common.js";
import { VirtualList } from "./virtual-list.js";
import { Collections } from "./collections.js";
export async function chooseCitation({
  api,
  projectId,
  initial,
  style = { id: "apa", locale: "en-US" },
  signal,
  preview,
  embeddedItems,
} = {}) {
  if (!api || !projectId) throw Error("A project library is required");
  signal?.throwIfAborted();
  const scoped = api.project(projectId),
    controller = new AbortController(),
    d = dialog("Add / Edit Citation");
  d.el.classList.add("citation-dialog");
  const initialItems = structuredClone(initial?.items || []),
    snapshotItems = Object.create(null),
    cluster = {
      ...structuredClone(initial || {}),
      id: initial?.id || crypto.randomUUID(),
      items: initialItems,
    };
  let multiple = initialItems.length > 1,
    serial = 0,
    active = -1,
    librarySelection = new Map(),
    selectionAnchor = 0,
    rangeController = null,
    collection = null,
    previewGeneration = 0,
    previewController = null,
    previewResult = null,
    accepted = false,
    loadingInitial = true;
  let searchTerm = "";
  let sources = initialItems.map((item) => ({
    uid: ++serial,
    citation: item,
    item: null,
  }));
  const body = node("div", { class: "citation-layout" }),
    collectionPane = node("section", {
      class: "citation-collections",
      "aria-label": "Collections",
    }),
    libraryPane = node("section", {
      class: "citation-library",
      "aria-label": "Library references",
    }),
    selectedPane = node("section", {
      class: "citation-selected",
      "aria-label": "Citation sources",
    }),
    search = node("input", {
      type: "search",
      placeholder: "Title, creator, year, fields or tags",
      "aria-label": "Search references",
    }),
    libraryRows = node("div", { class: "citation-results" }),
    selectedRows = node("div", { class: "citation-results" });
  const mode = button("Multiple sources", () => toggleMode()),
    sort = node("input", { type: "checkbox", checked: !initial?.unsorted }),
    sortLabel = field("Keep sources sorted by style", sort),
    add = button("Add →", () => addSelected()),
    remove = button("Remove", () => removeSelected()),
    up = button("Move up", () => move(-1)),
    down = button("Move down", () => move(1));
  const sourceActions = node(
    "div",
    { class: "toolbar" },
    add,
    remove,
    up,
    down,
  );
  selectedPane.append(
    node("h3", {}, "Citation sources"),
    sortLabel,
    selectedRows,
    sourceActions,
  );
  libraryPane.append(field("Search this library", search), libraryRows);
  body.append(collectionPane, libraryPane, selectedPane);
  d.body.append(body);
  const inputs = {
    prefix: node("input", { type: "text" }),
    suffix: node("input", { type: "text" }),
    label: node("select", { "aria-label": "Locator type" }),
    locator: node("input", { type: "text" }),
    suppressAuthor: node("input", { type: "checkbox" }),
  };
  const controls = node(
    "div",
    { class: "citation-fields" },
    field("Prefix", inputs.prefix),
    field("Suffix", inputs.suffix),
    field("Locator type", inputs.label),
    field("Locator", inputs.locator),
    field("Suppress author", inputs.suppressAuthor),
  );
  d.body.append(controls);
  const previewBox = node("section", {
      class: "citation-preview",
      "aria-label": "Citation preview",
      "aria-live": "polite",
    }),
    previewNotice = node("p", { class: "notice", role: "status" }),
    previewToggle = button("Hide preview", () => {
      previewBox.hidden = !previewBox.hidden;
      previewToggle.textContent = previewBox.hidden
        ? "Show preview"
        : "Hide preview";
    });
  d.body.append(previewBox, previewNotice);
  const customEnabled = node("input", {
    type: "checkbox",
    checked: !!(cluster.customHTML || cluster.customText),
  });
  const editor = node("div", {
    class: "citation-preview custom-preview",
    contenteditable: "true",
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": "Custom citation preview",
    hidden: !customEnabled.checked,
  });
  if (cluster.customHTML) renderedHTML(editor, cluster.customHTML);
  else editor.textContent = cluster.customText || "";
  const customControls = node(
    "div",
    { class: "toolbar" },
    field("Edit preview", customEnabled),
  );
  for (const [label, command] of [
    ["Bold", "bold"],
    ["Italic", "italic"],
    ["Superscript", "superscript"],
    ["Subscript", "subscript"],
  ]) {
    const control = button(
      label,
      () => {
        editor.focus();
        document.execCommand(command);
      },
      { "aria-label": label, disabled: !customEnabled.checked },
    );
    control.addEventListener("mousedown", (event) => event.preventDefault());
    customControls.append(control);
  }
  d.body.append(customControls, editor);
  customEnabled.addEventListener("change", () => {
    editor.hidden = !customEnabled.checked;
    for (const control of customControls.querySelectorAll("button"))
      control.disabled = !customEnabled.checked;
    if (customEnabled.checked) {
      renderedHTML(editor, previewResult?.html || "");
      if (!previewResult?.html) editor.textContent = previewResult?.text || "";
      editor.focus();
    } else {
      delete cluster.customHTML;
      delete cluster.customText;
      invalidatePreview();
    }
  });
  editor.addEventListener("input", () => {
    cluster.customHTML = editor.innerHTML;
    delete cluster.customText;
    invalidatePreview();
  });
  const confirm = button("Confirm", () => finish(), {
    class: "primary",
    disabled: true,
  });
  d.actions.append(
    mode,
    previewToggle,
    button("Cancel", () => d.el.close()),
    confirm,
  );
  const selectedList = new VirtualList({
    element: selectedRows,
    label: "Selected citation sources",
    rowHeight: 48,
    pageSize: 80,
    total: sources.length,
    key: (entry) => entry.uid,
    load: async ({ start, limit }) => ({
      items: sources.slice(start, start + limit),
      total: sources.length,
      hasMore: start + limit < sources.length,
    }),
    render: (entry) =>
      node(
        "span",
        { class: "source-label" },
        node("strong", {}, entry.item ? title(entry.item) : entry.citation.id),
        node(
          "small",
          {},
          entry.item
            ? [creators(entry.item), year(entry.item)]
                .filter(Boolean)
                .join(" · ")
            : "Loading reference…",
        ),
      ),
    onSelect: (entry) => {
      active = sources.findIndex((x) => x.uid === entry.uid);
      librarySelection.clear();
      library.setSelection([]);
      updateControls();
    },
    onStatus: () => {},
  });
  const library = new VirtualList({
    element: libraryRows,
    label: "Search results",
    rowHeight: 48,
    load: (args) =>
      scoped.request(
        "items?" +
          query({
            q: searchTerm,
            collection: collection?.key,
            sort: "title",
            start: args.start,
            limit: args.limit,
            cursor: args.cursor,
          }),
        { signal: args.signal },
      ),
    render: (item) =>
      node(
        "span",
        { class: "source-label", title: title(item) + " · " + creators(item) },
        node("strong", {}, title(item)),
        node(
          "small",
          {},
          [creators(item), year(item)].filter(Boolean).join(" · "),
        ),
      ),
    onSelect: async (item, event) => {
      rangeController?.abort();
      rangeController = null;
      if (!event.range || !multiple) selectionAnchor = event.index;
      if (!multiple) {
        const previous = sources[0]?.citation || {};
        sources = [
          { uid: ++serial, citation: { ...previous, id: item.id }, item },
        ];
        active = 0;
        librarySelection = new Map([[item.key, item]]);
        changed();
      } else if (event.range) {
        const current = (rangeController = new AbortController());
        librarySelection.clear();
        library.setSelection([]);
        active = -1;
        updateControls();
        try {
          for await (const page of library.range(
            Math.min(selectionAnchor, event.index),
            Math.max(selectionAnchor, event.index),
            { signal: current.signal },
          )) {
            for (const record of page) librarySelection.set(record.key, record);
            library.setSelection(librarySelection.keys());
            d.notice.textContent =
              librarySelection.size + " references selected";
          }
        } catch (error) {
          if (error.name !== "AbortError" && rangeController === current) {
            librarySelection.clear();
            library.setSelection([]);
            d.notice.textContent = error.message;
          }
        } finally {
          if (rangeController === current) {
            rangeController = null;
            updateControls();
          }
        }
        return;
      } else {
        if (!event.toggle) librarySelection.clear();
        if (event.toggle && librarySelection.has(item.key))
          librarySelection.delete(item.key);
        else librarySelection.set(item.key, item);
        active = -1;
        updateControls();
      }
      library.setSelection(librarySelection.keys());
    },
    onActivate: () => {
      if (multiple) addSelected();
      else if (!confirm.disabled) finish();
    },
    onStatus: (text, error) => {
      if (error) d.notice.textContent = text;
    },
  });
  const collections = new Collections({
    element: collectionPane,
    api: scoped,
    onSelect: (item) => {
      collection = item;
      rangeController?.abort();
      rangeController = null;
      selectionAnchor = 0;
      librarySelection.clear();
      library.reset({ preserveSelection: false });
      updateControls();
    },
  });
  const searchChanged = debounce(() => {
    searchTerm = search.value;
    selectionAnchor = 0;
    librarySelection.clear();
    library.reset({ preserveSelection: false });
    updateControls();
  });
  search.addEventListener("input", () => {
    rangeController?.abort();
    rangeController = null;
    library.controller.abort();
    searchChanged();
  });
  function snapshot() {
    return {
      ...cluster,
      items: sources.map(({ citation }) => {
        const item = { id: citation.id };
        for (const key of ["prefix", "suffix", "locator", "label"])
          if (citation[key]) item[key] = citation[key];
        if (!item.locator) delete item.label;
        if (citation.suppressAuthor || citation["suppress-author"])
          item.suppressAuthor = true;
        return item;
      }),
      unsorted: !sort.checked,
    };
  }
  function updateControls() {
    selectedPane.hidden = !multiple;
    mode.textContent = multiple ? "Single source" : "Multiple sources";
    mode.disabled = multiple && sources.length > 1;
    add.disabled = !multiple || !librarySelection.size || !!rangeController;
    remove.disabled = active < 0;
    up.disabled = active <= 0;
    down.disabled = active < 0 || active >= sources.length - 1;
    const source = sources[active];
    for (const [key, input] of Object.entries(inputs)) {
      input.disabled = !source;
      const value =
        source?.citation[key] ??
        (key === "label"
          ? "page"
          : key === "suppressAuthor"
            ? !!source?.citation["suppress-author"]
            : "");
      if (input.type === "checkbox") input.checked = !!value;
      else input.value = value;
    }
    if (active >= 0) selectedList.focusIndex = active;
    selectedList.setSelection(source ? [source.uid] : []);
    confirm.disabled =
      loadingInitial ||
      !sources.length ||
      sources.some((s) => !s.item) ||
      !previewResult;
  }
  function redrawSources() {
    const scroll = selectedList.root.scrollTop;
    selectedList.reset({ preserveSelection: false, total: sources.length });
    selectedList.root.scrollTop = scroll;
    if (active >= 0) {
      const top = active * selectedList.rowHeight;
      if (top < selectedList.root.scrollTop) selectedList.root.scrollTop = top;
      else if (
        top + selectedList.rowHeight >
        selectedList.root.scrollTop + selectedList.root.clientHeight
      )
        selectedList.root.scrollTop =
          top + selectedList.rowHeight - selectedList.root.clientHeight;
    }
    updateControls();
  }
  function invalidatePreview() {
    ++previewGeneration;
    previewController?.abort();
    previewResult = null;
    confirm.disabled = true;
    schedulePreview();
  }
  function regenerateCustom() {
    if (
      (cluster.customHTML || cluster.customText) &&
      window.confirm(
        "Regenerate your edited preview using the changed citation?",
      )
    ) {
      delete cluster.customHTML;
      delete cluster.customText;
      customEnabled.checked = false;
      for (const control of customControls.querySelectorAll("button"))
        control.disabled = true;
      editor.hidden = true;
    }
  }
  function changed() {
    regenerateCustom();
    redrawSources();
    invalidatePreview();
  }
  function toggleMode() {
    if (multiple && sources.length > 1) return;
    rangeController?.abort();
    rangeController = null;
    multiple = !multiple;
    if (!multiple && sources.length) active = 0;
    updateControls();
    schedulePreview();
  }
  function addSelected() {
    if (!librarySelection.size || rangeController) return;
    for (const item of librarySelection.values())
      sources.push({ uid: ++serial, item, citation: { id: item.id } });
    active = sources.length - 1;
    librarySelection.clear();
    library.setSelection([]);
    changed();
  }
  function removeSelected() {
    if (active < 0) return;
    sources.splice(active, 1);
    active = Math.min(active, sources.length - 1);
    changed();
  }
  function move(direction) {
    const next = active + direction;
    if (active < 0 || next < 0 || next >= sources.length) return;
    [sources[active], sources[next]] = [sources[next], sources[active]];
    active = next;
    sort.checked = false;
    changed();
  }
  for (const [key, input] of Object.entries(inputs))
    input.addEventListener("input", () => {
      if (!sources[active]) return;
      sources[active].citation[key] =
        input.type === "checkbox" ? input.checked : input.value;
      if (key === "suppressAuthor")
        delete sources[active].citation["suppress-author"];
      regenerateCustom();
      invalidatePreview();
    });
  sort.addEventListener("change", () => {
    regenerateCustom();
    invalidatePreview();
  });
  function applySorted(sortedItems) {
    if (
      !sort.checked ||
      !Array.isArray(sortedItems) ||
      sortedItems.length !== sources.length
    )
      return;
    // Citeproc sorts occurrences. Equal source identities may carry different locators.
    const signature = (item) =>
      JSON.stringify([
        item.id,
        item.locator || "",
        item.locator ? item.label || "page" : "",
        item.prefix || "",
        item.suffix || "",
        !!(item.suppressAuthor || item["suppress-author"]),
      ]);
    const buckets = new Map();
    for (const source of sources) {
      const key = signature(source.citation);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(source);
    }
    const reordered = sortedItems.map((item) =>
      buckets.get(signature(item))?.shift(),
    );
    if (reordered.some((item) => !item)) return;
    const selected = sources[active]?.uid;
    sources = reordered;
    active = sources.findIndex((source) => source.uid === selected);
    redrawSources();
  }
  const schedulePreview = debounce(async () => {
    const generation = previewGeneration;
    previewController?.abort();
    previewController = new AbortController();
    const previewSignal = AbortSignal.any([
      controller.signal,
      previewController.signal,
    ]);
    previewNotice.textContent = "Updating preview…";
    try {
      if (!sources.length) {
        previewBox.replaceChildren();
        previewNotice.textContent = "Choose a reference.";
        return;
      }
      const value = snapshot(),
        result = preview
          ? await preview(value, { style, signal: previewSignal })
          : await scoped
              .request("citations/render", {
                method: "POST",
                body: {
                  version: 1,
                  style,
                  citations: [{ ...value, noteIndex: value.noteIndex || 1 }],
                  ...(embeddedItems
                    ? {
                        metadataSource: "snapshot",
                        embeddedItems: snapshotItems,
                      }
                    : {}),
                },
                signal: previewSignal,
              })
              .then((result) => ({
                ...result.citations[0],
                sortable: result.style.sortable,
              }));
      if (previewSignal.aborted || generation !== previewGeneration) return;
      previewResult = result;
      renderedHTML(previewBox, result.html || "");
      if (!result.html) previewBox.textContent = result.text || "";
      if (typeof result.sortable === "boolean") {
        sortLabel.hidden = !result.sortable;
        if (!result.sortable) sort.checked = false;
      }
      applySorted(result.sortedItems);
      previewNotice.textContent = "";
      updateControls();
    } catch (error) {
      if (!previewSignal.aborted && generation === previewGeneration) {
        previewNotice.textContent = error.message;
        previewResult = null;
        updateControls();
      }
    }
  });
  async function finish() {
    if (confirm.disabled) return;
    confirm.disabled = true;
    accepted = true;
    d.el.close();
  }
  const abort = () => d.el.close();
  signal?.addEventListener("abort", abort, { once: true });
  const completion = new Promise((resolve) =>
    d.el.addEventListener(
      "close",
      () => {
        controller.abort();
        rangeController?.abort();
        previewController?.abort();
        searchChanged.cancel();
        schedulePreview.cancel();
        library.destroy();
        selectedList.destroy();
        collections.destroy();
        signal?.removeEventListener("abort", abort);
        resolve(accepted ? snapshot() : null);
      },
      { once: true },
    ),
  );
  d.open();
  search.focus();
  updateControls();
  try {
    const options = await scoped.request(
      "citation-options?" + query({ locale: style.locale }),
      { signal: controller.signal },
    );
    for (const locator of options.locators || [])
      inputs.label.add(new Option(locator.label, locator.id));
    for (const source of sources) {
      controller.signal.throwIfAborted();
      const id = source.citation.id;
      if (embeddedItems && Object.hasOwn(embeddedItems, id)) {
        const snapshot = embeddedItems[id];
        if (
          !snapshot ||
          snapshot.id !== id ||
          typeof snapshot.title !== "string" ||
          !snapshot.type
        )
          throw Error("The document contains an invalid reference snapshot.");
        if (!Array.isArray(options.nameVariables))
          throw Error(
            "Update References to display the document’s snapshot creators.",
          );
        snapshotItems[id] = structuredClone(snapshot);
        // Display-only labels from native CSL name variables. CSL rendering
        // and explicit import still belong to the backend's native adapters.
        source.item = {
          id,
          data: {
            title: snapshot.title,
            date: String(
              snapshot.issued?.["date-parts"]?.[0]?.[0] ??
                snapshot.issued?.literal ??
                snapshot.issued?.raw ??
                "",
            ),
            creators: options.nameVariables.flatMap((role) => {
              const names = snapshot[role] ?? [];
              if (
                !Array.isArray(names) ||
                names.some(
                  (name) =>
                    !name ||
                    typeof name !== "object" ||
                    Array.isArray(name) ||
                    [
                      "literal",
                      "given",
                      "family",
                      "dropping-particle",
                      "non-dropping-particle",
                      "suffix",
                    ].some(
                      (key) =>
                        name[key] !== undefined &&
                        typeof name[key] !== "string",
                    ),
                )
              )
                throw Error(
                  "The document contains invalid " +
                    role +
                    " names in a reference snapshot.",
                );
              return names.map((name) => ({
                creatorType: role,
                name:
                  name.literal ||
                  [
                    name.given,
                    name["dropping-particle"],
                    name["non-dropping-particle"],
                    name.family,
                    name.suffix,
                  ]
                    .filter(Boolean)
                    .join(" "),
              }));
            }),
          },
        };
        continue;
      }
      const key = source.citation.id.split("/").at(-1);
      const item = await scoped.request("items/" + encodeURIComponent(key), {
        signal: controller.signal,
      });
      if (item.id !== source.citation.id)
        throw Error("Citation reference belongs to another library");
      source.item = item;
    }
    if (sources.length) active = 0;
    loadingInitial = false;
    redrawSources();
    invalidatePreview();
  } catch (error) {
    if (!controller.signal.aborted) {
      loadingInitial = false;
      d.notice.textContent = error.message;
      updateControls();
    }
  }
  return completion;
}
