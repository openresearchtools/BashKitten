var SystematicReviewerWorkflowSearchOptions = (() => {
	const DEFAULT_BASE_URL = "https://api.openalex.org";
	const BOOLEAN_MAX_PAGE_SIZE = 200;
	const SEMANTIC_MAX_PAGE_SIZE = 50;

	const SEARCH_PARAM_MAP = Object.freeze({
		title: "search.title",
		title_and_abstract: "search.title_and_abstract",
		all: "search",
	});

	const LEGACY_FIELD_FILTER_MAP = Object.freeze({
		abstract: "abstract.search",
		author: "raw_author_name.search",
		fulltext: "fulltext.search",
	});

	const SORT_MAP = Object.freeze({
		relevance: "relevance_score",
		date: "publication_date",
		citations: "cited_by_count",
	});

	function optionalString(value) {
		if (value === undefined || value === null) {
			return null;
		}
		let next = String(value).trim();
		return next || null;
	}

	function normalizeStringArray(value) {
		if (!value) {
			return [];
		}
		if (Array.isArray(value)) {
			return value
				.map((entry) => optionalString(entry))
				.filter(Boolean);
		}
		return String(value)
			.split(/\r?\n|,/)
			.map((entry) => optionalString(entry))
			.filter(Boolean);
	}

	function normalizeBoolean(value, fallback = false) {
		return value === undefined || value === null ? !!fallback : !!value;
	}

	function isSemanticQueryMode(value) {
		return optionalString(value) == "semantic";
	}

	function pageSizeLimitForQueryMode(queryMode = "boolean") {
		return isSemanticQueryMode(queryMode) ? SEMANTIC_MAX_PAGE_SIZE : BOOLEAN_MAX_PAGE_SIZE;
	}

	function defaultPageSizeForQueryMode(queryMode = "boolean") {
		return pageSizeLimitForQueryMode(queryMode);
	}

	function normalizePositiveInt(value, fallback = 0) {
		let next = Math.round(Number(value));
		return Number.isFinite(next) && next > 0 ? next : fallback;
	}

	function normalizeOptionalInt(value) {
		if (value === undefined || value === null || value === "") {
			return null;
		}
		let next = Math.round(Number(value));
		return Number.isFinite(next) ? next : null;
	}

	function normalizeTriState(value) {
		if (value === undefined || value === null || value === "") {
			return null;
		}
		if (value === true || String(value).trim().toLowerCase() == "true") {
			return true;
		}
		if (value === false || String(value).trim().toLowerCase() == "false") {
			return false;
		}
		return null;
	}

	function normalizeFilterClause(clause) {
		let raw = optionalString(clause);
		if (!raw) {
			return null;
		}
		if (raw.includes("=")) {
			let [key, value] = raw.split("=", 2);
			if (optionalString(key) && optionalString(value)) {
				return `${String(key).trim()}:${String(value).trim()}`;
			}
		}
		if (raw.includes(":")) {
			let [key, value] = raw.split(":", 2);
			if (optionalString(key) && optionalString(value)) {
				return `${String(key).trim()}:${String(value).trim()}`;
			}
		}
		throw new Error(`Invalid filter '${raw}'. Expected key=value or key:value.`);
	}

	function appendClause(filters, key, value) {
		let cleanKey = optionalString(key);
		let cleanValue = optionalString(value);
		if (!cleanKey || !cleanValue) {
			return;
		}
		filters.push(`${cleanKey}:${cleanValue}`);
	}

	function collectFilterClauses(options) {
		let filters = [];
		for (let clause of normalizeStringArray(options.filters || options.raw_filters || options.rawFilters || [])) {
			let normalized = normalizeFilterClause(clause);
			if (normalized) {
				filters.push(normalized);
			}
		}

		if (optionalString(options.language)) {
			appendClause(filters, "language", String(options.language).trim().toLowerCase());
		}
		if (optionalString(options.since)) {
			appendClause(filters, "from_publication_date", options.since);
		}
		if (optionalString(options.until)) {
			appendClause(filters, "to_publication_date", options.until);
		}
		if (optionalString(options.type_default)) {
			let normalized = normalizeFilterClause(options.type_default);
			if (normalized) {
				filters.push(normalized);
			}
		}
		if (optionalString(options.workType)) {
			appendClause(filters, "type", String(options.workType).trim().toLowerCase());
		}
		if (optionalString(options.countryCode)) {
			appendClause(filters, "authorships.countries", String(options.countryCode).trim().toLowerCase());
		}
		if (optionalString(options.sourceType)) {
			appendClause(filters, "primary_location.source.type", String(options.sourceType).trim().toLowerCase());
		}
		if (optionalString(options.oaStatus)) {
			appendClause(filters, "open_access.oa_status", String(options.oaStatus).trim().toLowerCase());
		}
		if (options.isOpenAccess !== null) {
			appendClause(filters, "open_access.is_oa", options.isOpenAccess ? "true" : "false");
		}
		if (options.hasPdf !== null) {
			appendClause(filters, "has_content.pdf", options.hasPdf ? "true" : "false");
		}
		if (options.repositoryFulltext !== null) {
			appendClause(filters, "open_access.any_repository_has_fulltext", options.repositoryFulltext ? "true" : "false");
		}
		if (options.hasAbstract !== null) {
			appendClause(filters, "has_abstract", options.hasAbstract ? "true" : "false");
		}
		if (options.isRetracted !== null) {
			appendClause(filters, "is_retracted", options.isRetracted ? "true" : "false");
		}
		if (Number.isFinite(options.minCitedBy) && options.minCitedBy !== null) {
			appendClause(filters, "cited_by_count", `>${Math.max(0, Number(options.minCitedBy) - 1)}`);
		}
		if (Number.isFinite(options.maxCitedBy) && options.maxCitedBy !== null) {
			appendClause(filters, "cited_by_count", `<${Math.max(0, Number(options.maxCitedBy) + 1)}`);
		}

		return filters;
	}

	function buildFilterQuery(options) {
		let clauses = collectFilterClauses(options);
		return clauses.length ? clauses.join(",") : null;
	}

	function buildRequestParams(rawOptions) {
		let options = normalizeRequest(rawOptions);
		let params = new URLSearchParams();
		let filterQuery = buildFilterQuery(options);
		let cleanQuery = optionalString(options.query);
		if (cleanQuery) {
			if (options.queryMode == "semantic") {
				params.set("search.semantic", cleanQuery);
			}
			else {
				let searchParam = SEARCH_PARAM_MAP[options.field];
				if (searchParam) {
					params.set(searchParam, cleanQuery);
				}
				else {
					let legacyFilterKey = LEGACY_FIELD_FILTER_MAP[options.field];
					if (!legacyFilterKey) {
						throw new Error(`Unsupported OpenAlex field '${options.field}'.`);
					}
					let fieldClause = `${legacyFilterKey}:${cleanQuery}`;
					filterQuery = filterQuery ? `${fieldClause},${filterQuery}` : fieldClause;
				}
			}
		}
		if (filterQuery) {
			params.set("filter", filterQuery);
		}
		let sortKey = SORT_MAP[options.sort];
		if (!sortKey) {
			throw new Error(`Unsupported OpenAlex sort '${options.sort}'.`);
		}
		let sortOrder = options.sortOrder == "asc" ? "asc" : "desc";
		params.set("sort", `${sortKey}:${sortOrder}`);
		return params;
	}

	function normalizeRequest(raw = {}, defaults = {}) {
		let merged = Object.assign({}, defaults || {}, raw || {});
		let field = optionalString(merged.field) || "title_and_abstract";
		let sort = optionalString(merged.sort) || "relevance";
		let sortOrder = optionalString(merged.sortOrder || merged.sort_order) || "desc";
		let searchMode = optionalString(merged.searchMode || merged.search_mode) || "limited";
		let queryMode = optionalString(merged.queryMode || merged.query_mode) || "boolean";
		let normalizedQueryMode = isSemanticQueryMode(queryMode) ? "semantic" : "boolean";
		let yearFrom = normalizeOptionalInt(merged.yearFrom || merged.year_from);
		let yearTo = normalizeOptionalInt(merged.yearTo || merged.year_to);
		let since = optionalString(merged.since);
		let until = optionalString(merged.until);
		if (!since && Number.isFinite(yearFrom)) {
			since = `${yearFrom}-01-01`;
		}
		if (!until && Number.isFinite(yearTo)) {
			until = `${yearTo}-12-31`;
		}
		let hasAbstract = normalizeTriState(
			merged.hasAbstract !== undefined ? merged.hasAbstract : merged.has_abstract
		);
		let mustHaveAbstract = normalizeBoolean(
			merged.mustHaveAbstract !== undefined ? merged.mustHaveAbstract : merged.must_have_abstract,
			false
		);
		if (hasAbstract === null && mustHaveAbstract) {
			hasAbstract = true;
		}
		let pageSizeLimit = pageSizeLimitForQueryMode(normalizedQueryMode);
		let pageSizeDefault = defaultPageSizeForQueryMode(normalizedQueryMode);
		let pageSize = normalizePositiveInt(merged.pageSize || merged.page_size, pageSizeDefault) || pageSizeDefault;
		pageSize = Math.max(1, Math.min(pageSizeLimit, pageSize));
		let maxResults = normalizePositiveInt(merged.maxResults || merged.max_results, 0);
		if (normalizedQueryMode == "semantic" && maxResults) {
			maxResults = Math.min(SEMANTIC_MAX_PAGE_SIZE, maxResults);
		}
		let page = normalizePositiveInt(merged.page, 1) || 1;
		return {
			query: optionalString(merged.query) || "",
			queryMode: normalizedQueryMode,
			field,
			sort,
			sortOrder: sortOrder == "asc" ? "asc" : "desc",
			searchMode: ["limited", "all", "estimate"].includes(searchMode) ? searchMode : "limited",
			since,
			until,
			yearFrom: Number.isFinite(yearFrom) ? yearFrom : null,
			yearTo: Number.isFinite(yearTo) ? yearTo : null,
			language: optionalString(merged.language),
			type_default: optionalString(merged.type_default),
			workType: optionalString(merged.work_type || merged.workType),
			sourceType: optionalString(merged.source_type || merged.sourceType),
			countryCode: optionalString(merged.country_code || merged.countryCode),
			oaStatus: optionalString(merged.oa_status || merged.oaStatus),
			isOpenAccess: normalizeTriState(
				merged.isOpenAccess !== undefined ? merged.isOpenAccess : merged.is_open_access
			),
			hasPdf: normalizeTriState(
				merged.hasPdf !== undefined ? merged.hasPdf : merged.has_pdf
			),
			repositoryFulltext: normalizeTriState(
				merged.repositoryFulltext !== undefined ? merged.repositoryFulltext : merged.repository_fulltext
			),
			hasAbstract,
			isRetracted: normalizeTriState(
				merged.isRetracted !== undefined ? merged.isRetracted : merged.is_retracted
			),
			minCitedBy: normalizeOptionalInt(merged.min_cited_by || merged.minCitedBy),
			maxCitedBy: normalizeOptionalInt(merged.max_cited_by || merged.maxCitedBy),
			maxResults,
			pageSize,
			rateLimit: Math.max(0, Number(merged.rateLimit || merged.rate_limit || 1) || 1),
			mustHaveAbstract: hasAbstract === true || mustHaveAbstract,
			filters: normalizeStringArray(merged.filters || merged.raw_filters || merged.rawFilters),
			openalexApiKey: optionalString(merged.openalexApiKey || merged.openalex_api_key),
			resumeCursor: normalizeBoolean(
				merged.resumeCursor !== undefined ? merged.resumeCursor : merged.resume_cursor,
				false
			),
			cursor: optionalString(merged.cursor),
			page,
		};
	}

	return {
		DEFAULT_BASE_URL,
		SEARCH_PARAM_MAP,
		LEGACY_FIELD_FILTER_MAP,
		SORT_MAP,
		BOOLEAN_MAX_PAGE_SIZE,
		SEMANTIC_MAX_PAGE_SIZE,
		optionalString,
		normalizeStringArray,
		normalizeBoolean,
		normalizePositiveInt,
		normalizeOptionalInt,
		normalizeTriState,
		isSemanticQueryMode,
		pageSizeLimitForQueryMode,
		defaultPageSizeForQueryMode,
		normalizeRequest,
		collectFilterClauses,
		buildFilterQuery,
		buildRequestParams,
	};
})();
