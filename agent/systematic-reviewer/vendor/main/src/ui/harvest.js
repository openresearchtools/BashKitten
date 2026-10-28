function harvestField(ctx, label, input, options = {}) {
  const children = [
    ctx.createNode("span", { textContent: label }),
    input,
  ];
  if (options.note) {
    children.push(ctx.createNode("div", {
      className: "mw-note",
      textContent: options.note,
    }));
  }
  return ctx.createNode("label", {
    className: `mw-field${options.full ? " full" : ""}`,
    children,
  });
}

function createExternalLink(ctx, label, href) {
  const link = ctx.createNode("a", {
    className: "mw-link",
    textContent: label,
    attrs: {
      href,
      target: "_blank",
      rel: "noreferrer noopener",
    },
  });
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await ctx.invoke("workflow.openExternalURL", { url: href });
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
    }
  });
  return link;
}

function createSelect(ctx, options = [], attrs = {}) {
  return ctx.createNode("select", {
    attrs,
    children: (options || []).map((entry) =>
      ctx.createNode("option", {
        attrs: { value: entry.value },
        textContent: entry.label,
      })
    ),
  });
}

function preserveSelectValue(select, nextValue) {
  let value = String(nextValue ?? select.value ?? "").trim();
  if (value && Array.from(select.options || []).some((option) => option.value === value)) {
    select.value = value;
  }
}

function replaceSelectOptions(ctx, select, options = [], config = {}) {
  let previous = String(config.previousValue ?? select.value ?? "").trim();
  let entries = Array.isArray(options) ? [...options] : [];
  if (config.includeAny !== false) {
    entries.unshift({
      value: "",
      label: config.anyLabel || "Any",
    });
  }
  select.replaceChildren(...entries.map((entry) =>
    ctx.createNode("option", {
      attrs: { value: entry.value },
      textContent: entry.label,
    })
  ));
  preserveSelectValue(select, previous || config.defaultValue || "");
  if (!select.value && config.defaultValue && Array.from(select.options || []).some((option) => option.value === config.defaultValue)) {
    select.value = config.defaultValue;
  }
}

function replaceExactSelectOptions(ctx, select, options = [], preferredValue = "") {
  const entries = Array.isArray(options) ? options : [];
  select.replaceChildren(...entries.map((entry) =>
    ctx.createNode("option", {
      attrs: { value: entry.value },
      textContent: entry.label,
    })
  ));
  preserveSelectValue(select, preferredValue || "");
  if (!select.value && entries.length) {
    select.value = String(entries[0]?.value || "");
  }
}

function triStateLabel(value, yesLabel, noLabel) {
  if (String(value) === "true") {
    return yesLabel;
  }
  if (String(value) === "false") {
    return noLabel;
  }
  return "";
}

const FILTER_GROUPS = [
  {
    id: "basics",
    label: "Basics",
    note: "Core work, language, country, and source filters.",
  },
  {
    id: "access",
    label: "Access",
    note: "Availability, OA status, abstract, and repository access.",
  },
  {
    id: "publication",
    label: "Publication",
    note: "Year range, citation range, and retraction state.",
  },
  {
    id: "advanced",
    label: "Advanced",
    note: "Raw OpenAlex filter clauses when you need something more specific.",
  },
];

function buildOutputList(ctx, outputs = [], onRead = null) {
  if (!outputs.length) {
    return ctx.createNode("div", { className: "mw-empty", textContent: "No saved harvest summaries yet." });
  }
  return ctx.createNode("div", {
    className: "mw-output-list",
    children: outputs.map((entry) => {
      const readButton = onRead
        ? ctx.createNode("button", {
            className: "mw-button",
            textContent: "Read",
            attrs: { type: "button", "data-harvest-read": entry.name },
          })
        : null;
      if (readButton) {
        readButton.addEventListener("click", () => onRead(entry));
      }
      const badges = [];
      if (entry.query_mode) {
        badges.push(ctx.createNode("div", { className: "mw-badge", textContent: entry.query_mode }));
      }
      if (entry.mode === "estimate") {
        badges.push(ctx.createNode("div", {
          className: "mw-badge",
          textContent: `Estimated ${Number(entry.estimated || 0)}`,
        }));
      }
      else if (entry.total_fetched || entry.imported_count || entry.skipped_count) {
        badges.push(ctx.createNode("div", {
          className: "mw-badge",
          textContent: `Fetched ${Number(entry.total_fetched || 0)} - Imported ${Number(entry.imported_count || 0)} - Skipped ${Number(entry.skipped_count || 0)}`,
        }));
      }
      return ctx.createNode("div", {
        className: "mw-output-item",
        children: [
          ctx.createNode("div", {
            className: "mw-output-main",
            children: [
              ctx.createNode("div", { className: "mw-output-name", textContent: entry.query || entry.name }),
              ctx.createNode("div", { className: "mw-output-meta", textContent: entry.path }),
              entry.ndjson_path
                ? ctx.createNode("div", { className: "mw-output-meta", textContent: `NDJSON: ${entry.ndjson_path}` })
                : null,
            ].filter(Boolean),
          }),
          ctx.createNode("div", {
            className: "mw-output-actions",
            children: [
              badges.length
                ? ctx.createNode("div", { className: "mw-meta", children: badges })
                : null,
              ctx.createNode("div", {
                className: "mw-output-meta",
                textContent: entry.mtime ? new Date(entry.mtime).toLocaleString() : "",
              }),
              readButton,
            ].filter(Boolean),
          }),
        ],
      });
    }),
  });
}

export function createHarvestTab(ctx) {
  const panel = ctx.createNode("section", { className: "mw-tab-panel" });
  const state = {
    config: null,
    activeFilterGroup: "basics",
    latestResult: null,
    cleanups: [],
  };

  function createHelpPopover(title = "", lines = []) {
    const wrap = ctx.createNode("div", { className: "mw-help-wrap" });
    const button = ctx.createNode("button", {
      className: "mw-help-button",
      textContent: "?",
      attrs: { type: "button", "aria-expanded": "false", "aria-label": title || "More information" },
    });
    const popover = ctx.createNode("div", {
      className: "mw-help-popover",
      attrs: { hidden: "hidden", role: "dialog" },
      children: [
        title
          ? ctx.createNode("div", {
              className: "mw-help-popover-title",
              textContent: title,
            })
          : null,
        ctx.createNode("div", {
          className: "mw-card-stack",
          children: (Array.isArray(lines) ? lines : []).map((line) => ctx.createNode("div", {
            textContent: line,
          })),
        }),
      ].filter(Boolean),
    });
    const close = () => {
      popover.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      popover.hidden = false;
      button.setAttribute("aria-expanded", "true");
    };
    const toggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (popover.hidden) {
        open();
      }
      else {
        close();
      }
    };
    const onDocumentClick = (event) => {
      if (!wrap.contains(event.target)) {
        close();
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close();
      }
    };
    button.addEventListener("click", toggle);
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    state.cleanups.push(() => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onKeyDown);
    });
    wrap.append(button, popover);
    return wrap;
  }

  const sourcesCard = ctx.createNode("div", { className: "mw-card mw-harvest-side-card" });
  const OPENALEX_SEARCH_DOCS_URL = "https://developers.openalex.org/guides/searching";
  const OPENALEX_FILTER_DOCS_URL = "https://developers.openalex.org/how-to-use-the-api/get-lists-of-entities/filter-entity-lists";

  const queryInput = ctx.createNode("textarea", {
    attrs: {
      rows: "4",
      name: "query",
      placeholder: '(e.g. (diabetes OR hyperglycemia) AND ("gestational diabetes" OR pregnancy) NOT mouse)',
      "data-harvest-query": "true",
    },
  });
  const queryModeInput = createSelect(ctx, [
    { value: "boolean", label: "Boolean search" },
    { value: "semantic", label: "Semantic search" },
  ], { "data-harvest-query-mode": "true" });
  const fieldInput = createSelect(ctx, [
    { value: "title_and_abstract", label: "Title and abstract" },
    { value: "title", label: "Title" },
    { value: "all", label: "All metadata" },
    { value: "abstract", label: "Abstract only" },
    { value: "author", label: "Author names" },
    { value: "fulltext", label: "Full text" },
  ], { "data-harvest-field": "true" });
  const sortInput = createSelect(ctx, [
    { value: "relevance", label: "Relevance" },
    { value: "date", label: "Publication date" },
    { value: "citations", label: "Citation count" },
  ]);
  const sortOrderInput = createSelect(ctx, [
    { value: "desc", label: "Descending" },
    { value: "asc", label: "Ascending" },
  ]);
  const maxResultsInput = ctx.createNode("input", {
    attrs: {
      type: "number",
      min: "1",
      step: "1",
      placeholder: "(e.g. 50)",
      "data-harvest-max-results": "true",
    },
  });
  const yearFromInput = ctx.createNode("input", {
    attrs: {
      type: "number",
      min: "1900",
      max: "2100",
      step: "1",
      placeholder: "(e.g. 2020)",
    },
  });
  const yearToInput = ctx.createNode("input", {
    attrs: {
      type: "number",
      min: "1900",
      max: "2100",
      step: "1",
      placeholder: "(e.g. 2026)",
    },
  });
  const dateFromInput = ctx.createNode("input", {
    attrs: {
      type: "text",
      placeholder: "(e.g. 2020-01-01)",
    },
  });
  const dateToInput = ctx.createNode("input", {
    attrs: {
      type: "text",
      placeholder: "(e.g. 2026-12-31)",
    },
  });
  const workTypeInput = document.createElement("select");
  workTypeInput.setAttribute("data-harvest-work-type", "true");
  const languageInput = document.createElement("select");
  languageInput.setAttribute("data-harvest-language", "true");
  const countryInput = document.createElement("select");
  countryInput.setAttribute("data-harvest-country", "true");
  const sourceTypeInput = document.createElement("select");
  sourceTypeInput.setAttribute("data-harvest-source-type", "true");
  const openAccessInput = document.createElement("select");
  openAccessInput.setAttribute("data-harvest-open-access", "true");
  replaceSelectOptions(ctx, openAccessInput, [
    { value: "true", label: "Open access only" },
    { value: "false", label: "Closed access only" },
  ], { anyLabel: "Any access" });
  const oaStatusInput = document.createElement("select");
  const hasPdfInput = document.createElement("select");
  replaceSelectOptions(ctx, hasPdfInput, [
    { value: "true", label: "PDF available" },
    { value: "false", label: "No PDF" },
  ], { anyLabel: "Any PDF state" });
  const hasAbstractInput = document.createElement("select");
  replaceSelectOptions(ctx, hasAbstractInput, [
    { value: "true", label: "With abstract only" },
    { value: "false", label: "Without abstract only" },
  ], { anyLabel: "Any abstract state" });
  hasAbstractInput.value = "true";
  const repositoryFulltextInput = document.createElement("select");
  replaceSelectOptions(ctx, repositoryFulltextInput, [
    { value: "true", label: "Repository full text" },
    { value: "false", label: "No repository full text" },
  ], { anyLabel: "Any repository full text" });
  const retractedInput = document.createElement("select");
  replaceSelectOptions(ctx, retractedInput, [
    { value: "false", label: "Exclude retracted works" },
    { value: "true", label: "Retracted only" },
  ], { anyLabel: "Any retraction state" });
  const minCitationsInput = ctx.createNode("input", {
    attrs: {
      type: "number",
      min: "0",
      step: "1",
      placeholder: "(e.g. 0)",
    },
  });
  const maxCitationsInput = ctx.createNode("input", {
    attrs: {
      type: "number",
      min: "0",
      step: "1",
      placeholder: "(e.g. 500)",
    },
  });
  const rawFiltersInput = ctx.createNode("textarea", {
    attrs: {
      rows: "3",
      placeholder: "(e.g. best_oa_location.version:publishedVersion)",
      "data-harvest-extra-filters": "true",
    },
  });
  const attachmentFetchInput = createSelect(ctx, [
    { value: "none", label: "Do not retrieve PDFs" },
    { value: "all", label: "Retrieve PDFs" },
  ]);
  const postImportActionInput = document.createElement("select");
  postImportActionInput.setAttribute("data-harvest-post-import-action", "true");

  const runButton = ctx.createNode("button", {
    className: "mw-button primary",
    textContent: "Import into Harvest/OpenAlex",
    attrs: { type: "button", "data-harvest-run": "true" },
  });
  const estimateButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Estimate only",
    attrs: { type: "button", "data-harvest-estimate": "true" },
  });
  const estimateInline = ctx.createNode("div", {
    className: "mw-note",
    attrs: { hidden: "hidden", "data-harvest-estimate-inline": "true" },
  });
  const refreshCreditsButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Reload",
    attrs: { type: "button", "data-harvest-credits-refresh": "true" },
  });
  const clearFiltersButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Clear filters",
    attrs: { type: "button" },
  });
  const filterSearchInput = ctx.createNode("input", {
    attrs: {
      type: "text",
      placeholder: "Find a filter...",
    },
  });

  const searchModeNote = ctx.createNode("div", { className: "mw-note" });
  const creditsBadge = ctx.createNode("div", {
    className: "mw-harvest-credit-panel",
    children: [
      ctx.createNode("div", { className: "mw-harvest-credit-label", textContent: "OpenAlex credits" }),
      ctx.createNode("div", { className: "mw-harvest-credit-value", textContent: "Checking..." }),
      ctx.createNode("div", { className: "mw-harvest-credit-meta", textContent: "Using the saved OpenAlex API key when available." }),
      refreshCreditsButton,
    ],
  });
  const activeFilterCard = ctx.createNode("div", {
    className: "mw-harvest-filter-summary",
    children: [
      ctx.createNode("div", {
        className: "mw-harvest-filter-summary-head",
        children: [
          ctx.createNode("div", { className: "mw-harvest-section-title", textContent: "Selected filters" }),
          clearFiltersButton,
        ],
      }),
      ctx.createNode("div", { className: "mw-chip-row" }),
    ],
  });
  const filterNav = ctx.createNode("div", { className: "mw-harvest-filter-nav" });
  const filterStage = ctx.createNode("div", { className: "mw-harvest-filter-stage" });
  const filterBrowser = ctx.createNode("div", {
    className: "mw-harvest-filter-browser",
    children: [filterNav, filterStage],
  });
  const queryFieldControl = harvestField(ctx, "Query field", fieldInput);
  const filterDefinitions = [
    {
      group: "basics",
      key: "work_type",
      label: "Work type",
      input: workTypeInput,
      note: "Articles are selected by default.",
      keywords: ["type", "article", "review", "dataset", "book"],
    },
    {
      group: "basics",
      key: "language",
      label: "Language",
      input: languageInput,
      keywords: ["language", "english", "spanish", "french"],
    },
    {
      group: "basics",
      key: "country_code",
      label: "Country",
      input: countryInput,
      keywords: ["country", "author country", "affiliation"],
    },
    {
      group: "basics",
      key: "source_type",
      label: "Source type",
      input: sourceTypeInput,
      keywords: ["source", "journal", "repository", "conference"],
    },
    {
      group: "access",
      key: "is_open_access",
      label: "Access",
      input: openAccessInput,
      keywords: ["open access", "closed access", "oa"],
    },
    {
      group: "access",
      key: "oa_status",
      label: "OA status",
      input: oaStatusInput,
      keywords: ["gold", "green", "bronze", "hybrid", "oa status"],
    },
    {
      group: "access",
      key: "has_pdf",
      label: "PDF availability",
      input: hasPdfInput,
      keywords: ["pdf", "file", "full text"],
    },
    {
      group: "access",
      key: "has_abstract",
      label: "Abstract",
      input: hasAbstractInput,
      note: "Abstract-bearing works stay easier to screen and hydrate later.",
      keywords: ["abstract", "summary"],
    },
    {
      group: "access",
      key: "repository_fulltext",
      label: "Repository full text",
      input: repositoryFulltextInput,
      keywords: ["repository", "fulltext", "full text"],
    },
    {
      group: "publication",
      key: "since",
      label: "Specific date from",
      input: dateFromInput,
      note: "Format: YYYY-MM-DD",
      keywords: ["date", "specific date", "from publication date"],
    },
    {
      group: "publication",
      key: "until",
      label: "Specific date to",
      input: dateToInput,
      note: "Format: YYYY-MM-DD",
      keywords: ["date", "specific date", "to publication date"],
    },
    {
      group: "publication",
      key: "year_from",
      label: "Publication year from",
      input: yearFromInput,
      keywords: ["year", "from", "date"],
    },
    {
      group: "publication",
      key: "year_to",
      label: "Publication year to",
      input: yearToInput,
      keywords: ["year", "to", "date"],
    },
    {
      group: "publication",
      key: "min_cited_by",
      label: "Minimum citations",
      input: minCitationsInput,
      keywords: ["citation", "minimum", "cited by"],
    },
    {
      group: "publication",
      key: "max_cited_by",
      label: "Maximum citations",
      input: maxCitationsInput,
      keywords: ["citation", "maximum", "cited by"],
    },
    {
      group: "publication",
      key: "is_retracted",
      label: "Retraction",
      input: retractedInput,
      keywords: ["retracted", "retraction"],
    },
    {
      group: "advanced",
      key: "filters",
      label: "Extra OpenAlex filters",
      input: rawFiltersInput,
      full: true,
      note: "One filter clause per line.",
      keywords: ["raw", "advanced", "filter", "api"],
    },
  ];

  function setCredits(openalex = {}) {
    const valueNode = creditsBadge.querySelector(".mw-harvest-credit-value");
    const metaNode = creditsBadge.querySelector(".mw-harvest-credit-meta");
    if (!openalex?.has_api_key) {
      valueNode.textContent = "No key saved";
      metaNode.textContent = "Save an OpenAlex API key in plugin settings to see credits and avoid tighter rate limits.";
      return;
    }
    if (!openalex?.rate_limit) {
      valueNode.textContent = "Unavailable";
      metaNode.textContent = openalex?.rate_limit_error || "OpenAlex did not return credit information.";
      return;
    }
    const remaining = Number(openalex.rate_limit.remaining || 0) || 0;
    const limit = Number(openalex.rate_limit.limit || 0) || 0;
    valueNode.textContent = limit ? `${remaining.toLocaleString()} / ${limit.toLocaleString()}` : remaining.toLocaleString();
    metaNode.textContent = openalex.rate_limit.reset_at
      ? `Resets ${new Date(openalex.rate_limit.reset_at).toLocaleString()}`
      : "Reload to check current OpenAlex credits.";
  }

  function resetFiltersToDefaults() {
    workTypeInput.value = "article";
    languageInput.value = "";
    countryInput.value = "";
    sourceTypeInput.value = "";
    openAccessInput.value = "";
    oaStatusInput.value = "";
    hasPdfInput.value = "";
    hasAbstractInput.value = "true";
    repositoryFulltextInput.value = "";
    retractedInput.value = "";
    yearFromInput.value = "";
    yearToInput.value = "";
    dateFromInput.value = "";
    dateToInput.value = "";
    minCitationsInput.value = "";
    maxCitationsInput.value = "";
    rawFiltersInput.value = "";
  }

  function activeFilters() {
    const chips = [];
    const pushChip = (label, clear) => {
      if (!label) {
        return;
      }
      const button = ctx.createNode("button", {
        className: "mw-filter-chip-remove",
        textContent: "x",
        attrs: { type: "button", "aria-label": `Remove ${label}` },
      });
      if (typeof clear === "function") {
        const handleRemove = (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          clear();
          updateFilterSummary();
          renderFilterBrowser();
        };
        button.addEventListener("mousedown", handleRemove);
        button.addEventListener("click", handleRemove);
      }
      chips.push(ctx.createNode("div", {
        className: "mw-filter-chip",
        children: [
          ctx.createNode("span", { textContent: label }),
          button,
        ],
      }));
    };

    pushChip(workTypeInput.value ? `Type: ${workTypeInput.selectedOptions?.[0]?.textContent || workTypeInput.value}` : "", () => {
      workTypeInput.value = "article";
    });
    pushChip(languageInput.value ? `Language: ${languageInput.selectedOptions?.[0]?.textContent || languageInput.value}` : "", () => {
      languageInput.value = "";
    });
    pushChip(countryInput.value ? `Country: ${countryInput.selectedOptions?.[0]?.textContent || countryInput.value}` : "", () => {
      countryInput.value = "";
    });
    pushChip(sourceTypeInput.value ? `Source: ${sourceTypeInput.selectedOptions?.[0]?.textContent || sourceTypeInput.value}` : "", () => {
      sourceTypeInput.value = "";
    });
    pushChip(triStateLabel(openAccessInput.value, "Open access only", "Closed access only"), () => {
      openAccessInput.value = "";
    });
    pushChip(oaStatusInput.value ? `OA status: ${oaStatusInput.selectedOptions?.[0]?.textContent || oaStatusInput.value}` : "", () => {
      oaStatusInput.value = "";
    });
    pushChip(triStateLabel(hasPdfInput.value, "PDF available", "No PDF"), () => {
      hasPdfInput.value = "";
    });
    pushChip(triStateLabel(hasAbstractInput.value, "With abstract only", "Without abstract only"), () => {
      hasAbstractInput.value = "";
    });
    pushChip(triStateLabel(repositoryFulltextInput.value, "Repository full text", "No repository full text"), () => {
      repositoryFulltextInput.value = "";
    });
    pushChip(triStateLabel(retractedInput.value, "Retracted only", "Exclude retracted works"), () => {
      retractedInput.value = "";
    });
    pushChip(yearFromInput.value ? `From ${yearFromInput.value}` : "", () => {
      yearFromInput.value = "";
    });
    pushChip(yearToInput.value ? `To ${yearToInput.value}` : "", () => {
      yearToInput.value = "";
    });
    pushChip(dateFromInput.value ? `Date from ${dateFromInput.value}` : "", () => {
      dateFromInput.value = "";
    });
    pushChip(dateToInput.value ? `Date to ${dateToInput.value}` : "", () => {
      dateToInput.value = "";
    });
    pushChip(minCitationsInput.value ? `Min citations ${minCitationsInput.value}` : "", () => {
      minCitationsInput.value = "";
    });
    pushChip(maxCitationsInput.value ? `Max citations ${maxCitationsInput.value}` : "", () => {
      maxCitationsInput.value = "";
    });
    rawFiltersInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
      pushChip(`Extra: ${line}`, () => {
        rawFiltersInput.value = rawFiltersInput.value
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter((entry) => entry && entry !== line)
          .join("\n");
      });
    });
    return chips;
  }

  function updateFilterSummary() {
    const host = activeFilterCard.querySelector(".mw-chip-row");
    const chips = activeFilters();
    host.replaceChildren(...(chips.length ? chips : [ctx.createNode("div", {
      className: "mw-empty",
      textContent: "No filters selected beyond the query and default article type.",
    })]));
  }

  function renderFilterBrowser() {
    const term = String(filterSearchInput.value || "").trim().toLowerCase();
    const groups = term
      ? FILTER_GROUPS.map((group) => ({
          ...group,
          fields: filterDefinitions.filter((field) => {
            if (field.group !== group.id) {
              return false;
            }
            const haystack = [
              group.label,
              group.note,
              field.label,
              field.note,
              ...(field.keywords || []),
            ].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(term);
          }),
        })).filter((group) => group.fields.length)
      : FILTER_GROUPS
          .filter((group) => group.id === state.activeFilterGroup)
          .map((group) => ({
            ...group,
            fields: filterDefinitions.filter((field) => field.group === group.id),
          }));

    filterNav.replaceChildren(...FILTER_GROUPS.map((group) => {
      const button = ctx.createNode("button", {
        className: `mw-button mw-harvest-filter-nav-button${group.id === state.activeFilterGroup ? " is-active" : ""}`,
        textContent: group.label,
        attrs: { type: "button" },
      });
      button.addEventListener("click", () => {
        state.activeFilterGroup = group.id;
        renderFilterBrowser();
      });
      return button;
    }));

    if (!groups.length) {
      filterStage.replaceChildren(ctx.createNode("div", {
        className: "mw-empty",
        textContent: "No filters match that search.",
      }));
      return;
    }

    filterStage.replaceChildren(...groups.map((group) =>
      ctx.createNode("div", {
        className: "mw-harvest-filter-group",
        children: [
          ctx.createNode("div", {
            className: "mw-harvest-filter-group-head",
            children: [
              ctx.createNode("div", { className: "mw-harvest-section-title", textContent: group.label }),
              ctx.createNode("div", { className: "mw-note", textContent: group.note }),
            ],
          }),
          ctx.createNode("div", {
            className: "mw-grid",
            children: group.fields.map((field) =>
              harvestField(ctx, field.label, field.input, {
                full: !!field.full,
                note: field.note,
              })
            ),
          }),
        ],
      })
    ));
  }

  function syncQueryModeUI() {
    const semantic = queryModeInput.value === "semantic";
    fieldInput.disabled = semantic;
    queryFieldControl.hidden = semantic;
    if (semantic) {
      queryInput.placeholder = "(e.g. how do digital tools improve diabetes care during pregnancy?)";
      searchModeNote.replaceChildren(
        document.createTextNode("Use a plain-language research question. Native-language queries work well too. OpenAlex semantic search uses page-based paging and returns at most 50 results total. "),
        createExternalLink(ctx, "OpenAlex semantic search docs", OPENALEX_SEARCH_DOCS_URL),
      );
    }
    else {
      queryInput.placeholder = '(e.g. (diabetes OR hyperglycemia) AND ("gestational diabetes" OR pregnancy) NOT mouse)';
      searchModeNote.replaceChildren(
        document.createTextNode("Use AND, OR, and NOT in uppercase. Use double quotes for exact phrases. "),
        createExternalLink(ctx, "OpenAlex Boolean search docs", OPENALEX_SEARCH_DOCS_URL),
      );
    }
  }

  function payloadFromForm(searchMode = "limited") {
    return {
      query: queryInput.value.trim(),
      queryMode: queryModeInput.value,
      field: fieldInput.value,
      sort: sortInput.value,
      sortOrder: sortOrderInput.value,
      year_from: Number(yearFromInput.value || 0) || null,
      year_to: Number(yearToInput.value || 0) || null,
      since: dateFromInput.value.trim(),
      until: dateToInput.value.trim(),
      language: languageInput.value || "",
      work_type: workTypeInput.value || "",
      source_type: sourceTypeInput.value || "",
      country_code: countryInput.value || "",
      is_open_access: openAccessInput.value || "",
      oa_status: oaStatusInput.value || "",
      has_pdf: hasPdfInput.value || "",
      has_abstract: hasAbstractInput.value || "",
      repository_fulltext: repositoryFulltextInput.value || "",
      is_retracted: retractedInput.value || "",
      min_cited_by: Number(minCitationsInput.value || 0) || null,
      max_cited_by: Number(maxCitationsInput.value || 0) || null,
      maxResults: Number(maxResultsInput.value || 0) || 0,
      filters: rawFiltersInput.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      attachment_fetch_mode: attachmentFetchInput.value,
      post_import_action: postImportActionInput.value || "",
      searchMode,
    };
  }

  function formatRunCheckpoint(run = {}) {
    const parts = [];
    const stage = String(run.stage || "").trim();
    if (stage) {
      parts.push(`Stage ${stage}`);
    }
    const pageCount = Number(run.page_count || 0);
    if (pageCount > 0) {
      parts.push(`${pageCount} page${pageCount === 1 ? "" : "s"}`);
    }
    if (Number(run.next_page || 0) > 0) {
      parts.push(`Next page ${Number(run.next_page || 0)}`);
    }
    else if (Number(run.last_page || 0) > 0) {
      parts.push(`Last page ${Number(run.last_page || 0)}`);
    }
    if (String(run.last_cursor || "").trim()) {
      parts.push("Cursor saved");
    }
    const importLineIndex = Number(run.import_line_index || 0);
    if (importLineIndex > 0) {
      parts.push(`Imported ${importLineIndex} NDJSON rows`);
    }
    return parts.join(" - ") || "No checkpoint saved yet.";
  }

  function renderSources(result = {}) {
    const sources = Array.isArray(result.sources) ? result.sources : [];
    const pendingLabel = result.pending_collection_name || "Pending";
    const duplicatesLabel = result.duplicates_collection_name || "Duplicates";
    const embeddingsAvailable = !!(state.config?.embeddings_available ?? result.embeddings_available);
    const importButton = ctx.createNode("button", {
      className: "mw-button",
      textContent: "Import...",
      attrs: { type: "button" },
    });
    importButton.addEventListener("click", () => {
      ctx.setStatus("Opening Harvest import...");
      ctx.invoke("harvest.import", {
        post_import_action: postImportActionInput.value || "",
      })
        .then(async (imported) => {
          if (!imported?.ok) {
            ctx.setStatus("Harvest import cancelled.", "is-ready");
            return;
          }
          await refreshSources();
          ctx.setStatus("Harvest import finished.", "is-ready");
        })
        .catch((error) => {
          ctx.setStatus(error?.message || String(error), "is-error");
        });
    });
    const renderQueuedMergeResult = (merged, entry) => {
      ctx.setStatus(
        `Queued merge for ${merged.source_collection_name || entry.collection_name || "Harvest source"}. Track progress in Jobs.`,
        "is-ready"
      );
    };
    sourcesCard.replaceChildren(
      ctx.createNode("div", {
        className: "mw-harvest-section-head",
        children: [
          ctx.createNode("div", {
            className: "mw-harvest-section-titlebar",
            children: [
              ctx.createNode("h3", { textContent: "Harvest sources" }),
              importButton,
            ],
          }),
          ctx.createNode("div", {
            className: "mw-note",
            textContent: embeddingsAvailable
              ? "Each source can now be queued as Merge only or Merge & Embed. Source items stay in Harvest; merge only copies collection membership."
              : "Queue each source into Pending explicitly. Source items stay in Harvest; merge only copies collection membership.",
          }),
        ],
      }),
      ...(sources.length
        ? sources.map((entry) => {
            const directCount = Number(entry.direct_item_count ?? entry.item_count ?? 0);
            const treeCount = Number(entry.tree_item_count ?? entry.item_count ?? 0);
            const mergeButton = ctx.createNode("button", {
              className: "mw-button",
              textContent: "Merge into Pending",
              attrs: {
                type: "button",
                "data-harvest-merge-source": entry.collection_key || "",
              },
            });
            const mergeEmbedButton = embeddingsAvailable
              ? ctx.createNode("button", {
                  className: "mw-button",
                  textContent: "Merge & Embed",
                  attrs: {
                    type: "button",
                    "data-harvest-merge-embed-source": entry.collection_key || "",
                  },
                })
              : null;
            const queueMerge = async (withEmbeddings = false) => {
              ctx.setStatus(`Queueing ${entry.collection_name || "Harvest source"} for backend merge into ${pendingLabel}${withEmbeddings ? " with embeddings" : ""}...`);
              const merged = await ctx.invoke("harvest.mergeSource", {
                source_collection_key: entry.collection_key,
                with_embeddings: withEmbeddings,
                detach: true,
              });
              state.latestResult = merged;
              renderQueuedMergeResult(merged, entry);
              ctx.setStatus(`Queued backend merge for ${merged.source_collection_name || entry.collection_name || "Harvest source"}. Check the Jobs tab for progress.`, "is-ready");
              await refreshSources();
            };
            mergeButton.addEventListener("click", () => {
              queueMerge(false).catch((error) => {
                ctx.setStatus(error?.message || String(error), "is-error");
              });
            });
            if (mergeEmbedButton) {
              mergeEmbedButton.addEventListener("click", () => {
                queueMerge(true).catch((error) => {
                  ctx.setStatus(error?.message || String(error), "is-error");
                });
              });
            }
            return ctx.createNode("div", {
              className: "mw-output-item",
              children: [
                ctx.createNode("div", {
                  className: "mw-output-main",
                  children: [
                    ctx.createNode("div", { className: "mw-output-name", textContent: entry.collection_name || "Harvest source" }),
                    ctx.createNode("div", {
                      className: "mw-output-meta",
                      textContent: entry.is_openalex
                        ? "OpenAlex imports land here automatically."
                        : entry.is_added_by_user
                          ? "Default folder for manual imports moved from the project root."
                          : "Create source folders under Harvest for RIS or database-specific imports.",
                    }),
                  ],
                }),
                ctx.createNode("div", {
                  className: "mw-output-actions",
                  children: [
                    ctx.createNode("div", {
                      className: "mw-meta",
                      children: [
                        ctx.createNode("div", { className: "mw-badge", textContent: `${directCount} direct` }),
                        ctx.createNode("div", { className: "mw-badge", textContent: `${treeCount} tree` }),
                      ],
                    }),
                    mergeButton,
                    mergeEmbedButton,
                  ].filter(Boolean),
                }),
              ],
            });
          })
        : [ctx.createNode("div", {
            className: "mw-empty",
            textContent: "No Harvest source folders are available yet.",
          })]),
    );
  }

  async function refreshSources() {
    try {
      const result = await ctx.invoke("harvest.listSources");
      renderSources(result || {});
    }
    catch (error) {
      sourcesCard.replaceChildren(
        ctx.createNode("h3", { textContent: "Harvest sources" }),
        ctx.createNode("div", { className: "mw-empty", textContent: error?.message || String(error) }),
      );
    }
  }

  async function refreshConfig({ refreshRateLimit = false, quiet = false } = {}) {
    if (!quiet) {
      ctx.setStatus(refreshRateLimit ? "Refreshing OpenAlex credits..." : "Loading Harvest filters...");
    }
    try {
      const result = await ctx.invoke(refreshRateLimit ? "harvest.getRateLimit" : "harvest.getConfig");
      state.config = result;
      replaceSelectOptions(ctx, workTypeInput, result.form?.work_types || [], {
        previousValue: workTypeInput.value,
        includeAny: true,
        anyLabel: "All work types",
        defaultValue: workTypeInput.value || "article",
      });
      replaceSelectOptions(ctx, languageInput, result.form?.languages || [], {
        previousValue: languageInput.value,
        includeAny: true,
        anyLabel: "All languages",
      });
      replaceSelectOptions(ctx, countryInput, result.form?.countries || [], {
        previousValue: countryInput.value,
        includeAny: true,
        anyLabel: "All countries",
      });
      replaceSelectOptions(ctx, sourceTypeInput, result.form?.source_types || [], {
        previousValue: sourceTypeInput.value,
        includeAny: true,
        anyLabel: "All source types",
      });
      replaceSelectOptions(ctx, oaStatusInput, result.form?.oa_statuses || [], {
        previousValue: oaStatusInput.value,
        includeAny: true,
        anyLabel: "Any OA status",
      });
      replaceExactSelectOptions(
        ctx,
        postImportActionInput,
        result.form?.post_import_actions || [],
        postImportActionInput.value || result.default_post_import_action || ""
      );
      setCredits(result.openalex || {});
      syncQueryModeUI();
      updateFilterSummary();
      renderFilterBrowser();
      await refreshSources().catch(() => {});
      ctx.setStatus("Harvest ready.", "is-ready");
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
      const valueNode = creditsBadge.querySelector(".mw-harvest-credit-value");
      const metaNode = creditsBadge.querySelector(".mw-harvest-credit-meta");
      valueNode.textContent = "Unavailable";
      metaNode.textContent = error?.message || String(error);
    }
  }

  async function run(searchMode) {
    const runningEstimate = searchMode === "estimate";
    ctx.setStatus(runningEstimate ? "Estimating OpenAlex results..." : "Queueing OpenAlex harvest...");
    try {
      if (runningEstimate) {
        estimateInline.hidden = false;
        estimateInline.textContent = "Estimating...";
      }
      else {
        estimateInline.hidden = true;
        estimateInline.textContent = "";
      }
      const result = await ctx.invoke(runningEstimate ? "harvest.estimate" : "harvest.runQueued", payloadFromForm(searchMode));
      state.latestResult = result;
      if (runningEstimate) {
        estimateInline.hidden = false;
        estimateInline.textContent = `Estimated ${String(Number(result.estimated || 0))}. No import started.`;
        ctx.setStatus("Estimate complete.", "is-ready");
      }
      else {
        ctx.setStatus(result?.message || "Harvest queued. Track progress in Jobs.", "is-ready");
      }
      if (runningEstimate) {
        await refreshSources();
      }
      await refreshConfig({ refreshRateLimit: true, quiet: true });
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
      if (runningEstimate) {
        estimateInline.hidden = false;
        estimateInline.textContent = error?.message || String(error);
      }
    }
  }

  [
    queryModeInput,
    fieldInput,
    sortInput,
    sortOrderInput,
    workTypeInput,
    languageInput,
    countryInput,
    sourceTypeInput,
    openAccessInput,
    oaStatusInput,
    hasPdfInput,
    hasAbstractInput,
    repositoryFulltextInput,
    retractedInput,
    yearFromInput,
    yearToInput,
    dateFromInput,
    dateToInput,
    minCitationsInput,
    maxCitationsInput,
    rawFiltersInput,
  ].forEach((input) => {
    input.addEventListener("change", () => {
      syncQueryModeUI();
      updateFilterSummary();
    });
    input.addEventListener("input", () => {
      updateFilterSummary();
    });
  });

  runButton.addEventListener("click", () => run("limited"));
  estimateButton.addEventListener("click", () => run("estimate"));
  refreshCreditsButton.addEventListener("click", () => refreshConfig({ refreshRateLimit: true }));
  queryModeInput.addEventListener("change", () => syncQueryModeUI());
  filterSearchInput.addEventListener("input", () => renderFilterBrowser());
  clearFiltersButton.addEventListener("click", () => {
    resetFiltersToDefaults();
    updateFilterSummary();
    renderFilterBrowser();
  });

  const searchCard = ctx.createNode("div", {
    className: "mw-card mw-harvest-section-card",
    children: [
      ctx.createNode("div", {
        className: "mw-harvest-section-head",
        children: [
          ctx.createNode("h3", { textContent: "Search OpenAlex" }),
          ctx.createNode("div", { className: "mw-note", textContent: "Search OpenAlex, refine with filters, then import supported records into Zotero." }),
        ],
      }),
      ctx.createNode("div", {
        className: "mw-harvest-search-shell",
        children: [
          harvestField(ctx, "Query", queryInput, {
            full: true,
            note: "Articles are selected by default. Keep the query broad, then narrow with filters before importing into Harvest/OpenAlex.",
          }),
          ctx.createNode("div", {
            className: "mw-grid",
            children: [
              harvestField(ctx, "Search strategy", queryModeInput),
              queryFieldControl,
              harvestField(ctx, "Sort", sortInput),
              harvestField(ctx, "Sort order", sortOrderInput),
              harvestField(ctx, "Max results", maxResultsInput, {
                note: "Keeps API tests and trial imports small before you scale up.",
              }),
            ],
          }),
          searchModeNote,
        ],
      }),
    ],
  });

  const filterCard = ctx.createNode("div", {
    className: "mw-card mw-harvest-section-card",
    children: [
      ctx.createNode("div", {
        className: "mw-harvest-section-head",
        children: [
          ctx.createNode("h3", { textContent: "Filters" }),
          ctx.createNode("div", { className: "mw-note", textContent: "Articles and abstract-bearing works are selected by default. Every filter is sent directly to OpenAlex when supported." }),
        ],
      }),
      activeFilterCard,
      ctx.createNode("div", {
        className: "mw-harvest-filter-toolbar",
        children: [
          harvestField(ctx, "Find filter", filterSearchInput),
        ],
      }),
      filterBrowser,
      ctx.createNode("div", {
        className: "mw-note",
        children: [
          document.createTextNode("Advanced filters can use any supported OpenAlex API filter. "),
          createExternalLink(ctx, "OpenAlex filter docs", OPENALEX_FILTER_DOCS_URL),
        ],
      }),
    ],
  });

  const importCard = ctx.createNode("div", {
    className: "mw-card mw-harvest-section-card mw-harvest-side-card",
    children: [
      ctx.createNode("div", {
        className: "mw-harvest-section-head",
        children: [
          ctx.createNode("h3", { textContent: "Run harvest" }),
          ctx.createNode("div", {
            className: "mw-note",
            textContent: "Save the raw OpenAlex search, import it into Harvest/OpenAlex, then choose the exact merge follow-up you want at import time.",
          }),
        ],
      }),
      ctx.createNode("div", {
        className: "mw-card-stack",
        children: [
          harvestField(ctx, "PDF fetching", attachmentFetchInput, {
            note: "For smaller reviews, retrieving documents now can be faster. For larger reviews, it is usually better to wait until after title and abstract screening.",
          }),
          ctx.createNode("div", {
            className: "mw-harvest-help-row",
            children: [
              harvestField(ctx, "Upon importing merge to pending?", postImportActionInput, {
                note: "Choose what should happen right after the OpenAlex import finishes.",
              }),
              createHelpPopover("What these options do", [
                "Merge All & Embed moves every Harvest source into Pending, deduplicates exact matches into Duplicates, then creates title + abstract embeddings.",
                "Merge All does the same merge without creating embeddings.",
                "Merge OpenAlex only & Embed only merges Harvest/OpenAlex, then creates title + abstract embeddings.",
                "Merge OpenAlex only only merges Harvest/OpenAlex, without creating embeddings.",
                "Do not merge leaves imported records in Harvest so you can review and merge later.",
                "Embed options only appear when an Embeddings model is set up in Settings.",
                "These embeddings are used for Semantic Search and semantic screening.",
              ]),
            ],
          }),
          ctx.createNode("div", {
            className: "mw-actions",
            children: [runButton, estimateButton],
          }),
          estimateInline,
        ],
      }),
    ],
  });

  const controlsGrid = ctx.createNode("div", {
    className: "mw-harvest-layout",
    children: [
      ctx.createNode("div", {
        className: "mw-card-stack",
        children: [searchCard, filterCard],
      }),
      ctx.createNode("div", {
        className: "mw-card-stack",
        children: [importCard, sourcesCard, creditsBadge],
      }),
    ],
  });

  panel.append(
    controlsGrid,
  );
  sourcesCard.replaceChildren(
    ctx.createNode("h3", { textContent: "Harvest sources" }),
    ctx.createNode("div", { className: "mw-empty", textContent: "Loading Harvest source folders..." }),
  );

  refreshConfig({ quiet: true }).catch(() => {});
  refreshSources().catch(() => {});
  syncQueryModeUI();
  updateFilterSummary();
  renderFilterBrowser();
  return {
    node: panel,
    destroy() {
      for (const cleanup of state.cleanups.splice(0)) {
        try {
          cleanup?.();
        }
        catch (_error) {}
      }
    },
  };
}
