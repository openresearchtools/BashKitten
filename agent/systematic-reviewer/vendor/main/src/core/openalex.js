var SystematicReviewerWorkflowOpenAlex = (() => {
	let lastRequestAt = 0;
	const OPENALEX_CONTACT_EMAIL = "openresearchtools@gmail.com";
	const PMCID_CONVERTER_BASE_URL = "https://pmc.ncbi.nlm.nih.gov";
	const PMCID_CONVERTER_PATH = "/tools/idconv/api/v1/articles/";
	const PMCID_CONVERTER_TOOL = "SystematicReviewer";
	const PMCID_CONVERTER_EMAIL = "openresearchtools@gmail.com";
	const ENTITY_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
	const RATE_LIMIT_CACHE_TTL_MS = 1000 * 30;
	const requestCache = new Map();

	async function sleep(ms) {
		if (!ms || ms <= 0) {
			return;
		}
		await Zotero.Promise.delay(ms);
	}

	async function respectRateLimit(rateLimitPerSec) {
		let rate = Number(rateLimitPerSec);
		if (!Number.isFinite(rate) || rate <= 0) {
			return;
		}
		let interval = 1000 / rate;
		let now = Date.now();
		let elapsed = now - lastRequestAt;
		if (elapsed < interval) {
			await sleep(interval - elapsed);
		}
		lastRequestAt = Date.now();
	}

	async function requestJSON({
		baseURL = SystematicReviewerWorkflowSearchOptions.DEFAULT_BASE_URL,
		path = "/works",
		params = null,
		apiKey = "",
		rateLimitPerSec = 1,
		timeoutMs = 300000,
		maxRetries = 4,
		dataVersion = "",
	}) {
		let url = new URL(String(path || "/works"), String(baseURL || SystematicReviewerWorkflowSearchOptions.DEFAULT_BASE_URL));
		let query = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
		for (let [key, value] of query.entries()) {
			url.searchParams.set(key, value);
		}
		if (String(baseURL || "").includes("api.openalex.org") && !url.searchParams.get("mailto")) {
			url.searchParams.set("mailto", OPENALEX_CONTACT_EMAIL);
		}
		if (SystematicReviewerWorkflowSearchOptions.optionalString(apiKey)) {
			url.searchParams.set("api_key", String(apiKey).trim());
		}
		if (SystematicReviewerWorkflowSearchOptions.optionalString(dataVersion)) {
			url.searchParams.set("data-version", String(dataVersion).trim());
		}

		let lastError = null;
		for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
			await respectRateLimit(rateLimitPerSec);
			let controller = typeof AbortController == "function" ? new AbortController() : null;
			let timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
			try {
				let response = await fetch(url.toString(), {
					method: "GET",
					headers: {
						Accept: "application/json",
						"User-Agent": "SystematicReviewer-Zotero",
					},
					signal: controller?.signal,
				});
				if (timeout) {
					clearTimeout(timeout);
				}
				if (response.status == 429) {
					let retryAfter = Math.max(1000, Number(response.headers.get("Retry-After")) * 1000 || 1000);
					await sleep(retryAfter);
					continue;
				}
				if (response.status >= 500) {
					await sleep(Math.min(10000, Math.pow(2, attempt - 1) * 1000));
					continue;
				}
				if (!response.ok) {
					let detail = await response.text();
					throw new Error(`OpenAlex error ${response.status}: ${String(detail || "").slice(0, 500)}`);
				}
				return await response.json();
			}
			catch (error) {
				if (timeout) {
					clearTimeout(timeout);
				}
				lastError = error;
				if (attempt >= maxRetries) {
					break;
				}
				await sleep(Math.min(10000, Math.pow(2, attempt - 1) * 1000));
			}
		}
		throw lastError || new Error("OpenAlex request failed");
	}

	function cacheKey(prefix, apiKey = "", extra = "") {
		return [
			String(prefix || "").trim(),
			SystematicReviewerWorkflowSearchOptions.optionalString(apiKey) ? "auth" : "anon",
			String(extra || "").trim(),
		].filter(Boolean).join("::");
	}

	function readFreshCache(key, ttlMs) {
		let cached = requestCache.get(String(key || ""));
		if (!cached) {
			return null;
		}
		if ((Date.now() - Number(cached.stored_at || 0)) > Number(ttlMs || 0)) {
			requestCache.delete(String(key || ""));
			return null;
		}
		return cached.value;
	}

	function writeCache(key, value) {
		requestCache.set(String(key || ""), {
			stored_at: Date.now(),
			value,
		});
		return value;
	}

	function effectivePageSize(options = {}, perPage = null) {
		let limit = SystematicReviewerWorkflowSearchOptions.pageSizeLimitForQueryMode(options?.queryMode);
		let fallback = SystematicReviewerWorkflowSearchOptions.defaultPageSizeForQueryMode(options?.queryMode);
		let requested = Number(perPage) || Number(options?.pageSize) || fallback;
		return Math.max(1, Math.min(limit, requested));
	}

	function paginationMode(options = {}) {
		return SystematicReviewerWorkflowSearchOptions.isSemanticQueryMode(options?.queryMode) ? "page" : "cursor";
	}

	function buildWorksParams(options, pagination = null, perPage = null) {
		let params = SystematicReviewerWorkflowSearchOptions.buildRequestParams(options);
		let next = (pagination && typeof pagination == "object") ? Object.assign({}, pagination) : {};
		let size = effectivePageSize(options, next.perPage ?? perPage);
		params.set("per_page", String(size));
		if (paginationMode(options) == "page") {
			let page = Math.max(1, Math.round(Number(next.page || options.page || 1)) || 1);
			params.set("page", String(page));
		}
		else {
			params.set("cursor", SystematicReviewerWorkflowSearchOptions.optionalString(next.cursor) || SystematicReviewerWorkflowSearchOptions.optionalString(options.cursor) || "*");
		}
		return params;
	}

	function reconstructAbstract(invertedIndex) {
		if (!invertedIndex || typeof invertedIndex != "object") {
			return "";
		}
		let maxIndex = -1;
		for (let positions of Object.values(invertedIndex)) {
			if (!Array.isArray(positions)) {
				continue;
			}
			for (let position of positions) {
				let next = Number(position);
				if (Number.isFinite(next) && next > maxIndex) {
					maxIndex = next;
				}
			}
		}
		if (maxIndex < 0) {
			return "";
		}
		let tokens = Array.from({ length: maxIndex + 1 }, () => "");
		for (let [word, positions] of Object.entries(invertedIndex)) {
			if (!Array.isArray(positions)) {
				continue;
			}
			for (let position of positions) {
				let index = Number(position);
				if (Number.isFinite(index) && index >= 0 && index < tokens.length) {
					tokens[index] = word;
				}
			}
		}
		return tokens.filter(Boolean).join(" ")
			.replace(/\s+([,.;:!?])/g, "$1")
			.replace(/-\s+/g, "-")
			.trim();
	}

	function extractAbstractText(record = {}) {
		if (typeof record.abstract == "string" && record.abstract.trim()) {
			return record.abstract.trim();
		}
		if (record.abstract_inverted_index && typeof record.abstract_inverted_index == "object") {
			return reconstructAbstract(record.abstract_inverted_index);
		}
		if (record.abstract && typeof record.abstract == "object") {
			return reconstructAbstract(record.abstract);
		}
		return "";
	}

	function previewRequest(options, pagination = null, perPage = null) {
		let params = buildWorksParams(options, pagination, perPage);
		return `GET /works?${params.toString()}`;
	}

	function deriveOpenAlexIDSuffix(value, entityPrefix = "") {
		let raw = SystematicReviewerWorkflowSearchOptions.optionalString(value);
		if (!raw) {
			return "";
		}
		let prefix = String(entityPrefix || "").replace(/^\/+|\/+$/g, "").toLowerCase();
		let matcher = prefix ? new RegExp(`${prefix}/([^/?#]+)$`, "i") : /\/([^/?#]+)$/;
		let match = raw.match(matcher);
		if (match && match[1]) {
			return String(match[1]).trim();
		}
		return raw.replace(/^.*\//, "").trim();
	}

	function uniqueOptions(entries = []) {
		let seen = new Set();
		let output = [];
		for (let entry of entries || []) {
			let value = SystematicReviewerWorkflowSearchOptions.optionalString(entry?.value || entry?.id);
			let label = SystematicReviewerWorkflowSearchOptions.optionalString(entry?.label || entry?.display_name || entry?.name || value);
			if (!value || !label || seen.has(value)) {
				continue;
			}
			seen.add(value);
			output.push({ value, label });
		}
		return output.sort((a, b) => String(a.label).localeCompare(String(b.label)));
	}

	async function fetchAllResults({
		path,
		params = null,
		apiKey = "",
		rateLimitPerSec = 3,
		perPage = 200,
		maxPages = 20,
	}) {
		let results = [];
		let cursor = "*";
		for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
			let nextParams = params instanceof URLSearchParams ? new URLSearchParams(params) : new URLSearchParams(params || {});
			if (!nextParams.get("per-page")) {
				nextParams.set("per-page", String(perPage));
			}
			nextParams.set("cursor", cursor || "*");
			let payload = await requestJSON({
				path,
				params: nextParams,
				apiKey,
				rateLimitPerSec,
			});
			let batch = Array.isArray(payload?.results) ? payload.results : [];
			results.push(...batch);
			let nextCursor = SystematicReviewerWorkflowSearchOptions.optionalString(
				payload?.meta?.next_cursor || payload?.next_cursor
			);
			if (!nextCursor || !batch.length) {
				break;
			}
			cursor = nextCursor;
		}
		return results;
	}

	function mapLanguageOption(entry = {}) {
		let value = SystematicReviewerWorkflowSearchOptions.optionalString(
			entry.language_code
			|| entry.code
			|| deriveOpenAlexIDSuffix(entry.id, "languages")
		).toLowerCase();
		let label = SystematicReviewerWorkflowSearchOptions.optionalString(entry.display_name || entry.name || value);
		return value && label ? { value, label } : null;
	}

	function mapCountryOption(entry = {}) {
		let value = SystematicReviewerWorkflowSearchOptions.optionalString(
			entry.country_code
			|| entry.code
			|| deriveOpenAlexIDSuffix(entry.id, "countries")
		).toLowerCase();
		let label = SystematicReviewerWorkflowSearchOptions.optionalString(entry.display_name || entry.name || value);
		return value && label ? { value, label } : null;
	}

	function mapWorkTypeOption(entry = {}) {
		let value = SystematicReviewerWorkflowSearchOptions.optionalString(
			entry.type
			|| deriveOpenAlexIDSuffix(entry.id, "types")
		).toLowerCase();
		let label = SystematicReviewerWorkflowSearchOptions.optionalString(entry.display_name || entry.name || value);
		return value && label ? { value, label } : null;
	}

	function mapSourceTypeOption(entry = {}) {
		let value = SystematicReviewerWorkflowSearchOptions.optionalString(
			entry.type
			|| deriveOpenAlexIDSuffix(entry.id, "source-types")
		).toLowerCase();
		let label = SystematicReviewerWorkflowSearchOptions.optionalString(entry.display_name || entry.name || value);
		return value && label ? { value, label } : null;
	}

	async function fetchHarvestCatalog({ apiKey = "", refresh = false } = {}) {
		let key = cacheKey("harvest_catalog", apiKey);
		if (!refresh) {
			let cached = readFreshCache(key, ENTITY_CACHE_TTL_MS);
			if (cached) {
				return cached;
			}
		}
		let [languagesRaw, countriesRaw, workTypesRaw, sourceTypesRaw] = await Promise.all([
			fetchAllResults({
				path: "/languages",
				apiKey,
				rateLimitPerSec: 3,
				maxPages: 4,
				params: {
					sort: "display_name:asc",
				},
			}),
			fetchAllResults({
				path: "/countries",
				apiKey,
				rateLimitPerSec: 3,
				maxPages: 4,
				params: {
					sort: "display_name:asc",
				},
			}),
			fetchAllResults({
				path: "/work-types",
				apiKey,
				rateLimitPerSec: 3,
				maxPages: 2,
				params: {
					sort: "display_name:asc",
				},
			}),
			fetchAllResults({
				path: "/source-types",
				apiKey,
				rateLimitPerSec: 3,
				maxPages: 2,
				params: {
					sort: "display_name:asc",
				},
			}),
		]);
		return writeCache(key, {
			updated_at: new Date().toISOString(),
			languages: uniqueOptions(languagesRaw.map(mapLanguageOption).filter(Boolean)),
			countries: uniqueOptions(countriesRaw.map(mapCountryOption).filter(Boolean)),
			work_types: uniqueOptions(workTypesRaw.map(mapWorkTypeOption).filter(Boolean)),
			source_types: uniqueOptions(sourceTypesRaw.map(mapSourceTypeOption).filter(Boolean)),
			oa_statuses: [
				{ value: "gold", label: "Gold" },
				{ value: "green", label: "Green" },
				{ value: "hybrid", label: "Hybrid" },
				{ value: "bronze", label: "Bronze" },
				{ value: "closed", label: "Closed" },
			],
		});
	}

	function normalizeRateLimit(data = {}) {
		let source = data?.rate_limit && typeof data.rate_limit == "object" ? data.rate_limit : data;
		return {
			limit: Number(
				source?.limit
				?? source?.max
				?? source?.max_requests
				?? source?.requests_limit
				?? source?.api_max_per_day
				?? source?.credits_limit
				?? 0
			) || 0,
			remaining: Number(
				source?.remaining
				?? source?.remaining_requests
				?? source?.requests_remaining
				?? source?.api_requests_left_today
				?? source?.credits_remaining
				?? 0
			) || 0,
			reset_at: SystematicReviewerWorkflowSearchOptions.optionalString(
				source?.reset_at
				|| source?.resets_at
				|| source?.reset_time
				|| source?.reset
				|| ""
			),
			raw: source,
		};
	}

	async function fetchRateLimitStatus({ apiKey = "", refresh = false } = {}) {
		let cleanKey = SystematicReviewerWorkflowSearchOptions.optionalString(apiKey);
		if (!cleanKey) {
			return {
				ok: false,
				has_api_key: false,
				error: "Save an OpenAlex API key in plugin settings to check credits.",
				rate_limit: null,
			};
		}
		let key = cacheKey("rate_limit", cleanKey);
		if (!refresh) {
			let cached = readFreshCache(key, RATE_LIMIT_CACHE_TTL_MS);
			if (cached) {
				return cached;
			}
		}
		let payload = await requestJSON({
			path: "/rate-limit",
			apiKey: cleanKey,
			rateLimitPerSec: 2,
			params: refresh ? { fresh: "1" } : null,
		});
		let normalized = {
			ok: true,
			has_api_key: true,
			rate_limit: normalizeRateLimit(payload),
		};
		return writeCache(key, normalized);
	}

	function normalizePMCID(value) {
		let raw = String(value || "").trim();
		if (!raw) {
			return "";
		}
		let match = raw.match(/PMC\d+(?:\.\d+)?/i);
		if (match) {
			return match[0].replace(/^pmc/i, "PMC");
		}
		let digits = raw.match(/\d+(?:\.\d+)?/);
		if (digits) {
			return `PMC${digits[0]}`;
		}
		return "";
	}

	async function resolvePmcids(pmcids = []) {
		let unique = Array.from(
			new Set(
				(pmcids || [])
					.map((value) => normalizePMCID(value))
					.filter(Boolean)
			)
		);
		let resolved = {};
		for (let pmcid of unique) {
			resolved[pmcid] = null;
		}
		if (!unique.length) {
			return resolved;
		}

		for (let index = 0; index < unique.length; index += 200) {
			let chunk = unique.slice(index, index + 200);
			let data = await requestJSON({
				baseURL: PMCID_CONVERTER_BASE_URL,
				path: PMCID_CONVERTER_PATH,
				params: {
					format: "json",
					ids: chunk.join(","),
					tool: PMCID_CONVERTER_TOOL,
					email: PMCID_CONVERTER_EMAIL,
				},
				rateLimitPerSec: 3,
			});
			let records = Array.isArray(data?.records) ? data.records : [];
			for (let record of records) {
				let requested = normalizePMCID(record?.["requested-id"] || record?.requested_id || record?.pmcid || "");
				if (!requested) {
					continue;
				}
				resolved[requested] = {
					pmcid: requested,
					pmid: String(record?.pmid || "").trim(),
					doi: String(record?.doi || "").trim(),
					live: record?.live,
					release_date: String(record?.["release-date"] || record?.release_date || "").trim(),
				};
			}
		}
		return resolved;
	}

	async function fetchMeta(options) {
		let params = buildWorksParams(options, paginationMode(options) == "page" ? { page: 1 } : { cursor: options.cursor }, 1);
		return requestJSON({
			params,
			apiKey: options.openalexApiKey,
			rateLimitPerSec: options.rateLimit,
		});
	}

	async function fetchPage(options, pagination = null) {
		return requestJSON({
			params: buildWorksParams(options, pagination, options.pageSize),
			apiKey: options.openalexApiKey,
			rateLimitPerSec: options.rateLimit,
		});
	}

	return {
		sleep,
		requestJSON,
		fetchAllResults,
		buildWorksParams,
		effectivePageSize,
		paginationMode,
		reconstructAbstract,
		extractAbstractText,
		previewRequest,
		fetchHarvestCatalog,
		fetchRateLimitStatus,
		deriveOpenAlexIDSuffix,
		normalizePMCID,
		resolvePmcids,
		fetchMeta,
		fetchPage,
	};
})();
