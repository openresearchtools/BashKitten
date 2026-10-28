import { cleanDisplayText } from "./text-utils.js";

function defaultPlaceholderQueryState(input) {
  const caret = Number(input?.selectionStart || 0) || 0;
  const before = String(input?.value || "").slice(0, caret);
  const match = before.match(/@\{([A-Za-z_][A-Za-z0-9_:-]*)?$/);
  if (!match) {
    return null;
  }
  return {
    query: String(match[1] || "").trim(),
    start: before.length - match[0].length,
    end: caret,
  };
}

function searchTextForEntry(entry = {}) {
  return [
    String(entry?.label || ""),
    String(entry?.key || ""),
    ...(Array.isArray(entry?.aliases) ? entry.aliases : []),
  ].join(" ").toLowerCase();
}

export function createSearchablePlaceholderAutocomplete(ctx, config = {}) {
  const state = {
    destroyed: false,
    activeInput: null,
    start: 0,
    end: 0,
    inputQuery: "",
    manualQuery: "",
    closeTimer: 0,
    attached: [],
  };

  const menu = ctx.createNode("div", {
    className: `mw-screening-option-picker-menu${config.menuClassName ? ` ${config.menuClassName}` : ""}`,
    attrs: { role: "listbox" },
  });
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = String(config.searchPlaceholder || "Filter columns...");
  searchInput.className = "mw-screening-option-picker-search";
  const head = ctx.createNode("div", {
    className: "mw-screening-option-picker-head",
    children: [searchInput],
  });
  const meta = ctx.createNode("div", {
    className: "mw-screening-option-picker-meta",
  });
  const list = ctx.createNode("div", {
    className: "mw-screening-option-picker-list",
  });
  head.append(meta);
  menu.append(head, list);
  document.body.appendChild(menu);

  function hide() {
    clearTimeout(state.closeTimer);
    state.closeTimer = 0;
    state.activeInput = null;
    state.start = 0;
    state.end = 0;
    state.inputQuery = "";
    state.manualQuery = "";
    searchInput.value = "";
    menu.className = `mw-screening-option-picker-menu${config.menuClassName ? ` ${config.menuClassName}` : ""}`;
    list.replaceChildren();
    meta.textContent = "";
  }

  function scheduleHide() {
    clearTimeout(state.closeTimer);
    state.closeTimer = window.setTimeout(() => hide(), 120);
  }

  function currentOptions() {
    const entries = typeof config.getOptions === "function"
      ? config.getOptions()
      : (Array.isArray(config.options) ? config.options : []);
    return (Array.isArray(entries) ? entries : []).filter((entry) =>
      typeof config.filterOption === "function" ? config.filterOption(entry) : true
    );
  }

  function currentQuery() {
    return String(searchInput.value || state.manualQuery || state.inputQuery || "").trim().toLowerCase();
  }

  function filteredOptions() {
    const query = currentQuery();
    const options = currentOptions();
    if (!query) {
      return options;
    }
    return options.filter((entry) => searchTextForEntry(entry).includes(query));
  }

  function positionMenu() {
    if (!state.activeInput || !state.activeInput.isConnected || !menu.isConnected) {
      return;
    }
    const rect = state.activeInput.getBoundingClientRect();
    menu.style.left = "8px";
    menu.style.top = "8px";
    menu.style.minWidth = `${Math.max(260, Math.round(rect.width))}px`;
    const menuRect = menu.getBoundingClientRect();
    let left = rect.left;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuRect.width - 8);
    }
    let top = rect.bottom + 4;
    if (top + menuRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuRect.height - 4);
    }
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function insertEntry(entry = null) {
    if (!entry || !state.activeInput) {
      hide();
      return;
    }
    const target = state.activeInput;
    const start = Number(state.start || 0) || 0;
    const end = Number(target.selectionStart || state.end || start) || start;
    const text = String(target.value || "");
    const key = String(entry?.key || "").trim();
    if (!key) {
      hide();
      return;
    }
    const insertion = typeof config.formatInsertion === "function"
      ? String(config.formatInsertion(key, entry) || "")
      : `@{${key}}`;
    target.value = `${text.slice(0, start)}${insertion}${text.slice(end)}`;
    const nextCaret = start + insertion.length;
    target.setSelectionRange(nextCaret, nextCaret);
    target.focus();
    hide();
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function renderList() {
    if (!state.activeInput) {
      return;
    }
    const options = currentOptions();
    const visible = filteredOptions();
    meta.textContent = `${visible.length} of ${options.length} ${String(config.metaLabel || "columns")}`;
    list.replaceChildren(...visible.slice(0, Number(config.maxVisible || 80) || 80).map((entry) => {
      const key = String(entry?.key || "");
      const label = String(entry?.label || key);
      const extra = String(
        typeof config.metaText === "function"
          ? (config.metaText(entry) || "")
          : (Array.isArray(entry?.aliases) && entry.aliases.length ? entry.aliases.join(", ") : "")
      ).trim();
      const item = ctx.createNode("button", {
        className: "mw-screening-option-picker-item",
        attrs: {
          type: "button",
          role: "option",
        },
        children: [
          ctx.createNode("span", {
            className: "mw-screening-option-picker-item-label",
            textContent: cleanDisplayText(label),
          }),
          extra && extra !== label && extra !== key
            ? ctx.createNode("span", {
                className: "mw-screening-option-picker-item-key",
                textContent: cleanDisplayText(extra),
              })
            : null,
        ].filter(Boolean),
      });
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        insertEntry(entry);
      });
      return item;
    }));
    if (!visible.length) {
      list.appendChild(ctx.createNode("div", {
        className: "mw-screening-option-picker-empty",
        textContent: String(config.emptyText || "No columns match this filter."),
      }));
    }
  }

  function open(input, queryState = null) {
    if (!input) {
      hide();
      return;
    }
    clearTimeout(state.closeTimer);
    state.activeInput = input;
    state.start = Number(queryState?.start || 0) || 0;
    state.end = Number(queryState?.end || 0) || 0;
    state.inputQuery = String(queryState?.query || "").trim();
    state.manualQuery = state.inputQuery;
    searchInput.value = state.manualQuery;
    menu.className = `mw-screening-option-picker-menu${config.menuClassName ? ` ${config.menuClassName}` : ""} is-open`;
    renderList();
    window.requestAnimationFrame(() => positionMenu());
  }

  async function handleInput(input) {
    const resolver = typeof config.queryState === "function" ? config.queryState : defaultPlaceholderQueryState;
    const queryState = resolver(input);
    if (!queryState) {
      hide();
      return;
    }
    if (!currentOptions().length && typeof config.ensureOptions === "function") {
      await Promise.resolve(config.ensureOptions());
      if (state.destroyed) {
        return;
      }
    }
    open(input, queryState);
  }

  function attach(input) {
    if (!input) {
      return;
    }
    const onInput = () => {
      void handleInput(input);
    };
    const onClick = () => {
      const resolver = typeof config.queryState === "function" ? config.queryState : defaultPlaceholderQueryState;
      const queryState = resolver(input);
      if (!queryState) {
        hide();
      }
      else {
        void handleInput(input);
      }
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        hide();
      }
    };
    input.addEventListener("input", onInput);
    input.addEventListener("click", onClick);
    input.addEventListener("keydown", onKeydown);
    state.attached.push({ input, onInput, onClick, onKeydown });
  }

  searchInput.addEventListener("input", () => {
    state.manualQuery = String(searchInput.value || "").trim();
    renderList();
    if (state.activeInput) {
      window.requestAnimationFrame(() => positionMenu());
    }
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hide();
      state.activeInput?.focus?.();
    }
    else if (event.key === "Enter") {
      const first = filteredOptions()[0] || null;
      if (first) {
        event.preventDefault();
        insertEntry(first);
      }
    }
  });
  menu.addEventListener("mouseenter", () => {
    clearTimeout(state.closeTimer);
  });
  menu.addEventListener("mouseleave", () => {
    scheduleHide();
  });

  const outsideHandler = (event) => {
    if (!menu.contains(event.target) && event.target !== state.activeInput) {
      hide();
    }
  };
  const repositionHandler = () => {
    if (state.activeInput) {
      positionMenu();
    }
  };
  document.addEventListener("mousedown", outsideHandler, true);
  window.addEventListener("resize", repositionHandler);
  window.addEventListener("scroll", repositionHandler, true);

  return {
    attach,
    hide,
    refresh() {
      if (state.activeInput) {
        renderList();
        window.requestAnimationFrame(() => positionMenu());
      }
    },
    destroy() {
      if (state.destroyed) {
        return;
      }
      state.destroyed = true;
      hide();
      document.removeEventListener("mousedown", outsideHandler, true);
      window.removeEventListener("resize", repositionHandler);
      window.removeEventListener("scroll", repositionHandler, true);
      for (const entry of state.attached) {
        entry.input.removeEventListener("input", entry.onInput);
        entry.input.removeEventListener("click", entry.onClick);
        entry.input.removeEventListener("keydown", entry.onKeydown);
      }
      menu.remove();
    },
  };
}

export { defaultPlaceholderQueryState as placeholderQueryState };
