/*
 * Copyright © 2009 Center for History and New Media, George Mason University.
 * BashKitten web adaptation, 2026. SPDX-License-Identifier: AGPL-3.0-or-later
 * Retains pinned classic citation behavior and native CSL processing. The
 * compact table/chip layout follows the user's 28 October UI amendment.
 * The caller owns the captured project, document/view and final mutation.
 */
import {
  node,
  button,
  dialog,
  field,
  title,
  creators,
  year,
  human,
  query,
  debounce,
  renderedHTML,
} from "./common.js";
import { VirtualList } from "./virtual-list.js";

export async function chooseCitation({
  api,
  projectId,
  initial,
  style = { id: "apa", locale: "en-US" },
  signal,
  preview,
  embeddedItems,
} = {}) {
  if (!api || !projectId) throw Error("A project is required");
  signal?.throwIfAborted();
  const scoped = api.project(projectId),
    controller = new AbortController(),
    d = dialog("Add / Edit Citation"),
    phoneLayout = matchMedia("(max-width: 700px)");
  d.el.classList.add("citation-dialog");
  const initialItems = structuredClone(initial?.items || []),
    snapshotItems = Object.create(null),
    cluster = {
      ...structuredClone(initial || {}),
      id: initial?.id || crypto.randomUUID(),
      items: initialItems,
    };
  let serial = 0,
    active = -1,
    librarySelection = new Map(),
    selectionAnchor = null,
    rangeController = null,
    previewGeneration = 0,
    previewController = null,
    previewResult = null,
    queuedConfirm = null,
    autoRegenerate = -1,
    regenerationWork = null,
    accepted = false,
    loadingInitial = true,
    searchTerm = "",
    tableSort = "title",
    tableDirection = "asc",
    selectedList = null,
    sourceDialog = null,
    sourceHeading = null;
  let sources = initialItems.map((item) => ({
    uid: ++serial,
    citation: item,
    item: null,
  }));
  const children = new Set(),
    extraColumns = new Map(),
    columnPreferences = { phone: new Map(), wide: new Map() };
  let tableWidths = [], columnDrag = null, lastTableLayout = "";
  const defaultColumns = [
    { id: "title", label: "Title", width: 300, minWidth: 80, sort: "title" },
    { id: "creator", label: "Authors", width: 220, minWidth: 70, sort: "creator" },
    { id: "year", label: "Year", width: 54, minWidth: 44, sort: "year" },
  ];
  const chips = node("div", {
      class: "citation-chips",
      "aria-label": "Selected citation sources",
    }),
    search = node("input", {
      type: "search",
      placeholder: "Search this project's references",
      "aria-label": "Search references",
    }),
    addSelection = button("Add selected", () => addSelected(), {
      hidden: true,
    }),
    columnButton = button("Columns", () => void chooseColumns()),
    searchRow = node(
      "div",
      { class: "citation-search" },
      search,
      addSelection,
      columnButton,
    ),
    libraryRows = node("div", { class: "citation-table" }),
    tableHeader = node("div", {
      class: "citation-table-header",
      role: "row",
      "aria-label": "Reference columns",
    }),
    previewBox = node("section", {
      class: "citation-preview",
      "aria-label": "Citation preview",
      "aria-live": "polite",
    }),
    previewNotice = node("p", { class: "notice", role: "status" });
  d.body.append(chips, searchRow, libraryRows, previewBox, previewNotice);

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
  const remove = button("Remove source", () => removeSelected()),
    up = button("↑", () => move(-1), {
      "aria-label": "Move up",
      title: "Move up",
    }),
    down = button("↓", () => move(1), {
      "aria-label": "Move down",
      title: "Move down",
    }),
    sourceActions = node("div", { class: "toolbar" }, remove, up, down);
  const sort = node("input", { type: "checkbox", checked: !initial?.unsorted }),
    sortLabel = field("Sort by style", sort),
    editor = node("div", {
      class: "citation-preview custom-preview",
      contenteditable: "true",
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": "Custom citation preview",
    }),
    customControls = node("div", { class: "toolbar" });
  for (const [label, command] of [
    ["Bold", "bold"],
    ["Italic", "italic"],
    ["Superscript", "superscript"],
    ["Subscript", "subscript"],
  ]) {
    const control = button(label, () => {
      editor.focus();
      document.execCommand(command);
    });
    control.addEventListener("mousedown", (event) => event.preventDefault());
    customControls.append(control);
  }
  editor.addEventListener("input", () => {
    cluster.customHTML = editor.innerHTML;
    delete cluster.customText;
    invalidatePreview();
  });
  const editPreview = button("Edit preview", () => openPreviewEditor()),
    confirm = button("Confirm", () => finish(), {
      class: "primary",
      disabled: true,
    });
  d.actions.append(
    sortLabel,
    editPreview,
    button("Cancel", () => d.el.close()),
    confirm,
  );

  function childDialog(label) {
    const child = dialog(label);
    child.el.classList.add("citation-tool-dialog");
    for (const name of ["pointerdown", "keydown", "input"])
      child.el.addEventListener(
        name,
        () => {
          queuedConfirm = null;
        },
        { capture: true },
      );
    children.add(child);
    child.el.addEventListener("close", () => children.delete(child), {
      once: true,
    });
    return child;
  }
  function columns() {
    return [...defaultColumns, ...extraColumns.values()];
  }
  function cellValue(item, column) {
    if (column.id === "title") return title(item);
    if (column.id === "creator") return creators(item);
    if (column.id === "year") return year(item);
    return String(item.data?.[column.id] ?? "");
  }
  function minimumWidth(column) {
    return column.minWidth || 80;
  }
  function rememberColumnWidths() {
    const saved = columnPreferences[phoneLayout.matches ? "phone" : "wide"];
    columns().forEach((column, index) => saved.set(column.id, tableWidths[index]));
  }
  function applyColumnWidths(widths) {
    tableWidths = widths;
    libraryRows.style.setProperty(
      "--citation-columns", widths.map((width) => width + "px").join(" ") + " 44px",
    );
    libraryRows.style.setProperty(
      "--citation-table-width", widths.reduce((sum, width) => sum + width, 44) + "px",
    );
    for (const separator of tableHeader.querySelectorAll("[data-citation-resize]")) {
      const index = Number(separator.dataset.citationResize), list = columns();
      separator.setAttribute("aria-valuenow", String(Math.round(widths[index])));
      separator.setAttribute("aria-valuemin", String(minimumWidth(list[index])));
      separator.setAttribute("aria-valuemax", String(Math.round(
        widths[index] + widths[index + 1] - minimumWidth(list[index + 1]),
      )));
    }
  }
  function layoutColumns(force = false) {
    if (columnDrag) return;
    const width = library.root.clientWidth || (phoneLayout.matches ? 320 : 700),
      mode = phoneLayout.matches ? "phone" : "wide",
      list = columns(),
      signature = [mode, width, ...list.map((column) => column.id)].join(":");
    if (!force && signature === lastTableLayout) return;
    lastTableLayout = signature;
    const saved = columnPreferences[mode],
      total = Math.max(194, width - 44),
      yearWidth = phoneLayout.matches ? 46 : 54,
      normal = [Math.round((total - yearWidth) * 0.58), 0, yearWidth];
    normal[1] = total - normal[0] - normal[2];
    let defaults = defaultColumns.map((column, index) => saved.get(column.id) || normal[index]);
    const savedTotal = defaults.reduce((sum, value) => sum + value, 0);
    defaults = defaults.map((value, index) => Math.max(
      minimumWidth(defaultColumns[index]), value / savedTotal * total,
    ));
    // Distribute only the default fields inside the viewport. Optional metadata
    // adds horizontal space; its add column remains sticky at the visible edge.
    let spare = total - defaults.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < defaults.length && spare < -0.01; index++) {
      const shrink = Math.min(-spare, defaults[index] - minimumWidth(defaultColumns[index]));
      defaults[index] -= shrink;
      spare += shrink;
    }
    defaults[0] += Math.max(0, spare);
    applyColumnWidths([...defaults, ...list.slice(3).map((column) =>
      Math.max(minimumWidth(column), saved.get(column.id) || column.width),
    )]);
  }
  function resizeColumn(index, delta, widths = tableWidths) {
    const list = columns(), sum = widths[index] + widths[index + 1],
      left = Math.max(minimumWidth(list[index]), Math.min(
        sum - minimumWidth(list[index + 1]), widths[index] + delta,
      )),
      changed = [...widths];
    changed[index] = left;
    changed[index + 1] = sum - left;
    applyColumnWidths(changed);
    rememberColumnWidths();
  }
  function columnSeparator(column, index) {
    const separator = node("span", {
      class: "citation-column-resizer",
      role: "separator", tabindex: "0", "aria-orientation": "vertical",
      "aria-label": "Resize " + column.label + " column",
      title: "Drag to resize " + column.label + " · arrow keys also resize",
      "data-citation-resize": index,
    });
    separator.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      columnDrag = { pointerId: event.pointerId, x: event.clientX, widths: [...tableWidths] };
      separator.setPointerCapture(event.pointerId);
      d.el.classList.add("resizing-citation-columns");
    });
    separator.addEventListener("pointermove", (event) => {
      if (columnDrag?.pointerId !== event.pointerId) return;
      event.preventDefault();
      resizeColumn(index, event.clientX - columnDrag.x, columnDrag.widths);
    });
    const stop = (event) => {
      if (columnDrag?.pointerId !== event.pointerId) return;
      columnDrag = null;
      d.el.classList.remove("resizing-citation-columns");
      if (separator.hasPointerCapture(event.pointerId)) separator.releasePointerCapture(event.pointerId);
      layoutColumns(true);
    };
    separator.addEventListener("pointerup", stop);
    separator.addEventListener("pointercancel", stop);
    separator.addEventListener("lostpointercapture", stop);
    separator.addEventListener("click", (event) => event.stopPropagation());
    separator.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Home") {
        columnPreferences[phoneLayout.matches ? "phone" : "wide"].clear();
        layoutColumns(true);
      } else resizeColumn(index, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 24 : 8));
    });
    return separator;
  }
  function renderTableHeader() {
    const list = columns();
    tableHeader.replaceChildren(
      ...list.map((column, index) => {
        const control = column.sort ? button(
          column.label +
            (tableSort === column.sort
              ? tableDirection === "asc"
                ? " ↑"
                : " ↓"
              : ""),
          () => {
            tableDirection =
              tableSort === column.sort && tableDirection === "asc"
                ? "desc"
                : "asc";
            tableSort = column.sort;
            resetLibrary();
            renderTableHeader();
          },
        ) : node("span", {}, column.label);
        return node(
          "span",
          {
            role: "columnheader",
            "aria-sort":
              tableSort === column.sort
                ? tableDirection === "asc"
                  ? "ascending"
                  : "descending"
                : "none",
          },
          control,
          index < list.length - 1 ? columnSeparator(column, index) : null,
        );
      }),
      node(
        "span",
        {
          class: "citation-add-cell",
          role: "columnheader",
          "aria-label": "Add reference",
        },
        "+",
      ),
    );
    if (tableWidths.length) layoutColumns(true);
  }
  const library = new VirtualList({
    element: libraryRows,
    label: "Project references",
    header: tableHeader,
    role: "grid",
    rowRole: "row",
    rowHeight: phoneLayout.matches ? 64 : 44,
    load: (args) =>
      scoped.request(
        "items?" +
          query({
            q: searchTerm,
            sort: tableSort,
            direction: tableDirection,
            fields: [...extraColumns.keys()]
              .filter((key) => key !== "itemType")
              .join(","),
            start: args.start,
            limit: args.limit,
            cursor: args.cursor,
          }),
        { signal: args.signal },
      ),
    render: (item) =>
      node(
        "div",
        { class: "citation-table-row" },
        ...columns().map((column) => {
          const value = cellValue(item, column),
            truncated = item.meta?.truncatedFields?.includes(column.id);
          return node(
            "span",
            { class: "citation-cell" + (column.id === "year" ? " citation-cell-year" : ""), role: "gridcell", title: value },
            truncated
              ? button(value + "…", () => void showFullValue(item, column), {
                  class: "citation-cell-value",
                  "aria-label":
                    "Read full " + column.label + " for " + title(item),
                })
              : node("span", { class: "citation-cell-text" }, value),
          );
        }),
        node(
          "span",
          { class: "citation-add-cell", role: "gridcell" },
          button("+", () => addItem(item), {
            class: "citation-add-button",
            "aria-label": "Add " + title(item),
            title: "Add reference",
            disabled: loadingInitial,
          }),
        ),
      ),
    onSelect: async (item, event) => {
      rangeController?.abort();
      rangeController = null;
      if (event.range && selectionAnchor?.generation === library.generation) {
        const current = (rangeController = new AbortController());
        librarySelection.clear();
        library.setSelection([]);
        updateControls();
        try {
          for await (const page of library.range(
            Math.min(selectionAnchor.index, event.index),
            Math.max(selectionAnchor.index, event.index),
            { signal: current.signal },
          )) {
            for (const record of page) librarySelection.set(record.key, record);
            library.setSelection(librarySelection.keys());
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
      } else {
        selectionAnchor = {
          index: event.index,
          generation: library.generation,
        };
        if (!event.toggle) librarySelection.clear();
        if (event.toggle && librarySelection.has(item.key))
          librarySelection.delete(item.key);
        else librarySelection.set(item.key, item);
        library.setSelection(librarySelection.keys());
        updateControls();
      }
    },
    onActivate: (item) => addItem(item),
    onStatus: (text, error) => {
      d.notice.textContent = error?.message || text;
    },
  });
  renderTableHeader();
  function resetLibrary() {
    rangeController?.abort();
    rangeController = null;
    selectionAnchor = null;
    librarySelection.clear();
    library.reset({ preserveSelection: false });
    updateControls();
  }
  const searchChanged = debounce(() => {
    searchTerm = search.value;
    resetLibrary();
  });
  search.addEventListener("input", () => {
    rangeController?.abort();
    rangeController = null;
    library.controller.abort();
    searchChanged();
  });
  const sizeRows = () => {
    const position = library.root.scrollTop / library.rowHeight;
    library.rowHeight = phoneLayout.matches ? 64 : 44;
    library.root.scrollTop = position * library.rowHeight;
    library.draw();
    layoutColumns(true);
  };
  const tableResize = new ResizeObserver(() => layoutColumns());
  tableResize.observe(library.root);
  phoneLayout.addEventListener("change", sizeRows);

  async function chooseColumns() {
    const child = childDialog("Reference columns"),
      request = new AbortController();
    child.el.addEventListener("close", () => request.abort(), { once: true });
    const options = node("div", { class: "citation-column-options" }),
      searchColumns = node("input", {
        type: "search",
        placeholder: "Find a metadata field",
        "aria-label": "Find a column",
      });
    child.body.append(field("Extra metadata columns", searchColumns), options);
    child.notice.textContent = "Title, Authors and Year are always shown. Drag a divider to resize columns.";
    child.actions.append(button("Cancel", () => child.el.close()));
    child.open();
    try {
      const schema = await scoped.request("schema", { signal: request.signal });
      if (request.signal.aborted) return;
      const names = new Set(["itemType", "dateAdded", "dateModified"]);
      for (const type of schema.itemTypes)
        for (const entry of type.fields || []) {
          names.add(entry.field);
          if (entry.baseField) names.add(entry.baseField);
        }
      names.delete("title");
      names.delete("year");
      names.delete(undefined);
      const entries = [...names]
        .map((id) => ({
          id,
          label: schema.locales?.["en-US"]?.fields?.[id] || human(id),
          width: id === "abstractNote" || id === "extra" ? 300 : 180,
          sort: ["itemType", "dateModified"].includes(id) ? id : undefined,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const controls = entries.map((column) => {
        const input = node("input", {
            type: "checkbox",
            checked: extraColumns.has(column.id),
          }),
          row = field(column.label, input);
        options.append(row);
        return { column, input, row };
      });
      searchColumns.addEventListener("input", () => {
        const term = searchColumns.value.toLocaleLowerCase();
        for (const { column, row } of controls)
          row.hidden = !column.label.toLocaleLowerCase().includes(term);
      });
      child.actions.append(
        button(
          "Apply columns",
          () => {
            extraColumns.clear();
            for (const { column, input } of controls)
              if (input.checked) extraColumns.set(column.id, column);
            renderTableHeader();
            resetLibrary();
            child.el.close();
          },
          { class: "primary" },
        ),
      );
    } catch (error) {
      if (!request.signal.aborted) child.notice.textContent = error.message;
    }
  }
  async function showFullValue(item, column) {
    const child = childDialog(column.label),
      request = new AbortController();
    child.el.addEventListener("close", () => request.abort(), { once: true });
    child.body.append(node("p", {}, title(item)));
    child.actions.append(button("Close", () => child.el.close()));
    child.open();
    try {
      const full = await scoped.request(
        "items/" + encodeURIComponent(item.key),
        { signal: request.signal },
      );
      if (!request.signal.aborted)
        child.body.append(
          node("p", { class: "citation-full-value" }, cellValue(full, column)),
        );
    } catch (error) {
      if (!request.signal.aborted) child.notice.textContent = error.message;
    }
  }
  function sourceLabel(source) {
    if (!source.item) return "Loading reference…";
    return [
      source.item.meta?.creatorSummary ||
        creators(source.item) ||
        title(source.item),
      year(source.item),
    ]
      .filter(Boolean)
      .join(", ");
  }
  function showSource(uid) {
    rangeController?.abort();
    rangeController = null;
    active = sources.findIndex((source) => source.uid === uid);
    if (active < 0) return;
    sourceDialog?.el.close();
    const child = (sourceDialog = childDialog("Citation source"));
    sourceHeading = node(
      "p",
      { class: "detail-title" },
      title(sources[active].item),
    );
    sourceDialog.body.append(
      sourceHeading,
      node("p", { class: "notice" }, sourceLabel(sources[active])),
      controls,
      sourceActions,
    );
    sourceDialog.actions.append(
      button("Done", () => child.el.close(), { class: "primary" }),
    );
    sourceDialog.el.addEventListener(
      "close",
      () => {
        if (sourceDialog === child) {
          sourceDialog = null;
          sourceHeading = null;
        }
      },
      { once: true },
    );
    updateControls();
    sourceDialog.open();
    inputs.locator.focus();
  }
  function showAllSources() {
    const child = childDialog("Citation sources"),
      rows = node("div", { class: "search-results" });
    child.body.append(rows);
    selectedList = new VirtualList({
      element: rows,
      label: "Selected citation sources",
      rowHeight: 48,
      key: (source) => source.uid,
      total: sources.length,
      load: async ({ start, limit }) => ({
        items: sources.slice(start, start + limit),
        total: sources.length,
        hasMore: start + limit < sources.length,
      }),
      render: (source) =>
        node(
          "span",
          { class: "source-label" },
          node("strong", {}, title(source.item)),
          node("small", {}, sourceLabel(source)),
        ),
      onSelect: (source) => showSource(source.uid),
      onActivate: (source) => showSource(source.uid),
    });
    child.actions.append(button("Close", () => child.el.close()));
    child.el.addEventListener(
      "close",
      () => {
        selectedList?.destroy();
        selectedList = null;
      },
      { once: true },
    );
    child.open();
  }
  function redrawSources() {
    const start = Math.max(0, Math.floor(active / 8) * 8);
    chips.replaceChildren(
      ...sources
        .slice(start, start + 8)
        .map((source) =>
          button(sourceLabel(source) + " ▾", () => showSource(source.uid), {
            class: "citation-chip",
            title: title(source.item) + " · " + sourceLabel(source),
            "aria-label": "Edit " + title(source.item),
          }),
        ),
    );
    if (sources.length > 8)
      chips.append(
        button("All sources (" + sources.length + ")", () => showAllSources()),
      );
    chips.hidden = !sources.length;
    selectedList?.reset({ preservePosition: true, total: sources.length });
    if (sourceHeading && sources[active])
      sourceHeading.textContent = title(sources[active].item);
    updateControls();
  }
  function openPreviewEditor() {
    const child = childDialog("Edit citation preview");
    if (cluster.customHTML !== undefined)
      renderedHTML(editor, cluster.customHTML);
    else if (cluster.customText !== undefined)
      editor.textContent = cluster.customText;
    else renderedHTML(editor, previewResult?.html || "");
    if (!editor.textContent && !hasCustomPreview())
      editor.textContent = previewResult?.text || "";
    child.body.append(customControls, editor);
    child.actions.append(
      button("Use generated preview", () => {
        clearCustomPreview();
        invalidatePreview();
        child.el.close();
      }),
      button("Done", () => child.el.close(), { class: "primary" }),
    );
    child.open();
    editor.focus();
  }
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
    const source = sources[active];
    remove.disabled = !source;
    up.disabled = active <= 0;
    down.disabled = active < 0 || active >= sources.length - 1;
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
      else if (input.value !== String(value)) input.value = value;
    }
    confirm.disabled =
      loadingInitial ||
      !sources.length ||
      sources.some((source) => !source.item) ||
      !previewResult;
    editPreview.disabled = loadingInitial || !sources.length;
    addSelection.hidden = librarySelection.size < 2;
    addSelection.disabled =
      loadingInitial || !!rangeController || !librarySelection.size;
    for (const control of libraryRows.querySelectorAll(".citation-add-button"))
      control.disabled = loadingInitial;
  }
  function invalidatePreview(schedule = true) {
    queuedConfirm = null;
    ++previewGeneration;
    previewController?.abort();
    previewResult = null;
    confirm.disabled = true;
    if (schedule) schedulePreview();
    else schedulePreview.cancel();
  }
  function hasCustomPreview() {
    return cluster.customHTML !== undefined || cluster.customText !== undefined;
  }
  function clearCustomPreview() {
    delete cluster.customHTML;
    delete cluster.customText;
  }
  async function regenerateCustom() {
    if (!hasCustomPreview()) return { cancelled: false };
    let choice = { regenerate: autoRegenerate === 1, cancelled: false };
    if (autoRegenerate === -1) {
      const prompt = dialog("Regenerate edited citation?"),
        remember = node("input", { type: "checkbox" }),
        pending = new AbortController();
      prompt.body.append(
        node(
          "p",
          {},
          "Use the changed references and fields to regenerate the preview, or keep your edited text.",
        ),
        field("Remember this choice", remember),
      );
      let answer;
      const decide = async (regenerate) => {
        for (const control of prompt.actions.querySelectorAll("button"))
          control.disabled = true;
        remember.disabled = true;
        try {
          if (remember.checked) {
            const value = regenerate ? 1 : 0;
            await scoped.request("settings", {
              method: "PATCH",
              body: { citationAutoRegenerate: value },
              signal: pending.signal,
            });
            pending.signal.throwIfAborted();
            autoRegenerate = value;
          }
          answer = { regenerate, cancelled: false };
          prompt.el.close();
        } catch (error) {
          if (!pending.signal.aborted) {
            prompt.notice.textContent = error.message;
            for (const control of prompt.actions.querySelectorAll("button"))
              control.disabled = false;
            remember.disabled = false;
          }
        }
      };
      const regenerate = button("Regenerate", () => void decide(true), {
        class: "primary",
      });
      prompt.actions.append(
        button("Keep edited text", () => void decide(false)),
        regenerate,
      );
      choice = await new Promise((resolve) => {
        const close = () => prompt.el.close();
        controller.signal.addEventListener("abort", close, { once: true });
        prompt.el.addEventListener(
          "close",
          () => {
            pending.abort();
            controller.signal.removeEventListener("abort", close);
            resolve(answer || { regenerate: false, cancelled: true });
          },
          { once: true },
        );
        prompt.open();
        if (controller.signal.aborted) close();
        else regenerate.focus();
      });
    }
    if (choice.regenerate) clearCustomPreview();
    return choice;
  }
  function regenerateAndPreview() {
    if (regenerationWork) return regenerationWork;
    invalidatePreview(false);
    regenerationWork = regenerateCustom()
      .then((choice) => {
        if (!controller.signal.aborted) invalidatePreview();
        return choice;
      })
      .finally(() => {
        regenerationWork = null;
      });
    return regenerationWork;
  }
  function changed() {
    redrawSources();
    void regenerateAndPreview();
  }

  function addItem(item) {
    if (loadingInitial) return;
    rangeController?.abort();
    rangeController = null;
    sources.push({ uid: ++serial, item, citation: { id: item.id } });
    active = sources.length - 1;
    changed();
  }
  function addSelected() {
    if (loadingInitial || rangeController) return;
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
    sourceDialog?.el.close();
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
  for (const [key, input] of Object.entries(inputs)) {
    input.addEventListener("input", () => {
      if (!sources[active]) return;
      sources[active].citation[key] =
        input.type === "checkbox" ? input.checked : input.value;
      if (key === "suppressAuthor")
        delete sources[active].citation["suppress-author"];
      if (autoRegenerate === 1) clearCustomPreview();
      invalidatePreview();
    });
    // The classic dialog asks on change/focus, not for every typed character.
    input.addEventListener("change", () => {
      if (!sources[active] || !hasCustomPreview()) return;
      void regenerateAndPreview();
    });
    if (input.type === "text")
      input.addEventListener("keydown", (event) => {
        if (
          event.key !== "Enter" ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        event.preventDefault();
        input.blur();
        void requestConfirmation();
      });
  }
  sort.addEventListener("change", () => {
    void regenerateAndPreview();
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
      if (editor.isConnected && !hasCustomPreview()) {
        renderedHTML(editor, result.html || "");
        if (!result.html) editor.textContent = result.text || "";
      }
      if (typeof result.sortable === "boolean") {
        sortLabel.hidden = !result.sortable;
        if (!result.sortable) sort.checked = false;
      }
      applySorted(result.sortedItems);
      previewNotice.textContent = "";
      updateControls();
      if (queuedConfirm === generation && !confirm.disabled) {
        queuedConfirm = null;
        finish();
      }
    } catch (error) {
      if (!previewSignal.aborted && generation === previewGeneration) {
        previewNotice.textContent = error.message;
        previewResult = null;
        queuedConfirm = null;
        updateControls();
      }
    }
  });
  async function requestConfirmation() {
    if (regenerationWork && (await regenerationWork).cancelled) return;
    if (controller.signal.aborted || loadingInitial || !sources.length) return;
    if (!confirm.disabled) finish();
    else {
      queuedConfirm = previewGeneration;
      schedulePreview();
    }
  }
  function finish() {
    if (confirm.disabled) return;
    if (
      hasCustomPreview() &&
      !previewBox.textContent.trim() &&
      !window.confirm("Insert an empty custom citation?")
    )
      return;
    confirm.disabled = true;
    accepted = true;
    d.el.close();
  }
  const abort = () => d.el.close();
  // An activation may wait for its current preview. Any subsequent user
  // interaction cancels that intent before another action changes the draft.
  for (const name of ["pointerdown", "keydown", "input"])
    d.el.addEventListener(
      name,
      () => {
        queuedConfirm = null;
      },
      { capture: true },
    );
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
        phoneLayout.removeEventListener("change", sizeRows);
        tableResize.disconnect();
        library.destroy();
        selectedList?.destroy();
        for (const child of [...children]) child.el.close();
        signal?.removeEventListener("abort", abort);
        resolve(accepted ? snapshot() : null);
      },
      { once: true },
    ),
  );
  d.open();
  layoutColumns(true);
  search.focus();
  updateControls();
  try {
    const options = await scoped.request(
      "citation-options?" + query({ locale: style.locale }),
      { signal: controller.signal },
    );
    autoRegenerate = [-1, 0, 1].includes(options.citationAutoRegenerate)
      ? options.citationAutoRegenerate
      : -1;
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
