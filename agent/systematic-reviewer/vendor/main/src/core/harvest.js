var SystematicReviewerWorkflowHarvest = (() => {
	const DEFAULT_ATTACHMENT_FETCH_MODE = "included_only";
	const HARVEST_COLLECTION_NAME = "Harvest";
	const HARVEST_OPENALEX_COLLECTION_NAME = "OpenAlex";
	const HARVEST_ADDED_BY_USER_COLLECTION_NAME = "Added by user";
	const DUPLICATES_COLLECTION_NAME = "Duplicates";
	const MERGE_PROGRESS_REFRESH_INTERVAL = 25;
	const MERGE_PROGRESS_REFRESH_INTERVAL_MS = 750;
	const MERGE_DETAIL_LOG_LIMIT = 50;
	const MERGE_COLLECTION_BATCH_SIZE = 100;
	const MERGE_SCRATCH_FLUSH_SIZE = 20;
	const MERGE_BUFFER_FLUSH_SIZE = 20;
	const MERGE_FIXED_MEMBERSHIP_BATCH_SIZE = 20;
	const MERGE_FIXED_IDENTITY_BATCH_SIZE = 20;
	const HARVEST_RUN_STALE_MS = 1000 * 60 * 5;
	const HARVEST_IMPORT_SLICE_SIZE = 200;
	const COLLECTION_REGISTRY_KEYS = Object.freeze([
		"harvest_root_key",
		"harvest_openalex_key",
		"harvest_user_key",
		"pending_key",
		"included_key",
		"excluded_key",
		"excluded_ft_key",
		"duplicates_key",
	]);

	function optionalString(value) {
		return String(value || "").trim();
	}

	function waitForJobCompletion(payload = {}, defaultWait = true) {
		if (payload?.wait_for_completion === true || payload?.waitForCompletion === true || payload?.await_completion === true) {
			return true;
		}
		if (payload?.wait_for_completion === false || payload?.waitForCompletion === false || payload?.await_completion === false) {
			return false;
		}
		if (payload?.detach === true || payload?.background === true || payload?.queue_only === true || payload?.queueOnly === true) {
			return false;
		}
		return defaultWait;
	}

	function nowStamp() {
		return new Date().toISOString().replace(/[:.]/g, "-");
	}

	function normalizeCollectionRegistry(raw = {}) {
		let next = {};
		for (let key of COLLECTION_REGISTRY_KEYS) {
			next[key] = optionalString(raw?.[key]);
		}
		return next;
	}

	function registryChanged(previous = {}, next = {}) {
		for (let key of COLLECTION_REGISTRY_KEYS) {
			if (optionalString(previous?.[key]) != optionalString(next?.[key])) {
				return true;
			}
		}
		return false;
	}

	function outputRoot(reviewer, context) {
		return reviewer._joinPath(context.outputsDir, "harvest");
	}

	function markdownHeadingBlock(title = "", lines = []) {
		return [
			`#### ${String(title || "Entry").trim()}`,
			"",
			...(Array.isArray(lines) ? lines : []).map((line) => String(line || "")),
		].join("\n").trim();
	}

	function chunkArray(values = [], batchSize = 100) {
		let size = Math.max(1, Number(batchSize || 0) || 100);
		let chunks = [];
		for (let offset = 0; offset < values.length; offset += size) {
			chunks.push(values.slice(offset, offset + size));
		}
		return chunks;
	}

	function mergeScratchRoot(reviewer, context) {
		return reviewer._joinPath(context.jobsDir, "merge-scratch");
	}

	function mergeScratchPath(reviewer, context, jobID = "") {
		let cleanJobID = reviewer._sanitizeFileName(optionalString(jobID) || `merge-${nowStamp()}`);
		return reviewer._joinPath(mergeScratchRoot(reviewer, context), `${cleanJobID}.sqlite`);
	}

	async function closeMergeScratchDB(db) {
		if (!db || db.closed) {
			return;
		}
		try {
			db.closeDatabase?.();
		}
		catch (_error) {}
	}

	async function openMergeScratchDB(reviewer, context, jobID = "") {
		let root = mergeScratchRoot(reviewer, context);
		await reviewer._ensureDirectory(root);
		let path = mergeScratchPath(reviewer, context, jobID);
		await reviewer._removeIfExists(path);
		let db = new Zotero.DBConnection(path);
		await db.queryAsync("PRAGMA journal_mode = WAL");
		await db.queryAsync("PRAGMA synchronous = NORMAL");
		await db.queryAsync("PRAGMA temp_store = MEMORY");
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS active_item_keys (
				item_key TEXT PRIMARY KEY
			) WITHOUT ROWID
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS seen_identifiers (
				identifier_type TEXT NOT NULL,
				identifier_value TEXT NOT NULL,
				item_key TEXT NOT NULL,
				PRIMARY KEY (identifier_type, identifier_value)
			) WITHOUT ROWID
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS processed_source_items (
				item_key TEXT PRIMARY KEY,
				disposition TEXT NOT NULL,
				source_collection_key TEXT,
				source_collection_name TEXT,
				match_type TEXT,
				match_value TEXT,
				matched_item_key TEXT
			) WITHOUT ROWID
		`);
		return {
			db,
			path,
		};
	}

	function mergeIdentifierKey(type = "", value = "") {
		return `${optionalString(type).toLowerCase()}::${optionalString(value)}`;
	}

	function createMergeScratchOverlay() {
		return {
			activeKeys: new Set(),
			identifiers: new Map(),
			processed: new Map(),
		};
	}

	function pushPreviewKey(list = [], value = "") {
		let cleanValue = optionalString(value);
		if (!cleanValue || list.length >= MERGE_DETAIL_LOG_LIMIT) {
			return;
		}
		list.push(cleanValue);
	}

	function pushDetailLog(list = [], entry = null) {
		if (!entry || list.length >= MERGE_DETAIL_LOG_LIMIT) {
			return false;
		}
		list.push(entry);
		return true;
	}

	async function recordHarvestMergeArtifact(reviewer, current, result = {}) {
		if (!current?.context) {
			return null;
		}
		let artifact = await SystematicReviewerWorkflowArtifacts.writeArtifact(reviewer, current.context, {
			category: "harvest",
			kind: "harvest-merge-source",
			extension: "md",
			content: markdownHeadingBlock(
				`${new Date().toISOString()} Harvest Source Merge`,
				[
					`- Source collection key: ${String(result?.source_collection_key || "").trim() || "(unknown)"}`,
					`- Merged to Pending: ${Number(result?.merged_count || result?.pending_count || 0) || 0}`,
					`- Duplicates moved: ${Number(result?.duplicate_count || 0) || 0}`,
					`- Already active: ${Number(result?.already_active_count || 0) || 0}`,
					`- Missing exact identifier: ${Number(result?.no_identifier_count || 0) || 0}`,
				]
			),
		});
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, current.context, {
			category: "harvest",
			headingPath: ["Methods", "Evidence Search"],
			marker: "harvest-runs",
			emptyLabel: "No harvest activity has been logged yet.",
		});
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, current.context, {
			category: "harvest",
			headingPath: ["Appendices", "Search Strategy"],
			marker: "search-strategy-appendix",
			emptyLabel: "No search strategy has been logged yet.",
		});
		return artifact;
	}

	function sanitizeSlug(reviewer, value, fallback = "openalex") {
		let base = String(value || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		return reviewer._sanitizeFileName(base || fallback);
	}

	function serializeSummaryPathEntry(file) {
		return {
			name: file.leafName,
			path: file.path,
			mtime: file.lastModifiedTime || 0,
			size: file.fileSize || 0,
		};
	}

	function summarizeOutputEntry(summary = {}) {
		let skippedCount =
			(Number(summary.skipped_count || 0) || 0)
			|| (
				(Number(summary.skipped_no_supported_identifier || 0) || 0)
				+ (Number(summary.skipped_pmcid_without_pmid || 0) || 0)
				+ (Number(summary.skipped_no_abstract || 0) || 0)
				+ (Number(summary.import_error_count || 0) || 0)
			);
		return {
			query: optionalString(summary.query),
			query_mode: optionalString(summary.query_mode || summary.queryMode),
			mode: optionalString(summary.mode || "run"),
			status: optionalString(summary.status),
			stage: optionalString(summary.stage),
			estimated: Number(summary.estimated || 0) || 0,
			imported_count: Number(summary.imported_count || 0) || 0,
			duplicate_count: Number(summary.duplicate_count || 0) || 0,
			skipped_count: skippedCount,
			total_fetched: Number(summary.total_fetched || 0) || 0,
			ndjson_path: optionalString(summary.ndjson_path),
			attachment_fetch_mode: optionalString(summary.attachment_fetch_mode),
		};
	}

	function listFiles(reviewer, path, predicate = null) {
		let root = reviewer._nsIFile(path);
		if (!root.exists() || !root.isDirectory()) {
			return [];
		}
		let out = [];
		let entries = root.directoryEntries;
		while (entries.hasMoreElements()) {
			let file = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (!predicate || predicate(file)) {
				out.push(file);
			}
		}
		return out;
	}

	async function listOutputs(reviewer, context) {
		let dir = outputRoot(reviewer, context);
		if (!reviewer._pathExists(dir)) {
			return [];
		}
		let files = listFiles(
			reviewer,
			dir,
			(file) => file.isFile() && file.leafName.endsWith(".summary.json")
		)
			.sort((a, b) => (b.lastModifiedTime || 0) - (a.lastModifiedTime || 0));
		let outputs = [];
		for (let file of files) {
			let entry = serializeSummaryPathEntry(file);
			let summary = await reviewer._readJSONFile(file.path);
			outputs.push(Object.assign(entry, summarizeOutputEntry(summary || {})));
		}
		return outputs;
	}

	function harvestRunID() {
		return `harvest-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}

	function stableJSONStringify(value) {
		if (Array.isArray(value)) {
			return `[${value.map((entry) => stableJSONStringify(entry)).join(",")}]`;
		}
		if (value && typeof value == "object") {
			return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJSONStringify(value[key])}`).join(",")}}`;
		}
		return JSON.stringify(value ?? null);
	}

	function hashText(value = "") {
		let hash = 0x811c9dc5;
		for (let char of String(value || "")) {
			hash ^= char.charCodeAt(0);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return hash.toString(16).padStart(8, "0");
	}

	function normalizedHarvestRequestRecord(options = {}, attachmentFetchMode = DEFAULT_ATTACHMENT_FETCH_MODE) {
		return {
			query: optionalString(options.query),
			query_mode: optionalString(options.queryMode || "boolean"),
			field: optionalString(options.field),
			sort: optionalString(options.sort),
			sort_order: optionalString(options.sortOrder || "desc"),
			since: optionalString(options.since),
			until: optionalString(options.until),
			year_from: Number(options.yearFrom || 0) || null,
			year_to: Number(options.yearTo || 0) || null,
			language: optionalString(options.language),
			type_default: optionalString(options.type_default),
			work_type: optionalString(options.workType),
			source_type: optionalString(options.sourceType),
			country_code: optionalString(options.countryCode),
			oa_status: optionalString(options.oaStatus),
			is_open_access: optionalString(options.isOpenAccess),
			has_pdf: optionalString(options.hasPdf),
			has_abstract: optionalString(options.hasAbstract),
			repository_fulltext: optionalString(options.repositoryFulltext),
			is_retracted: optionalString(options.isRetracted),
			min_cited_by: Number(options.minCitedBy || 0) || null,
			max_cited_by: Number(options.maxCitedBy || 0) || null,
			filters: Array.isArray(options.filters) ? options.filters.map((entry) => optionalString(entry)).filter(Boolean) : [],
			compiled_filter_query: optionalString(SystematicReviewerWorkflowSearchOptions.buildFilterQuery(options) || ""),
			must_have_abstract: !!options.mustHaveAbstract,
			max_results: Number(options.maxResults || 0) || null,
			page_size: Number(SystematicReviewerWorkflowOpenAlex.effectivePageSize(options, options.pageSize) || 0) || null,
			pagination_mode: optionalString(SystematicReviewerWorkflowOpenAlex.paginationMode(options)),
			attachment_fetch_mode: optionalString(attachmentFetchMode || DEFAULT_ATTACHMENT_FETCH_MODE),
		};
	}

	function harvestRequestIdentity(options = {}, attachmentFetchMode = DEFAULT_ATTACHMENT_FETCH_MODE) {
		let request = normalizedHarvestRequestRecord(options, attachmentFetchMode);
		let requestJSON = stableJSONStringify(request);
		return {
			request,
			request_json: requestJSON,
			request_hash: hashText(requestJSON),
		};
	}

	function parseRunRequest(row = {}) {
		try {
			let parsed = JSON.parse(String(row?.request_json || "{}") || "{}");
			return parsed && typeof parsed == "object" ? parsed : {};
		}
		catch (_error) {
			return {};
		}
	}

	function harvestRunFreshAt(row = {}) {
		return Number(new Date(
			row?.last_heartbeat_at
			|| row?.updated_at
			|| row?.started_at
			|| row?.created_at
			|| 0
		).getTime() || 0);
	}

	function isIncompleteHarvestRun(row = {}) {
		let status = optionalString(row?.status);
		return status && status != "succeeded";
	}

	function serializeHarvestRun(row = {}) {
		let status = optionalString(row?.status);
		let incomplete = isIncompleteHarvestRun(row);
		let fresh = harvestRunFreshAt(row) > 0 && (Date.now() - harvestRunFreshAt(row)) <= HARVEST_RUN_STALE_MS;
		return {
			run_id: optionalString(row?.run_id),
			job_id: optionalString(row?.job_id),
			source: optionalString(row?.source || "openalex"),
			mode: optionalString(row?.mode || "run"),
			status,
			query: optionalString(row?.query),
			query_mode: optionalString(row?.query_mode),
			pagination_mode: optionalString(row?.pagination_mode),
			summary_path: optionalString(row?.summary_path),
			ndjson_path: optionalString(row?.ndjson_path),
			post_import_action: optionalString(row?.post_import_action),
			stage: optionalString(row?.stage || "fetch"),
			total_fetched: Number(row?.total_fetched || 0) || 0,
			processed_candidates: Number(row?.processed_candidates || 0) || 0,
			imported_count: Number(row?.imported_count || 0) || 0,
			imported_item_count: Number(row?.imported_item_count || 0) || 0,
			duplicate_count: Number(row?.duplicate_count || 0) || 0,
			skipped_no_abstract: Number(row?.skipped_no_abstract || 0) || 0,
			skipped_no_supported_identifier: Number(row?.skipped_no_supported_identifier || 0) || 0,
			skipped_pmcid_without_pmid: Number(row?.skipped_pmcid_without_pmid || 0) || 0,
			converted_pmcid_count: Number(row?.converted_pmcid_count || 0) || 0,
			import_error_count: Number(row?.import_error_count || 0) || 0,
			attachment_fetch_attempted: Number(row?.attachment_fetch_attempted || 0) || 0,
			attachment_fetch_succeeded: Number(row?.attachment_fetch_succeeded || 0) || 0,
			attachment_fetch_failed: Number(row?.attachment_fetch_failed || 0) || 0,
			page_count: Number(row?.page_count || 0) || 0,
			last_cursor: optionalString(row?.last_cursor),
			last_page: Number(row?.last_page || 0) || null,
			next_page: Number(row?.next_page || 0) || null,
			import_line_index: Number(row?.import_line_index || 0) || 0,
			import_candidate_index: Number(row?.import_candidate_index || 0) || 0,
			fetch_completed_at: optionalString(row?.fetch_completed_at),
			last_heartbeat_at: optionalString(row?.last_heartbeat_at),
			error_message: optionalString(row?.error_message),
			created_at: optionalString(row?.created_at),
			started_at: optionalString(row?.started_at),
			completed_at: optionalString(row?.completed_at),
			updated_at: optionalString(row?.updated_at),
			request: parseRunRequest(row),
			is_active: (status == "queued") || (status == "running" && fresh),
			resume_available: incomplete && ["failed", "canceled", "interrupted"].includes(status),
			restart_available: optionalString(row?.mode || "run") == "run",
			stop_available: status == "queued" || status == "running",
		};
	}

	async function updateHarvestRun(reviewer, context, runID, patch = {}) {
		let cleanRunID = optionalString(runID);
		if (!cleanRunID) {
			throw new Error("run_id is required.");
		}
		let entries = Object.entries(patch || {}).filter((entry) => entry[1] !== undefined);
		if (!entries.length) {
			return await loadHarvestRunByID(reviewer, context, cleanRunID);
		}
		let db = await reviewer._projectDB(context);
		let assignments = [];
		let params = [];
		for (let [key, value] of entries) {
			assignments.push(`${key}=?`);
			params.push(value);
		}
		assignments.push("updated_at=?");
		params.push(new Date().toISOString());
		params.push(cleanRunID);
		await db.queryAsync(
			`UPDATE harvest_runs
			 SET ${assignments.join(", ")}
			 WHERE run_id=?`,
			params
		);
		return await loadHarvestRunByID(reviewer, context, cleanRunID);
	}

	async function loadHarvestRunByID(reviewer, context, runID = "") {
		let cleanRunID = optionalString(runID);
		if (!cleanRunID) {
			return null;
		}
		let db = await reviewer._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT *
			 FROM harvest_runs
			 WHERE run_id=?
			 LIMIT 1`,
			[cleanRunID]
		);
		return rows?.[0] || null;
	}

	async function reconcileHarvestRunStaleness(reviewer, context) {
		let db = await reviewer._projectDB(context);
		let cutoffISO = new Date(Date.now() - HARVEST_RUN_STALE_MS).toISOString();
		let staleRows = await db.queryAsync(
			`SELECT run_id, job_id
			 FROM harvest_runs
			 WHERE status='running'
			   AND NOT (stage='import' AND COALESCE(fetch_completed_at, '') != '')
			   AND COALESCE(last_heartbeat_at, updated_at, created_at) < ?`,
			[cutoffISO]
		);
		if (!staleRows?.length) {
			return;
		}
		let now = new Date().toISOString();
		await db.queryAsync(
			`UPDATE harvest_runs
			 SET status='interrupted', error_message=CASE
			 	WHEN error_message IS NULL OR error_message=''
			 	THEN 'Harvest run was interrupted before completion.'
			 	ELSE error_message
			 END, updated_at=?
			 WHERE status='running'
			   AND NOT (stage='import' AND COALESCE(fetch_completed_at, '') != '')
			   AND COALESCE(last_heartbeat_at, updated_at, created_at) < ?`,
			[now, cutoffISO]
		);
		for (let row of staleRows) {
			let jobID = optionalString(row?.job_id);
			if (!jobID) {
				continue;
			}
			await db.queryAsync(
				`UPDATE jobs
				 SET status='failed',
				     error_message=CASE
				     	WHEN error_message IS NULL OR error_message=''
				     	THEN 'Harvest run was interrupted before completion.'
				     	ELSE error_message
				     END,
				     finished_at=COALESCE(finished_at, ?),
				     updated_at=?
				 WHERE job_id=?
				   AND status IN ('queued', 'running')`,
				[now, now, jobID]
			);
		}
	}

	async function listRuns(reviewer, current, options = {}) {
		await reconcileHarvestRunStaleness(reviewer, current.context);
		let db = await reviewer._projectDB(current.context);
		let rows = await db.queryAsync(
			`SELECT *
			 FROM harvest_runs
			 WHERE source='openalex'
			 ORDER BY created_at DESC
			 LIMIT ?`,
			[Math.max(1, Number(options.limit || 25) || 25)]
		);
		let runs = (rows || []).map((row) => serializeHarvestRun(row));
		return {
			ok: true,
			runs,
			total_runs: runs.length,
		};
	}

	function resolveOutputPath(reviewer, context, payload = {}) {
		let root = outputRoot(reviewer, context);
		let requestedPath = optionalString(payload.path);
		let requestedName = optionalString(payload.name);
		let resolvedPath = requestedPath || (requestedName ? reviewer._joinPath(root, requestedName) : "");
		if (!resolvedPath) {
			throw new Error("Provide a harvest report path or file name.");
		}
		let prefix = root.endsWith("/") ? root : `${root}/`;
		if (resolvedPath != root && !resolvedPath.startsWith(prefix)) {
			throw new Error("Harvest report must be inside the current project harvest folder.");
		}
		if (!reviewer._pathExists(resolvedPath)) {
			throw new Error("Harvest report was not found.");
		}
		return resolvedPath;
	}

	async function readOutput(reviewer, context, payload = {}) {
		let path = resolveOutputPath(reviewer, context, payload);
		let text = await reviewer._readFileText(path);
		let name = reviewer._basename(path);
		let file = reviewer._nsIFile(path);
		let entry = {
			name,
			path,
			mtime: file.lastModifiedTime || 0,
			size: file.fileSize || 0,
		};
		let parsed = null;
		try {
			parsed = JSON.parse(text);
		}
		catch (_error) {}
		return {
			ok: true,
			entry,
			format: "json",
			text_preview: text.slice(0, 12000),
			json: parsed,
			outputs: parsed ? summarizeOutputEntry(parsed) : null,
		};
	}

	function normalizeAttachmentFetchMode(payload = {}) {
		let raw = optionalString(
			payload.attachment_fetch_mode
			?? payload.attachmentFetchMode
			?? payload.pdf_fetch_mode
			?? payload.pdfFetchMode
			?? payload.fetch_scope
			?? ""
		).toLowerCase();
		if (payload.fetch_for_all === true || payload.fetchAllPdfs === true || payload.auto_fetch_pdfs === true) {
			raw = "all";
		}
		if (payload.fetch_for_all === false || payload.auto_fetch_pdfs === false) {
			raw = "none";
		}
		if (payload.findFiles === true || payload.saveAttachments === true) {
			raw = "all";
		}
		if (payload.findFiles === false || payload.saveAttachments === false) {
			raw = "none";
		}
		if (!raw) {
			raw = DEFAULT_ATTACHMENT_FETCH_MODE;
		}
		if (!["included_only", "all", "none"].includes(raw)) {
			throw new Error("attachment_fetch_mode must be included_only, all, or none.");
		}
		return raw;
	}

	async function appendNDJSONLines(reviewer, path, rows = []) {
		let lineList = Array.isArray(rows) ? rows.filter((row) => row !== undefined && row !== null) : [];
		if (!lineList.length) {
			return;
		}
		let parent = reviewer._parentPath(path);
		if (parent) {
			await reviewer._ensureDirectory(parent);
		}
		let file = reviewer._nsIFile(path);
		let fos = Components.classes["@mozilla.org/network/file-output-stream;1"]
			.createInstance(Components.interfaces.nsIFileOutputStream);
		fos.init(file, 0x02 | 0x08 | 0x10, 0o664, 0);
		let stream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
			.createInstance(Components.interfaces.nsIConverterOutputStream);
		stream.init(fos, "UTF-8", 4096, "?".charCodeAt(0));
		stream.writeString(lineList.map((row) => `${JSON.stringify(row)}\n`).join(""));
		stream.close();
	}

	function shouldFetchAttachments(mode) {
		return String(mode || "").trim().toLowerCase() == "all";
	}

	function firstValue(values, normalizer) {
		for (let value of values || []) {
			let normalized = normalizer(value);
			if (normalized) {
				return normalized;
			}
		}
		return "";
	}

	function collectPathValues(root, path = []) {
		let cursor = root;
		for (let part of path) {
			if (!cursor || typeof cursor != "object") {
				return [];
			}
			cursor = cursor[part];
		}
		return flattenValues(cursor);
	}

	function flattenValues(value) {
		if (value === undefined || value === null) {
			return [];
		}
		if (Array.isArray(value)) {
			return value.flatMap((entry) => flattenValues(entry));
		}
		if (typeof value == "string" || typeof value == "number") {
			return [String(value)];
		}
		if (typeof value == "object") {
			let out = [];
			for (let entry of Object.values(value)) {
				out.push(...flattenValues(entry));
			}
			return out;
		}
		return [];
	}

	function normalizeDOI(value) {
		let raw = optionalString(value);
		if (!raw) {
			return "";
		}
		let clean = "";
		try {
			clean = Zotero.Utilities.cleanDOI(raw) || "";
		}
		catch (_error) {
			clean = "";
		}
		return optionalString(clean).toLowerCase();
	}

	function normalizePMID(value) {
		let raw = optionalString(value);
		if (!raw) {
			return "";
		}
		let match = raw.match(/(?:pmid[:\s]*)?(\d+)/i);
		return match ? String(match[1]).trim() : "";
	}

	function normalizeArXiv(value) {
		let raw = optionalString(value);
		if (!raw) {
			return "";
		}
		raw = raw.replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "");
		raw = raw.replace(/^arxiv:/i, "");
		raw = raw.replace(/\.pdf$/i, "");
		return optionalString(raw);
	}

	function normalizeISBN(value) {
		let raw = optionalString(value);
		if (!raw) {
			return "";
		}
		let clean = "";
		try {
			clean = Zotero.Utilities.cleanISBN(raw) || "";
		}
		catch (_error) {
			clean = "";
		}
		return optionalString(clean);
	}

	function extractIdentifiers(record = {}) {
		let doi = firstValue([
			...collectPathValues(record, ["ids", "doi"]),
			...collectPathValues(record, ["ids", "DOI"]),
			...collectPathValues(record, ["doi"]),
			...collectPathValues(record, ["DOI"]),
		], normalizeDOI);
		let pmid = firstValue([
			...collectPathValues(record, ["ids", "pmid"]),
			...collectPathValues(record, ["ids", "PMID"]),
			...collectPathValues(record, ["pmid"]),
			...collectPathValues(record, ["PMID"]),
		], normalizePMID);
		let pmcid = firstValue([
			...collectPathValues(record, ["ids", "pmcid"]),
			...collectPathValues(record, ["ids", "PMCID"]),
			...collectPathValues(record, ["pmcid"]),
			...collectPathValues(record, ["PMCID"]),
		], SystematicReviewerWorkflowOpenAlex.normalizePMCID);
		let arxiv = firstValue([
			...collectPathValues(record, ["ids", "arxiv"]),
			...collectPathValues(record, ["ids", "arXiv"]),
			...collectPathValues(record, ["arxiv"]),
			...collectPathValues(record, ["arXiv"]),
			...collectPathValues(record, ["arxiv_id"]),
			...collectPathValues(record, ["ids", "arxiv_id"]),
		], normalizeArXiv);
		let isbn = firstValue([
			...collectPathValues(record, ["ids", "isbn"]),
			...collectPathValues(record, ["ids", "ISBN"]),
			...collectPathValues(record, ["isbn"]),
			...collectPathValues(record, ["ISBN"]),
			...collectPathValues(record, ["biblio", "isbn"]),
			...collectPathValues(record, ["biblio", "ISBN"]),
			...collectPathValues(record, ["biblio", "isbns"]),
		], normalizeISBN);
		return { doi, pmid, pmcid, arxiv, isbn };
	}

	function extractTitle(record = {}) {
		return optionalString(record.title || record.display_name || record.displayName || "");
	}

	function extractOpenAlexID(record = {}) {
		return optionalString(record.id || record.openalex_id || "");
	}

	async function buildImportTarget(record, pmcidMappings = {}) {
		let identifiers = extractIdentifiers(record);
		let converted = null;
		if (identifiers.doi) {
			return {
				identifier: { DOI: identifiers.doi },
				identifier_type: "doi",
				identifier_value: identifiers.doi,
				dedupe_aliases: [{ type: "doi", value: identifiers.doi }],
				identifiers,
				converted_pmcid: null,
			};
		}
		if (identifiers.pmid) {
			return {
				identifier: { PMID: identifiers.pmid },
				identifier_type: "pmid",
				identifier_value: identifiers.pmid,
				dedupe_aliases: [{ type: "pmid", value: identifiers.pmid }],
				identifiers,
				converted_pmcid: null,
			};
		}
		if (identifiers.arxiv) {
			return {
				identifier: { arXiv: identifiers.arxiv },
				identifier_type: "arxiv",
				identifier_value: identifiers.arxiv,
				dedupe_aliases: [{ type: "arxiv", value: identifiers.arxiv }],
				identifiers,
				converted_pmcid: null,
			};
		}
		if (identifiers.isbn) {
			return {
				identifier: { ISBN: identifiers.isbn },
				identifier_type: "isbn",
				identifier_value: identifiers.isbn,
				dedupe_aliases: [{ type: "isbn", value: identifiers.isbn }],
				identifiers,
				converted_pmcid: null,
			};
		}
		if (identifiers.pmcid) {
			converted = pmcidMappings[identifiers.pmcid] || null;
			let mappedPMID = normalizePMID(converted?.pmid);
			let mappedDOI = normalizeDOI(converted?.doi);
			if (mappedPMID) {
				let dedupeAliases = [{ type: "pmid", value: mappedPMID }];
				if (mappedDOI) {
					dedupeAliases.push({ type: "doi", value: mappedDOI });
				}
				return {
					identifier: { PMID: mappedPMID },
					identifier_type: "pmcid_to_pmid",
					identifier_value: mappedPMID,
					dedupe_aliases: dedupeAliases,
					identifiers,
					converted_pmcid: {
						pmcid: identifiers.pmcid,
						pmid: mappedPMID,
						doi: mappedDOI || "",
					},
				};
			}
			return {
				identifier: null,
				identifier_type: "pmcid_unresolved",
				identifier_value: identifiers.pmcid,
				dedupe_aliases: mappedDOI ? [{ type: "doi", value: mappedDOI }] : [],
				identifiers,
				converted_pmcid: {
					pmcid: identifiers.pmcid,
					pmid: mappedPMID || "",
					doi: mappedDOI || "",
				},
			};
		}
		return {
			identifier: null,
			identifier_type: "missing",
			identifier_value: "",
			dedupe_aliases: [],
			identifiers,
			converted_pmcid: null,
		};
	}

	function createDedupeMaps() {
		return {
			doi: new Map(),
			pmid: new Map(),
			arxiv: new Map(),
			isbn: new Map(),
		};
	}

	function indexIdentifier(maps, type, value, itemKey) {
		let cleanType = optionalString(type).toLowerCase();
		let cleanValue = optionalString(value);
		let cleanKey = optionalString(itemKey);
		if (!cleanType || !cleanValue || !cleanKey || !maps[cleanType]) {
			return;
		}
		maps[cleanType].set(cleanValue, cleanKey);
	}

	function indexItemIdentifiers(reviewer, maps, item) {
		let itemKey = optionalString(item?.key);
		if (!itemKey) {
			return;
		}
		indexIdentifier(maps, "doi", normalizeDOI(reviewer._itemField(item, "DOI")), itemKey);
		indexIdentifier(maps, "pmid", normalizePMID(reviewer._itemField(item, "PMID")), itemKey);
		indexIdentifier(maps, "arxiv", normalizeArXiv(reviewer._itemField(item, "arXiv")), itemKey);
		indexIdentifier(maps, "isbn", normalizeISBN(reviewer._itemField(item, "ISBN")), itemKey);
	}

	function buildExistingIdentifierMaps(reviewer, current) {
		let maps = createDedupeMaps();
		for (let item of reviewer._projectCitableItems(current.collection, current.projectItem) || []) {
			indexItemIdentifiers(reviewer, maps, item);
		}
		return maps;
	}

	function findDuplicate(maps, target) {
		for (let alias of target?.dedupe_aliases || []) {
			let type = optionalString(alias?.type).toLowerCase();
			let value = optionalString(alias?.value);
			if (!type || !value || !maps[type]) {
				continue;
			}
			let existingItemKey = maps[type].get(value);
			if (existingItemKey) {
				return {
					item_key: existingItemKey,
					match_type: type,
					match_value: value,
				};
			}
		}
		return null;
	}

	function shouldRefreshMergeProgress(processed = 0, total = 0) {
		if (!processed) {
			return false;
		}
		if (processed >= total) {
			return true;
		}
		return processed % MERGE_PROGRESS_REFRESH_INTERVAL == 0;
	}

	async function yieldMergeLoopIfNeeded(processed = 0, total = 0) {
		if (!shouldRefreshMergeProgress(processed, total)) {
			return;
		}
		if (typeof Zotero?.Promise?.delay == "function") {
			await Zotero.Promise.delay(0);
		}
	}

	async function ensureCollectionMembership(items, collectionIDs = [], options = {}) {
		let itemList = Array.isArray(items) ? items.filter(Boolean) : (items ? [items] : []);
		let targetCollectionIDs = Array.from(new Set((collectionIDs || []).filter(Boolean)));
		if (!itemList.length || !targetCollectionIDs.length) {
			return {
				batches: 0,
				items_added: 0,
			};
		}
		let batchSize = Math.max(1, Number(options.batchSize || 0) || MERGE_COLLECTION_BATCH_SIZE);
		let membershipAdds = new Map();
		let totalAdded = 0;
		let batchCount = 0;
		for (let item of itemList) {
			if (!item?.id) {
				continue;
			}
			let existing = [];
			try {
				existing = item.getCollections?.() || [];
			}
			catch (_error) {
				existing = [];
			}
			let existingSet = new Set(existing || []);
			for (let collectionID of targetCollectionIDs) {
				if (existingSet.has(collectionID)) {
					continue;
				}
				if (!membershipAdds.has(collectionID)) {
					membershipAdds.set(collectionID, []);
				}
				membershipAdds.get(collectionID).push(item.id);
			}
		}
		for (let [collectionID, itemIDs] of membershipAdds) {
			if (!itemIDs.length) {
				continue;
			}
			let collection = Zotero.Collections.get(collectionID);
			if (!collection) {
				continue;
			}
			let offset = 0;
			while (offset < itemIDs.length) {
				let batch = itemIDs.slice(offset, offset + batchSize);
				if (!batch.length) {
					break;
				}
				let startedAt = Date.now();
				let writeMembership = async () => {
					await Zotero.DB.executeTransaction(async () => {
						await collection.addItems(batch);
					});
				};
				if (options.reviewer?._withZoteroWriteLease) {
					await options.reviewer._withZoteroWriteLease(options.current?.context || options.context || null, writeMembership, {
						jobID: String(options.jobID || "").trim(),
						ownerKey: `harvest-membership:${collectionID}:${Math.random().toString(36).slice(2, 8)}`,
					});
				}
				else {
					await writeMembership();
				}
				let elapsedMs = Date.now() - startedAt;
				if (typeof options.onBatchComplete == "function") {
					await options.onBatchComplete({
						collectionID,
						item_ids: batch.slice(),
						batch_size: batch.length,
						elapsed_ms: elapsedMs,
					});
				}
				totalAdded += batch.length;
				batchCount += 1;
				if (typeof Zotero?.Promise?.delay == "function") {
					await Zotero.Promise.delay(0);
				}
				offset += batch.length;
			}
		}
		return {
			batches: batchCount,
			items_added: totalAdded,
		};
	}

	function directChildByKey(root, collectionKey) {
		let key = optionalString(collectionKey);
		if (!root || !key) {
			return null;
		}
		let collection = Zotero.Collections.getByLibraryAndKey(root.libraryID, key);
		return collection?.parentID == root.id ? collection : null;
	}

	function directChildByName(reviewer, root, name) {
		let target = optionalString(name).toLowerCase();
		if (!root || !target) {
			return null;
		}
		for (let node of reviewer?._projectCollectionNodes?.(root) || []) {
			if (node?.parentKey == root.key && optionalString(node.collection?.name).toLowerCase() == target) {
				return node.collection;
			}
		}
		return null;
	}

	async function loadCollectionRegistry(reviewer, context) {
		let stored = await reviewer._storedProjectMetadata(context);
		return normalizeCollectionRegistry(Object.assign(
			{},
			stored?.manifest?.collections || {},
			stored?.settings?.collections || {}
		));
	}

	async function writeCollectionRegistry(reviewer, context, nextRegistry = {}) {
		let registry = normalizeCollectionRegistry(nextRegistry);
		let settings = (await reviewer._readJSONFile(context.settingsPath)) || {};
		let manifest = (await reviewer._readJSONFile(context.manifestPath)) || {};
		settings.collections = Object.assign({}, settings.collections || {}, registry);
		manifest.collections = Object.assign({}, manifest.collections || {}, registry);
		await reviewer._writeJSONFile(context.settingsPath, settings);
		if (Object.keys(manifest).length) {
			await reviewer._writeJSONFile(context.manifestPath, manifest);
		}
		return registry;
	}

	function collectCollectionItems(reviewer, sourceCollection, { includeDescendants = true } = {}) {
		if (!sourceCollection) {
			return [];
		}
		let collections = [sourceCollection];
		if (includeDescendants) {
			try {
				for (let desc of sourceCollection.getDescendents(false, "collection", false) || []) {
					let collection = desc?.id ? Zotero.Collections.get(desc.id) : null;
					if (collection && !collection.deleted) {
						collections.push(collection);
					}
				}
			}
			catch (_error) {}
		}
		let seen = new Set();
		let items = [];
		for (let collection of collections) {
			let directItems = collection.getChildItems ? collection.getChildItems(false, false) : [];
			for (let item of directItems) {
				if (!item || item.deleted || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
					continue;
				}
				let itemKey = optionalString(item.key);
				if (!itemKey || seen.has(itemKey)) {
					continue;
				}
				seen.add(itemKey);
				items.push(item);
			}
		}
		items.sort((a, b) => optionalString(reviewer?._itemField?.(a, "title")).localeCompare(optionalString(reviewer?._itemField?.(b, "title"))));
		return items;
	}

	function buildItemImportTarget(reviewer, item) {
		let doi = normalizeDOI(reviewer._itemField(item, "DOI"));
		let pmid = normalizePMID(reviewer._itemField(item, "PMID"));
		let arxiv = normalizeArXiv(reviewer._itemField(item, "arXiv"));
		let isbn = normalizeISBN(reviewer._itemField(item, "ISBN"));
		let aliases = [];
		if (doi) {
			aliases.push({ type: "doi", value: doi });
		}
		if (pmid) {
			aliases.push({ type: "pmid", value: pmid });
		}
		if (arxiv) {
			aliases.push({ type: "arxiv", value: arxiv });
		}
		if (isbn) {
			aliases.push({ type: "isbn", value: isbn });
		}
		return {
			item_key: optionalString(item?.key),
			dedupe_aliases: aliases,
			identifier_type: aliases[0]?.type || "",
			identifier_value: aliases[0]?.value || "",
		};
	}

	function importTargetAliasKey(alias = {}) {
		let type = optionalString(alias?.type).toLowerCase();
		let value = optionalString(alias?.value);
		return type && value ? `${type}:${value}` : "";
	}

	function isImportableTopLevelItem(item) {
		return !!(
			item
			&& !item.deleted
			&& !item.isAttachment?.()
			&& !item.isNote?.()
			&& !item.isAnnotation?.()
			&& !!item.key
		);
	}

	function itemMatchesImportTarget(reviewer, item, target) {
		if (!isImportableTopLevelItem(item)) {
			return false;
		}
		let itemAliases = new Set(
			(buildItemImportTarget(reviewer, item)?.dedupe_aliases || [])
				.map(importTargetAliasKey)
				.filter(Boolean)
		);
		if (!itemAliases.size) {
			return false;
		}
		for (let alias of target?.dedupe_aliases || []) {
			let aliasKey = importTargetAliasKey(alias);
			if (aliasKey && itemAliases.has(aliasKey)) {
				return true;
			}
		}
		return false;
	}

	function selectImportedItemsForOpenAlexAnnotation(reviewer, items = [], target = null) {
		let topLevelItems = (items || []).filter(isImportableTopLevelItem);
		if (!topLevelItems.length) {
			return [];
		}
		let matched = topLevelItems.filter((item) => itemMatchesImportTarget(reviewer, item, target));
		if (matched.length) {
			return matched;
		}
		if (topLevelItems.length == 1) {
			return topLevelItems;
		}
		return [];
	}

	async function annotateOpenAlexItems(reviewer, items = [], openalexOverrides = new Map(), options = {}) {
		let dirty = [];
		for (let item of items || []) {
			if (!item || item.deleted) {
				continue;
			}
			let itemKey = optionalString(item.key);
			let metadata = openalexOverrides.get(itemKey) || null;
			let openalexID = reviewer?._normalizeOpenAlexID?.(
				typeof metadata == "object" && metadata
					? (metadata.openalex_id || metadata.openalexID || "")
					: (metadata || "")
			);
			let openalexAbstract = String(
				typeof metadata == "object" && metadata
					? (metadata.abstract || "")
					: ""
			).trim();
			if (!openalexID) {
				continue;
			}
			let extra = reviewer._itemField(item, "extra");
			let nextExtra = reviewer._identityExtra(extra, {
				paperID: reviewer._paperIDFromExtra(extra),
				openalexID,
			});
			let currentAbstract = reviewer._itemField(item, "abstractNote");
			let isDirty = false;
			if (reviewer?._shouldUseOpenAlexAbstract?.(currentAbstract, openalexAbstract)) {
				item.setField("abstractNote", openalexAbstract);
				nextExtra = reviewer._abstractOriginExtra(nextExtra, "OpenAlex");
				isDirty = true;
			}
			if (nextExtra != extra) {
				item.setField("extra", nextExtra);
				isDirty = true;
			}
			if (isDirty) {
				dirty.push(item);
			}
		}
		let saveDirty = async () => {
			for (let item of dirty) {
				await item.saveTx();
			}
		};
		if (!dirty.length) {
			return;
		}
		if (reviewer?._withZoteroWriteLease) {
			await reviewer._withZoteroWriteLease(options.current?.context || options.context || null, saveDirty, {
				jobID: String(options.jobID || "").trim(),
				ownerKey: `harvest-annotate:${Math.random().toString(36).slice(2, 8)}`,
			});
			return;
		}
		await saveDirty();
	}

	async function ensureProjectCollections(reviewer, current, options = {}) {
		let root = current?.collection || null;
		if (!root) {
			throw new Error("Open a collection project first.");
		}
		let ensureAddedByUser = options?.ensureAddedByUser === true;
		let registry = await loadCollectionRegistry(reviewer, current.context);
		let previousRegistry = Object.assign({}, registry);
		let reviewCollections = await SystematicReviewerWorkflowScreening.reviewCollections(reviewer, current, {
			createMissing: true,
			includeMaybe: false,
		});
		let harvestRoot =
			directChildByKey(root, registry.harvest_root_key)
			|| directChildByName(reviewer, root, HARVEST_COLLECTION_NAME)
			|| await reviewer._ensureDirectChildCollection(root, HARVEST_COLLECTION_NAME);
		let harvestOpenAlex =
			directChildByKey(harvestRoot, registry.harvest_openalex_key)
			|| directChildByName(reviewer, harvestRoot, HARVEST_OPENALEX_COLLECTION_NAME)
			|| await reviewer._ensureDirectChildCollection(harvestRoot, HARVEST_OPENALEX_COLLECTION_NAME);
		let harvestUser =
			directChildByKey(harvestRoot, registry.harvest_user_key)
			|| directChildByName(reviewer, harvestRoot, HARVEST_ADDED_BY_USER_COLLECTION_NAME)
			|| (ensureAddedByUser
				? await reviewer._ensureDirectChildCollection(harvestRoot, HARVEST_ADDED_BY_USER_COLLECTION_NAME)
				: null);
		let duplicates =
			directChildByKey(root, registry.duplicates_key)
			|| directChildByName(reviewer, root, DUPLICATES_COLLECTION_NAME)
			|| await reviewer._ensureDirectChildCollection(root, DUPLICATES_COLLECTION_NAME);
		registry.harvest_root_key = optionalString(harvestRoot?.key);
		registry.harvest_openalex_key = optionalString(harvestOpenAlex?.key);
		registry.harvest_user_key = optionalString(harvestUser?.key);
		registry.pending_key = optionalString(reviewCollections.pending?.key);
		registry.included_key = optionalString(reviewCollections.included?.key);
		registry.excluded_key = optionalString(reviewCollections.excluded?.key);
		registry.excluded_ft_key = optionalString(reviewCollections.excluded_ft?.key);
		registry.duplicates_key = optionalString(duplicates?.key);
		if (registryChanged(previousRegistry, registry)) {
			await writeCollectionRegistry(reviewer, current.context, registry);
		}
		let sources = [];
		for (let node of reviewer?._projectCollectionNodes?.(root) || []) {
			if (node?.parentKey == harvestRoot.key) {
				sources.push(node.collection);
			}
		}
		sources.sort((a, b) => optionalString(a?.name).localeCompare(optionalString(b?.name)));
		return {
			root,
			harvest: {
				root: harvestRoot,
				openalex: harvestOpenAlex,
				added_by_user: harvestUser,
				sources,
			},
			pending: reviewCollections.pending,
			included: reviewCollections.included,
			excluded: reviewCollections.excluded,
			excluded_ft: reviewCollections.excluded_ft,
			duplicates,
			registry,
		};
	}

	function withExplicitHarvestSources(projectCollections = null, extraSources = []) {
		if (!projectCollections?.harvest?.root) {
			return projectCollections;
		}
		let harvestRoot = projectCollections.harvest.root;
		let existingSources = Array.isArray(projectCollections?.harvest?.sources)
			? projectCollections.harvest.sources.slice()
			: [];
		let byKey = new Map(
			existingSources
				.map((entry) => [optionalString(entry?.key), entry])
				.filter(([key]) => !!key)
		);
		for (let source of Array.isArray(extraSources) ? extraSources : [extraSources]) {
			let key = optionalString(source?.key);
			if (!key || byKey.has(key)) {
				continue;
			}
			let parentMatches = false;
			if (Number(source?.parentID || 0) > 0 && Number(source?.parentID || 0) == Number(harvestRoot?.id || 0)) {
				parentMatches = true;
			}
			else if (optionalString(source?.parentKey) && optionalString(source?.parentKey) == optionalString(harvestRoot?.key)) {
				parentMatches = true;
			}
			if (!parentMatches) {
				continue;
			}
			existingSources.push(source);
			byKey.set(key, source);
		}
		existingSources.sort((a, b) => optionalString(a?.name).localeCompare(optionalString(b?.name)));
		return Object.assign({}, projectCollections, {
			harvest: Object.assign({}, projectCollections.harvest || {}, {
				sources: existingSources,
			}),
		});
	}

	async function importIdentifierIntoCollections({
		reviewer,
		current,
		context,
		jobID,
		libraryID,
		collectionIDs,
		identifier,
	}) {
		let targetCollections = Array.from(new Set((collectionIDs || []).filter(Boolean)));
		let primaryCollectionIDs = targetCollections.length ? [targetCollections[0]] : null;
		let translate = new Zotero.Translate.Search();
		translate.setIdentifier(identifier);
		let translators = await translate.getTranslators();
		if (!translators || !translators.length) {
			throw new Error("No Zotero translator is available for the chosen identifier.");
		}
		translate.setTranslator(translators);
		if (reviewer?._throwIfJobCanceled && current && jobID) {
			await reviewer._throwIfJobCanceled(current, jobID, "Harvest import canceled.");
		}
		let items = await translate.translate({
			libraryID,
			collections: primaryCollectionIDs,
			saveAttachments: false,
		});
		let itemList = Array.isArray(items) ? items.filter(Boolean) : [];
		if (targetCollections.length && itemList.length) {
			try {
				await ensureCollectionMembership(itemList, targetCollections, {
					reviewer,
					current,
					context,
					jobID,
				});
			}
			catch (error) {
				Zotero.logError(error);
			}
		}
		return itemList;
	}

	async function fetchAvailableFiles(items = [], options = {}) {
		let itemList = (items || []).filter(Boolean);
		if (!itemList.length || !Zotero.Attachments?.addAvailableFiles) {
			return {
				ok: true,
				mode: "skipped",
				attempted: 0,
				succeeded: 0,
				failed: [],
			};
		}
		let runBatchFetch = async () => {
			await Zotero.Attachments.addAvailableFiles(itemList);
		};
		try {
			if (options.reviewer?._withZoteroWriteLease) {
				await options.reviewer._withZoteroWriteLease(options.current?.context || options.context || null, runBatchFetch, {
					jobID: String(options.jobID || "").trim(),
					ownerKey: `harvest-fetch:${Math.random().toString(36).slice(2, 8)}`,
				});
			}
			else {
				await runBatchFetch();
			}
			return {
				ok: true,
				mode: "batch",
				attempted: itemList.length,
				succeeded: itemList.length,
				failed: [],
			};
		}
		catch (batchError) {
			let succeeded = 0;
			let failed = [];
			for (let item of itemList) {
				try {
					let runSingleFetch = async () => {
						await Zotero.Attachments.addAvailableFiles([item]);
					};
					if (options.reviewer?._withZoteroWriteLease) {
						await options.reviewer._withZoteroWriteLease(options.current?.context || options.context || null, runSingleFetch, {
							jobID: String(options.jobID || "").trim(),
							ownerKey: `harvest-fetch:${optionalString(item?.key) || Math.random().toString(36).slice(2, 8)}`,
						});
					}
					else {
						await runSingleFetch();
					}
					succeeded += 1;
				}
				catch (error) {
					failed.push({
						item_key: optionalString(item?.key),
						message: error?.message || String(error),
					});
				}
			}
			if (failed.length == itemList.length) {
				Zotero.logError(batchError);
			}
			return {
				ok: failed.length < itemList.length,
				mode: "batch_fallback_single",
				attempted: itemList.length,
				succeeded,
				failed,
			};
		}
	}

	function buildSummaryBase(
		context,
		current,
		options,
		summaryPath,
		resumeState = null,
		attachmentFetchMode = DEFAULT_ATTACHMENT_FETCH_MODE,
		projectCollections = null
	) {
		let normalizedResume = (resumeState && typeof resumeState == "object") ? resumeState : {};
		return {
			project_id: context.projectID,
			project_root: context.projectRoot,
			source: "openalex",
			query: options.query,
			query_mode: options.queryMode || "boolean",
			field: options.field,
			sort: options.sort,
			sort_order: options.sortOrder,
			since: options.since,
			until: options.until,
			year_from: options.yearFrom || null,
			year_to: options.yearTo || null,
			language: options.language || "",
			type_default: options.type_default || "",
			work_type: options.workType || "",
			source_type: options.sourceType || "",
			country_code: options.countryCode || "",
			oa_status: options.oaStatus || "",
			is_open_access: options.isOpenAccess,
			has_pdf: options.hasPdf,
			has_abstract: options.hasAbstract,
			repository_fulltext: options.repositoryFulltext,
			is_retracted: options.isRetracted,
			min_cited_by: options.minCitedBy,
			max_cited_by: options.maxCitedBy,
			filters: options.filters || [],
			compiled_filter_query: SystematicReviewerWorkflowSearchOptions.buildFilterQuery(options) || "",
			must_have_abstract: !!options.mustHaveAbstract,
			max_results: options.maxResults || null,
			page_size: SystematicReviewerWorkflowOpenAlex.effectivePageSize(options, options.pageSize),
			rate_limit: options.rateLimit,
			pagination_mode: SystematicReviewerWorkflowOpenAlex.paginationMode(options),
			resume_cursor: normalizedResume.cursor || null,
			resume_page: Number(normalizedResume.page || 0) || null,
			has_openalex_api_key: !!SystematicReviewerWorkflowSearchOptions.optionalString(options.openalexApiKey),
			summary_path: summaryPath,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			target: {
				library_id: current?.collection?.libraryID || context.libraryID,
				root_collection_key: current?.collection?.key || context.collectionKey,
				root_collection_name: current?.collection?.name || context.collectionName,
				harvest_collection_key: projectCollections?.harvest?.root?.key || "",
				harvest_collection_name: projectCollections?.harvest?.root?.name || HARVEST_COLLECTION_NAME,
				import_collection_key: projectCollections?.harvest?.openalex?.key || "",
				import_collection_name: projectCollections?.harvest?.openalex?.name || HARVEST_OPENALEX_COLLECTION_NAME,
				pending_collection_key: projectCollections?.pending?.key || "",
				pending_collection_name: projectCollections?.pending?.name || "Pending",
			},
			attachment_fetch_mode: attachmentFetchMode,
		};
	}

	async function writeSummary(reviewer, summaryPath, payload) {
		let next = Object.assign({}, payload, {
			updated_at: new Date().toISOString(),
		});
		await reviewer._writeJSONFile(summaryPath, next);
		return next;
	}

	async function estimateHarvest({ reviewer, current, context, options, attachmentFetchMode }) {
		let harvestDir = outputRoot(reviewer, context);
		await reviewer._ensureDirectory(harvestDir);
		let projectCollections = await ensureProjectCollections(reviewer, current);
		let stamp = nowStamp();
		let slug = sanitizeSlug(reviewer, options.query.slice(0, 48), "openalex-estimate");
		let summaryPath = reviewer._joinPath(harvestDir, `${stamp}-${slug}.summary.json`);
		let summary = buildSummaryBase(context, current, options, summaryPath, null, attachmentFetchMode, projectCollections);
		summary.mode = "estimate";
		summary.request_preview = SystematicReviewerWorkflowOpenAlex.previewRequest(options, null, 1);
		let meta = await SystematicReviewerWorkflowOpenAlex.fetchMeta(options);
		let estimated = Number(
			meta?.meta?.count ??
			meta?.meta?.total_count ??
			meta?.meta?.total ??
			meta?.count ??
			0
		) || 0;
		summary.estimated = estimated;
		if (options.mustHaveAbstract) {
			summary.estimate_note = "Estimate is before abstract filtering.";
		}
		summary.status = "succeeded";
		summary.stage = "completed";
		summary.completed_at = new Date().toISOString();
		await writeSummary(reviewer, summaryPath, summary);
		return {
			ok: true,
			mode: "estimate",
			estimated,
			summary_path: summaryPath,
			summary,
		};
	}

	async function countCollectionItems(reviewer, current, sourceCollection, options = {}) {
		if (!sourceCollection) {
			return 0;
		}
		let total = 0;
		await reviewer._eachCollectionCitableItem(
			sourceCollection,
			current?.projectItem || null,
			{
				includeDescendants: options.includeDescendants !== false,
			},
			() => {
				total += 1;
			}
		);
		return total;
	}

	async function summarizeMergeSource(reviewer, current, projectCollections, sourceCollection) {
		let directItemCount = await countCollectionItems(reviewer, current, sourceCollection, {
			includeDescendants: false,
		});
		let treeItemCount = await countCollectionItems(reviewer, current, sourceCollection, {
			includeDescendants: true,
		});
		return {
			source_collection_key: optionalString(sourceCollection?.key),
			source_collection_name: optionalString(sourceCollection?.name),
			source_item_count: treeItemCount,
			direct_item_count: directItemCount,
			tree_item_count: treeItemCount,
			item_count: treeItemCount,
			is_openalex: optionalString(sourceCollection?.key) == optionalString(projectCollections?.harvest?.openalex?.key),
			is_added_by_user: optionalString(sourceCollection?.key) == optionalString(projectCollections?.harvest?.added_by_user?.key),
		};
	}

	async function serializeSourceEntry(reviewer, current, projectCollections, sourceCollection) {
		let summary = await summarizeMergeSource(reviewer, current, projectCollections, sourceCollection);
		return {
			collection_key: summary.source_collection_key,
			collection_name: summary.source_collection_name,
			direct_item_count: summary.direct_item_count,
			tree_item_count: summary.tree_item_count,
			item_count: summary.item_count,
			is_openalex: summary.is_openalex,
			is_added_by_user: summary.is_added_by_user,
		};
	}

	async function embeddingsAvailable(reviewer) {
		return !!(await reviewer?._hasConfiguredEmbeddingsModel?.().catch(() => false));
	}

	function normalizePostImportActionContext(value = "") {
		let raw = optionalString(value).toLowerCase();
		return raw == "manual_import" ? "manual_import" : "openalex";
	}

	function normalizePostImportAction(value = "", embeddingsReady = false, options = {}) {
		let context = normalizePostImportActionContext(options?.context || options?.source || "");
		let raw = optionalString(value).toLowerCase();
		let allowed = new Set(context == "manual_import"
			? [
				"merge_all_embed",
				"merge_all",
				"merge_imported_embed",
				"merge_imported",
				"none",
			]
			: [
				"merge_all_embed",
				"merge_all",
				"merge_openalex_embed",
				"merge_openalex",
				"none",
			]);
		if (!allowed.has(raw)) {
			return embeddingsReady ? "merge_all_embed" : "merge_all";
		}
		if (!embeddingsReady && raw.endsWith("_embed")) {
			return raw.replace(/_embed$/, "") || "merge_all";
		}
		return raw;
	}

	function postImportActionOptions(embeddingsReady = false, options = {}) {
		let context = normalizePostImportActionContext(options?.context || options?.source || "");
		let entries = context == "manual_import"
			? [
				{ value: "merge_all_embed", label: "Merge All & Embed", requires_embeddings: true },
				{ value: "merge_all", label: "Merge All", requires_embeddings: false },
				{ value: "merge_imported_embed", label: "Merge Imported Source Only & Embed", requires_embeddings: true },
				{ value: "merge_imported", label: "Merge Imported Source Only", requires_embeddings: false },
				{ value: "none", label: "Do not merge", requires_embeddings: false },
			]
			: [
				{ value: "merge_all_embed", label: "Merge All & Embed", requires_embeddings: true },
				{ value: "merge_all", label: "Merge All", requires_embeddings: false },
				{ value: "merge_openalex_embed", label: "Merge OpenAlex Only & Embed", requires_embeddings: true },
				{ value: "merge_openalex", label: "Merge OpenAlex Only", requires_embeddings: false },
				{ value: "none", label: "Do not merge", requires_embeddings: false },
			];
		return embeddingsReady ? entries : entries.filter((entry) => !entry.requires_embeddings);
	}

	function postImportActionHelpLines(options = {}) {
		let context = normalizePostImportActionContext(options?.context || options?.source || "");
		let embeddingsReady = options?.embeddingsReady === true;
		let lines = context == "manual_import"
			? [
				"Merge All & Embed moves every Harvest source into Pending, deduplicates exact matches into Duplicates, then creates title + abstract embeddings.",
				"Merge All does the same merge without creating embeddings.",
				"Merge Imported Source Only & Embed only merges the newly imported Harvest source from this manual import, then creates title + abstract embeddings.",
				"Merge Imported Source Only only merges the newly imported Harvest source from this manual import, without creating embeddings.",
				"Do not merge leaves imported records in Harvest so you can review and merge later.",
			]
			: [
				"Merge All & Embed moves every Harvest source into Pending, deduplicates exact matches into Duplicates, then creates title + abstract embeddings.",
				"Merge All does the same merge without creating embeddings.",
				"Merge OpenAlex only & Embed only merges Harvest/OpenAlex, then creates title + abstract embeddings.",
				"Merge OpenAlex only only merges Harvest/OpenAlex, without creating embeddings.",
				"Do not merge leaves imported records in Harvest so you can review and merge later.",
			];
		if (!embeddingsReady) {
			lines.push("Embed options only appear when an Embeddings model is set up in Settings.");
		}
		lines.push("These embeddings are used for Semantic Search and semantic screening.");
		return lines;
	}

	async function queuePendingEmbeddingsFollowup({ reviewer, current, options = {} }) {
		if (!(await embeddingsAvailable(reviewer))) {
			return {
				queued: false,
				embeddings_job: null,
				embeddings_skipped_reason: "No embeddings model is configured, so title+abstract embeddings were skipped.",
				embeddings_error: "",
			};
		}
		try {
			let embeddingsJob = await SystematicReviewerWorkflowEmbeddings.queueEmbeddings({
				reviewer,
				current,
				payload: {
					source_key: "title_abstract",
					scope: "pending",
					resume: true,
				},
				options: {
					openJobsTab: false,
					refreshControllers: false,
					queue_origin: optionalString(options.queue_origin) || "harvest.pending_embeddings",
				},
			});
			return {
				queued: true,
				embeddings_job: embeddingsJob,
				embeddings_skipped_reason: "",
				embeddings_error: "",
			};
		}
		catch (error) {
			return {
				queued: false,
				embeddings_job: null,
				embeddings_skipped_reason: "",
				embeddings_error: String(error?.message || error || "").trim(),
			};
		}
	}

	async function listSources(reviewer, current) {
		let projectCollections = await ensureProjectCollections(reviewer, current);
		let canEmbed = await embeddingsAvailable(reviewer);
		let sources = [];
		for (let entry of projectCollections?.harvest?.sources || []) {
			sources.push(await serializeSourceEntry(reviewer, current, projectCollections, entry));
		}
		return {
			ok: true,
			embeddings_available: canEmbed,
			default_post_import_action: normalizePostImportAction("", canEmbed),
			harvest_collection_key: optionalString(projectCollections?.harvest?.root?.key),
			harvest_collection_name: optionalString(projectCollections?.harvest?.root?.name),
			openalex_collection_key: optionalString(projectCollections?.harvest?.openalex?.key),
			openalex_collection_name: optionalString(projectCollections?.harvest?.openalex?.name),
			user_collection_key: optionalString(projectCollections?.harvest?.added_by_user?.key),
			user_collection_name: optionalString(projectCollections?.harvest?.added_by_user?.name),
			pending_collection_key: optionalString(projectCollections?.pending?.key),
			pending_collection_name: optionalString(projectCollections?.pending?.name),
			included_collection_key: optionalString(projectCollections?.included?.key),
			included_collection_name: optionalString(projectCollections?.included?.name),
			excluded_collection_key: optionalString(projectCollections?.excluded?.key),
			excluded_collection_name: optionalString(projectCollections?.excluded?.name),
			excluded_ft_collection_key: optionalString(projectCollections?.excluded_ft?.key),
			excluded_ft_collection_name: optionalString(projectCollections?.excluded_ft?.name),
			duplicates_collection_key: optionalString(projectCollections?.duplicates?.key),
			duplicates_collection_name: optionalString(projectCollections?.duplicates?.name),
			sources,
		};
	}

	function normalizeSourceCollectionKeys(payload = {}) {
		let rawList = payload?.source_collection_keys
			?? payload?.sourceCollectionKeys
			?? null;
		let values = [];
		if (Array.isArray(rawList)) {
			values = rawList;
		}
		else if (rawList && typeof rawList == "object" && Symbol.iterator in rawList) {
			values = Array.from(rawList);
		}
		else {
			values = [
				payload?.source_collection_key,
				payload?.sourceCollectionKey,
				payload?.collection_key,
				payload?.collectionKey,
			];
		}
		return Array.from(
			new Set(
				values
					.map((value) => optionalString(value))
					.filter(Boolean)
			)
		);
	}

	async function resolveMergePlan(reviewer, current, payload = {}, projectCollections = null) {
		let context = current?.context;
		if (!context || !current?.collection) {
			throw new Error("Open a collection project first.");
		}
		let resolvedCollections = projectCollections || await ensureProjectCollections(reviewer, current);
		let requestedKeys = normalizeSourceCollectionKeys(payload);
		if (!requestedKeys.length) {
			throw new Error("source_collection_key is required.");
		}
		let sourceCollections = [];
		let availableSources = Array.isArray(resolvedCollections?.harvest?.sources)
			? resolvedCollections.harvest.sources
			: [];
		for (let sourceCollectionKey of requestedKeys) {
			let sourceCollection = availableSources.find((entry) => optionalString(entry?.key) == sourceCollectionKey) || null;
			if (!sourceCollection) {
				throw new Error("Select one direct Harvest source subcollection to merge.");
			}
			sourceCollections.push(sourceCollection);
		}
		let sourceSummaries = sourceCollections.map((sourceCollection) => ({
			source_collection_key: optionalString(sourceCollection?.key),
			source_collection_name: optionalString(sourceCollection?.name),
			source_item_count: 0,
			direct_item_count: 0,
			tree_item_count: 0,
			item_count: 0,
			is_openalex: optionalString(sourceCollection?.key) == optionalString(resolvedCollections?.harvest?.openalex?.key),
			is_added_by_user: optionalString(sourceCollection?.key) == optionalString(resolvedCollections?.harvest?.added_by_user?.key),
			counts_pending: true,
		}));
		return {
			context,
			projectCollections: resolvedCollections,
			sourceCollectionKeys: sourceCollections.map((entry) => optionalString(entry?.key)).filter(Boolean),
			sourceCollectionKey: optionalString(sourceCollections[0]?.key),
			sourceCollection: sourceCollections[0] || null,
			sourceCollections,
			sourceSummaries,
			totalSourceItems: 0,
		};
	}

	async function queueMergePlanIntoPending({ reviewer, current, payload = {}, options = {}, resolved = null }) {
		let plan = resolved || await resolveMergePlan(reviewer, current, payload, options.projectCollections || null);
		let withEmbeddings = payload?.with_embeddings === true || payload?.withEmbeddings === true;
		let sourceCount = plan.sourceCollections.length;
		let sourceNames = plan.sourceCollections.map((entry) => optionalString(entry?.name)).filter(Boolean);
		let primarySummary = plan.sourceSummaries[0] || null;
		let job = await reviewer._queueWorkflowJob(current, {
			prefix: "harvest-merge",
			kind: "manual_harvest_merge",
			title: sourceCount == 1
				? `Merge into Pending: ${primarySummary?.source_collection_name || sourceNames[0] || "Harvest source"}`
				: `Merge All Harvest Sources into Pending (${sourceCount})`,
			requested_mode: "merge_to_pending",
			used_mode: "exact_identifier_deduplication",
			source_title: sourceCount == 1
				? `${current.collection?.name || plan.context.collectionName} / ${primarySummary?.source_collection_name || sourceNames[0] || "Harvest source"}`
				: `${current.collection?.name || plan.context.collectionName} / Harvest sources`,
			source_path: plan.context.projectRoot,
			output_path: outputRoot(reviewer, plan.context),
			metadata: {
				payload: {
					source_collection_key: optionalString(primarySummary?.source_collection_key),
					source_collection_keys: plan.sourceCollectionKeys,
					merge_scope: sourceCount > 1 ? "all" : "source",
					with_embeddings: withEmbeddings,
				},
				source_collection_key: optionalString(primarySummary?.source_collection_key),
				source_collection_name: optionalString(primarySummary?.source_collection_name),
				source_collection_keys: plan.sourceCollectionKeys,
				source_summaries: plan.sourceSummaries.map((entry) => ({
					source_collection_key: entry.source_collection_key,
					source_collection_name: entry.source_collection_name,
					source_item_count: entry.source_item_count,
					counts_pending: entry.counts_pending === true,
				})),
				total_source_items: 0,
				source_count: sourceCount,
				source_item_count_pending: true,
				batched: true,
				with_embeddings: withEmbeddings,
				queue_origin: optionalString(options.queue_origin),
			},
			targetWin: options.targetWin || null,
			openJobsTab: options.openJobsTab === true,
			refreshControllers: options.refreshControllers === true,
		});
		let autoFollowup = withEmbeddings
			? {
				queued: false,
				queued_after_merge: true,
				embeddings_job: null,
				embeddings_skipped_reason: "Pending title + abstract embeddings will queue after merge completes.",
				embeddings_error: "",
			}
			: {
				queued: false,
				queued_after_merge: false,
				embeddings_job: null,
				embeddings_skipped_reason: "",
				embeddings_error: "",
			};
		if (options.showMergeNotice === true && reviewer?._showMergeWarningNotice) {
			await reviewer._showMergeWarningNotice(options.targetWin || null, current, {
				sourceCount,
			}).catch(() => null);
		}
		return {
			ok: true,
			queued: true,
			job_id: job.job_id,
			job_kind: "manual_harvest_merge",
			job,
			with_embeddings: withEmbeddings,
			source_collection_key: optionalString(primarySummary?.source_collection_key),
			source_collection_name: optionalString(primarySummary?.source_collection_name),
			source_item_count: 0,
			source_item_count_pending: true,
			merged_sources: sourceCount,
			jobs: [job],
			results: plan.sourceSummaries.map((entry) => ({
				ok: true,
				queued: true,
				job_id: job.job_id,
				job_kind: "manual_harvest_merge",
				source_collection_key: entry.source_collection_key,
				source_collection_name: entry.source_collection_name,
				source_item_count: 0,
				source_item_count_pending: true,
			})),
			pending_collection_key: optionalString(plan.projectCollections.pending?.key),
			pending_collection_name: optionalString(plan.projectCollections.pending?.name),
			duplicates_collection_key: optionalString(plan.projectCollections.duplicates?.key),
			duplicates_collection_name: optionalString(plan.projectCollections.duplicates?.name),
			auto_followup: autoFollowup,
			message: "Merge started. Track progress in Jobs.",
		};
	}

	async function queueMergeSourceIntoPending({ reviewer, current, payload = {}, options = {} }) {
		let projectCollections = withExplicitHarvestSources(
			options.projectCollections || await ensureProjectCollections(reviewer, current),
			options.sourceCollection || options.extraSourceCollections || []
		);
		let resolved = await resolveMergePlan(reviewer, current, payload, projectCollections);
		return await queueMergePlanIntoPending({
			reviewer,
			current,
			payload,
			options: Object.assign({}, options, { projectCollections }),
			resolved,
		});
	}

	async function queueMergeAllSourcesIntoPending({ reviewer, current, payload = {}, options = {} }) {
		let projectCollections = withExplicitHarvestSources(
			await ensureProjectCollections(reviewer, current),
			options.sourceCollection || options.extraSourceCollections || []
		);
		let withEmbeddings = payload?.with_embeddings === true || payload?.withEmbeddings === true;
		let sources = Array.isArray(projectCollections?.harvest?.sources) ? projectCollections.harvest.sources : [];
		if (!sources.length) {
			return {
				ok: true,
				queued: false,
				merged_sources: 0,
				jobs: [],
				results: [],
				message: "No Harvest source subcollections are available to merge.",
			};
		}
		let resolved = await resolveMergePlan(reviewer, current, {
			source_collection_keys: sources.map((entry) => optionalString(entry?.key)).filter(Boolean),
		}, projectCollections);
		let queued = await queueMergePlanIntoPending({
			reviewer,
			current,
			payload,
			options: Object.assign({}, options, {
				projectCollections,
			}),
			resolved,
		});
		return {
			ok: true,
			queued: queued.queued === true,
			with_embeddings: withEmbeddings,
			merged_sources: resolved.sourceCollections.length,
			job_id: queued.job_id,
			job_kind: queued.job_kind,
			job: queued.job,
			jobs: queued.jobs || (queued.job ? [queued.job] : []),
			results: queued.results || [],
			auto_followup: queued.auto_followup,
		};
	}

	async function flushMergeScratchOverlay(db, overlay) {
		if (!db || !overlay) {
			return;
		}
		if (!overlay.activeKeys.size && !overlay.identifiers.size && !overlay.processed.size) {
			return;
		}
		await db.executeTransaction(async () => {
			for (let itemKey of overlay.activeKeys) {
				await db.queryAsync(
					"INSERT OR IGNORE INTO active_item_keys (item_key) VALUES (?)",
					[itemKey]
				);
			}
			for (let entry of overlay.identifiers.values()) {
				await db.queryAsync(
					`INSERT OR IGNORE INTO seen_identifiers (
						identifier_type,
						identifier_value,
						item_key
					) VALUES (?, ?, ?)`,
					[
						optionalString(entry?.type).toLowerCase(),
						optionalString(entry?.value),
						optionalString(entry?.item_key),
					]
				);
			}
			for (let record of overlay.processed.values()) {
				await db.queryAsync(
					`INSERT OR REPLACE INTO processed_source_items (
						item_key,
						disposition,
						source_collection_key,
						source_collection_name,
						match_type,
						match_value,
						matched_item_key
					) VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[
						optionalString(record?.item_key),
						optionalString(record?.disposition),
						optionalString(record?.source_collection_key),
						optionalString(record?.source_collection_name),
						optionalString(record?.match_type),
						optionalString(record?.match_value),
						optionalString(record?.matched_item_key),
					]
				);
			}
		});
		overlay.activeKeys.clear();
		overlay.identifiers.clear();
		overlay.processed.clear();
	}

	async function readProcessedMergeEntry(db, overlay, itemKey) {
		let cleanKey = optionalString(itemKey);
		if (!cleanKey) {
			return null;
		}
		if (overlay?.processed?.has(cleanKey)) {
			return overlay.processed.get(cleanKey) || null;
		}
		let rows = await db.queryAsync(
			`SELECT item_key, disposition, source_collection_key, source_collection_name,
			        match_type, match_value, matched_item_key
			 FROM processed_source_items
			 WHERE item_key=?
			 LIMIT 1`,
			[cleanKey]
		);
		if (!rows?.length) {
			return null;
		}
		let row = rows[0];
		return {
			item_key: optionalString(row?.item_key),
			disposition: optionalString(row?.disposition),
			source_collection_key: optionalString(row?.source_collection_key),
			source_collection_name: optionalString(row?.source_collection_name),
			match_type: optionalString(row?.match_type),
			match_value: optionalString(row?.match_value),
			matched_item_key: optionalString(row?.matched_item_key),
		};
	}

	async function hasActiveMergeItemKey(db, overlay, itemKey) {
		let cleanKey = optionalString(itemKey);
		if (!cleanKey) {
			return false;
		}
		if (overlay?.activeKeys?.has(cleanKey)) {
			return true;
		}
		let rows = await db.queryAsync(
			"SELECT item_key FROM active_item_keys WHERE item_key=? LIMIT 1",
			[cleanKey]
		);
		return !!rows?.length;
	}

	async function findMergeDuplicate(db, overlay, target) {
		for (let alias of target?.dedupe_aliases || []) {
			let type = optionalString(alias?.type).toLowerCase();
			let value = optionalString(alias?.value);
			if (!type || !value) {
				continue;
			}
			let overlayKey = mergeIdentifierKey(type, value);
			if (overlay?.identifiers?.has(overlayKey)) {
				return {
					item_key: optionalString(overlay.identifiers.get(overlayKey)?.item_key),
					match_type: type,
					match_value: value,
				};
			}
			let rows = await db.queryAsync(
				`SELECT item_key
				 FROM seen_identifiers
				 WHERE identifier_type=? AND identifier_value=?
				 LIMIT 1`,
				[type, value]
			);
			if (rows?.length) {
				return {
					item_key: optionalString(rows[0]?.item_key),
					match_type: type,
					match_value: value,
				};
			}
		}
		return null;
	}

	function createSourceMergeResult(summary = {}) {
		return {
			source_collection_key: optionalString(summary?.source_collection_key),
			source_collection_name: optionalString(summary?.source_collection_name),
			source_item_count: Number(summary?.source_item_count || 0) || 0,
			merged_count: 0,
			duplicate_count: 0,
			already_active_count: 0,
			no_identifier_count: 0,
			skipped_repeat_source_count: 0,
		};
	}

	async function hydrateProjectItemIdentitiesInSlices(reviewer, context, items = [], overridesByItemKey = null, options = {}) {
		let itemList = Array.from(
			new Map(
				(items || [])
					.filter((item) =>
						item
						&& !item.deleted
						&& !!item.key
						&& !item.isAttachment?.()
						&& !item.isNote?.()
						&& !item.isAnnotation?.()
					)
					.map((item) => [optionalString(item?.key), item])
			).values()
		);
		if (!itemList.length) {
			return {
				batches: 0,
				items_hydrated: 0,
			};
		}
		let overrideMap = overridesByItemKey instanceof Map
			? overridesByItemKey
			: new Map(
				Object.entries(overridesByItemKey || {}).map(([key, value]) => [optionalString(key), value || {}])
			);
		let batchSize = Math.max(1, Number(options.batchSize || 0) || MERGE_FIXED_IDENTITY_BATCH_SIZE);
		let batches = 0;
		let itemsHydrated = 0;
		for (let offset = 0; offset < itemList.length;) {
			let batch = itemList.slice(offset, offset + batchSize);
			if (!batch.length) {
				break;
			}
			let batchOverrides = new Map();
			for (let item of batch) {
				let itemKey = optionalString(item?.key);
				if (itemKey && overrideMap.has(itemKey)) {
					batchOverrides.set(itemKey, overrideMap.get(itemKey));
				}
			}
			let startedAt = Date.now();
			if (reviewer?._ensureProjectItemIdentities) {
				await reviewer._ensureProjectItemIdentities(context, batch, batchOverrides);
			}
			else if (reviewer?._ensureProjectItemIdentitiesBatched) {
				await reviewer._ensureProjectItemIdentitiesBatched(context, batch, batchOverrides, batch.length);
			}
			let elapsedMs = Date.now() - startedAt;
			batches += 1;
			itemsHydrated += batch.length;
			if (typeof options.onBatchComplete == "function") {
				await options.onBatchComplete({
					batch_size: batch.length,
					elapsed_ms: elapsedMs,
				});
			}
			offset += batch.length;
			if (typeof Zotero?.Promise?.delay == "function") {
				await Zotero.Promise.delay(0);
			}
		}
		return {
			batches,
			items_hydrated: itemsHydrated,
		};
	}

	async function flushMergeMembershipBuffers(reviewer, current, context, projectCollections, state) {
		let flushed = {
			pending_items: state.pendingItems.length,
			duplicate_items: state.duplicateItems.length,
			pending_batches: 0,
			duplicate_batches: 0,
			identity_batches: 0,
			identity_items: 0,
		};
		if (state.pendingItems.length) {
			await ensureCollectionMembership(state.pendingItems, [projectCollections.pending.id], {
				reviewer,
				current,
				context,
				jobID: String(state.jobID || "").trim(),
				batchSize: MERGE_FIXED_MEMBERSHIP_BATCH_SIZE,
				onBatchComplete: async () => {
					flushed.pending_batches += 1;
				},
			});
			if (reviewer?._ensureProjectItemIdentities || reviewer?._ensureProjectItemIdentitiesBatched) {
				let identityResult = await hydrateProjectItemIdentitiesInSlices(
					reviewer,
					context,
					state.pendingItems,
					state.pendingIdentityOverrides,
					{
						batchSize: MERGE_FIXED_IDENTITY_BATCH_SIZE,
						onBatchComplete: async () => {
							flushed.identity_batches += 1;
						},
					}
				);
				flushed.identity_items = Number(identityResult?.items_hydrated || 0) || 0;
			}
			state.pendingItems = [];
			state.pendingIdentityOverrides = new Map();
		}
		if (state.duplicateItems.length) {
			await ensureCollectionMembership(state.duplicateItems, [projectCollections.duplicates.id], {
				reviewer,
				current,
				context,
				jobID: String(state.jobID || "").trim(),
				batchSize: MERGE_FIXED_MEMBERSHIP_BATCH_SIZE,
				onBatchComplete: async () => {
					flushed.duplicate_batches += 1;
				},
			});
			state.duplicateItems = [];
		}
		return flushed;
	}

	async function maybeReportMergeProgress(reviewer, current, jobID, processed, total, state, options = {}) {
		let now = Date.now();
		let force = options.force === true;
		if (!force && now - Number(state.lastProgressAt || 0) < MERGE_PROGRESS_REFRESH_INTERVAL_MS) {
			return;
		}
		state.lastProgressAt = now;
		await SystematicReviewerWorkflowJobs.progress(
			reviewer,
			current,
			jobID,
			Number(processed || 0) || 0,
			Math.max(Number(total || 0) || 0, Number(processed || 0) || 0),
			String(
				options.message
				|| `Checked ${processed}/${Math.max(total, processed)}. Pending ${state.mergedCount}, duplicates ${state.duplicateCount}, already active ${state.alreadyActiveCount}, repeated ${state.skippedRepeatSourceCount}.`
			),
			{
				refresh: true,
				force_refresh: force,
			}
		);
	}

	async function mergeSourceIntoPending({ reviewer, current, payload = {} }) {
		let existingJobID = optionalString(
			payload?.existing_job_id
			?? payload?.existingJobID
			?? payload?.job_id
			?? payload?.jobID
		);
		let withEmbeddings = payload?.with_embeddings === true || payload?.withEmbeddings === true;
		if (!existingJobID) {
			let resolvedPlan = await resolveMergePlan(reviewer, current, payload);
			let queued = await queueMergePlanIntoPending({
				reviewer,
				current,
				payload,
				options: {
					showMergeNotice: false,
				},
				resolved: resolvedPlan,
			});
			if (!queued?.job_id || !waitForJobCompletion(payload, true)) {
				return queued;
			}
			return await reviewer._awaitJobCompletion(current?.context?.projectID || "", queued.job_id);
		}
		let job = { job_id: existingJobID };
		let scratch = null;
		try {
			let resolved = await resolveMergePlan(reviewer, current, payload);
			let context = resolved.context;
			let projectCollections = resolved.projectCollections;
			let sourceCollections = resolved.sourceCollections;
			let sourceResults = resolved.sourceSummaries.map((entry) => createSourceMergeResult(entry));
			let sourceResultByKey = new Map(sourceResults.map((entry) => [entry.source_collection_key, entry]));
			scratch = await openMergeScratchDB(reviewer, context, job.job_id);
			let overlay = createMergeScratchOverlay();
			let state = {
				jobID: job.job_id,
				pendingItems: [],
				duplicateItems: [],
				pendingIdentityOverrides: new Map(),
				mergedCount: 0,
				duplicateCount: 0,
				alreadyActiveCount: 0,
				noIdentifierCount: 0,
				skippedRepeatSourceCount: 0,
				mergedItemKeys: [],
				duplicateItemKeys: [],
				alreadyActiveItemKeys: [],
				noIdentifierItemKeys: [],
				detailLogs: [],
				omittedDetailLogs: 0,
				lastProgressAt: 0,
			};
			let processed = 0;
			await SystematicReviewerWorkflowJobs.log(
				reviewer,
				current,
				job.job_id,
				"info",
				`Seeding exact-ID merge index from the active workflow scope using live Zotero collection membership.`,
				{ refresh: false }
			);
			await reviewer._eachProjectCitableItem(
				current.collection,
				current.projectItem,
				null,
				async (item) => {
					let itemKey = optionalString(item?.key);
					if (!itemKey) {
						return;
					}
					overlay.activeKeys.add(itemKey);
					let target = buildItemImportTarget(reviewer, item);
					for (let alias of target.dedupe_aliases || []) {
						let type = optionalString(alias?.type).toLowerCase();
						let value = optionalString(alias?.value);
						if (!type || !value) {
							continue;
						}
						overlay.identifiers.set(mergeIdentifierKey(type, value), {
							type,
							value,
							item_key: itemKey,
						});
					}
					if (
						overlay.activeKeys.size >= MERGE_SCRATCH_FLUSH_SIZE
						|| overlay.identifiers.size >= MERGE_SCRATCH_FLUSH_SIZE
					) {
						await flushMergeScratchOverlay(scratch.db, overlay);
					}
				},
				{
					dedupe: true,
				}
			);
			await flushMergeScratchOverlay(scratch.db, overlay);
			await SystematicReviewerWorkflowJobs.log(
				reviewer,
				current,
				job.job_id,
				"info",
				`Processing ${sourceCollections.length} Harvest source${sourceCollections.length == 1 ? "" : "s"} as one bounded-memory merge job.`,
				{ refresh: false }
			);
			for (let sourceCollection of sourceCollections) {
				let sourceKey = optionalString(sourceCollection?.key);
				let sourceName = optionalString(sourceCollection?.name);
				let sourceResult = sourceResultByKey.get(sourceKey) || createSourceMergeResult({
					source_collection_key: sourceKey,
					source_collection_name: sourceName,
				});
				if (!sourceResultByKey.has(sourceKey)) {
					sourceResultByKey.set(sourceKey, sourceResult);
					sourceResults.push(sourceResult);
				}
				await SystematicReviewerWorkflowJobs.log(
					reviewer,
					current,
					job.job_id,
					"info",
					`Scanning Harvest source "${sourceName || sourceKey}".`,
					{ refresh: false }
				);
				await reviewer._eachCollectionCitableItem(
					sourceCollection,
					current.projectItem,
					{
						includeDescendants: true,
					},
					async (item) => {
						processed += 1;
						let itemKey = optionalString(item?.key);
						sourceResult.source_item_count += 1;
						if (!itemKey) {
							await yieldMergeLoopIfNeeded(processed, resolved.totalSourceItems);
							return;
						}
						let previouslyProcessed = await readProcessedMergeEntry(scratch.db, overlay, itemKey);
						if (previouslyProcessed) {
							sourceResult.skipped_repeat_source_count += 1;
							state.skippedRepeatSourceCount += 1;
							await yieldMergeLoopIfNeeded(processed, resolved.totalSourceItems);
							return;
						}
						let target = buildItemImportTarget(reviewer, item);
						let disposition = "";
						let detailEntry = null;
						let matchType = "";
						let matchValue = "";
						let matchedItemKey = "";
						if (await hasActiveMergeItemKey(scratch.db, overlay, itemKey)) {
							disposition = "already_active";
							sourceResult.already_active_count += 1;
							state.alreadyActiveCount += 1;
							pushPreviewKey(state.alreadyActiveItemKeys, itemKey);
							detailEntry = {
								item_key: itemKey,
								status: "already_active",
							};
						}
						else {
							let duplicate = await findMergeDuplicate(scratch.db, overlay, target);
							if (duplicate) {
								disposition = "duplicate";
								matchType = optionalString(duplicate.match_type);
								matchValue = optionalString(duplicate.match_value);
								matchedItemKey = optionalString(duplicate.item_key);
								sourceResult.duplicate_count += 1;
								state.duplicateCount += 1;
								state.duplicateItems.push(item);
								pushPreviewKey(state.duplicateItemKeys, itemKey);
								detailEntry = {
									item_key: itemKey,
									status: "duplicate",
									match_type: matchType,
									match_value: matchValue,
									existing_item_key: matchedItemKey,
								};
							}
							else {
								disposition = target.dedupe_aliases.length ? "merged" : "merged_without_identifier";
								sourceResult.merged_count += 1;
								state.mergedCount += 1;
								state.pendingItems.push(item);
								pushPreviewKey(state.mergedItemKeys, itemKey);
								overlay.activeKeys.add(itemKey);
								for (let alias of target.dedupe_aliases || []) {
									let type = optionalString(alias?.type).toLowerCase();
									let value = optionalString(alias?.value);
									if (!type || !value) {
										continue;
									}
									overlay.identifiers.set(mergeIdentifierKey(type, value), {
										type,
										value,
										item_key: itemKey,
									});
								}
								if (!target.dedupe_aliases.length) {
									sourceResult.no_identifier_count += 1;
									state.noIdentifierCount += 1;
									pushPreviewKey(state.noIdentifierItemKeys, itemKey);
								}
								let openalexID = reviewer?._openAlexIDFromExtra?.(reviewer._itemField(item, "extra")) || "";
								if (openalexID) {
									state.pendingIdentityOverrides.set(itemKey, { openalex_id: openalexID });
								}
								detailEntry = {
									item_key: itemKey,
									status: disposition,
								};
							}
						}
						overlay.processed.set(itemKey, {
							item_key: itemKey,
							disposition,
							source_collection_key: sourceKey,
							source_collection_name: sourceName,
							match_type: matchType,
							match_value: matchValue,
							matched_item_key: matchedItemKey,
						});
						if (detailEntry && !pushDetailLog(state.detailLogs, detailEntry)) {
							state.omittedDetailLogs += 1;
						}
						if (
							overlay.activeKeys.size >= MERGE_SCRATCH_FLUSH_SIZE
							|| overlay.identifiers.size >= MERGE_SCRATCH_FLUSH_SIZE
							|| overlay.processed.size >= MERGE_SCRATCH_FLUSH_SIZE
						) {
							await flushMergeScratchOverlay(scratch.db, overlay);
						}
						if (
							state.pendingItems.length >= MERGE_BUFFER_FLUSH_SIZE
							|| state.duplicateItems.length >= MERGE_BUFFER_FLUSH_SIZE
						) {
							let flushed = await flushMergeMembershipBuffers(reviewer, current, context, projectCollections, state);
							if (flushed.pending_items || flushed.duplicate_items) {
								await maybeReportMergeProgress(
									reviewer,
									current,
									job.job_id,
									processed,
									resolved.totalSourceItems,
									state,
									{
										message: `Processed ${processed} items. Flushed ${flushed.pending_items} Pending and ${flushed.duplicate_items} Duplicates${flushed.identity_items ? `; hydrated ${flushed.identity_items} identity records` : ""}.`,
									}
								);
							}
						}
						await yieldMergeLoopIfNeeded(processed, resolved.totalSourceItems);
					}
				);
				await flushMergeScratchOverlay(scratch.db, overlay);
				let sourceFlush = await flushMergeMembershipBuffers(reviewer, current, context, projectCollections, state);
				await SystematicReviewerWorkflowJobs.log(
					reviewer,
					current,
					job.job_id,
					"info",
					`Finished "${sourceName || sourceKey}": Pending ${sourceResult.merged_count}, duplicates ${sourceResult.duplicate_count}, already active ${sourceResult.already_active_count}, repeated ${sourceResult.skipped_repeat_source_count}.`,
					{ refresh: false }
				);
				await maybeReportMergeProgress(
					reviewer,
					current,
					job.job_id,
					processed,
					resolved.totalSourceItems,
					state,
					{
						force: true,
						message: sourceFlush.pending_items || sourceFlush.duplicate_items
							? `Finished "${sourceName || sourceKey}". Source count ${sourceResult.source_item_count}, Pending ${sourceResult.merged_count}, duplicates ${sourceResult.duplicate_count}.`
							: `Finished "${sourceName || sourceKey}". Source count ${sourceResult.source_item_count}, Pending ${sourceResult.merged_count}, duplicates ${sourceResult.duplicate_count}, already active ${sourceResult.already_active_count}.`,
					}
				);
			}
			await flushMergeScratchOverlay(scratch.db, overlay);
			await flushMergeMembershipBuffers(reviewer, current, context, projectCollections, state);
			for (let entry of state.detailLogs) {
				let message = entry.status == "duplicate"
					? `${entry.item_key} -> Duplicates by ${entry.match_type}:${entry.match_value} (matched ${entry.existing_item_key})`
					: entry.status == "already_active"
						? `${entry.item_key} already exists in the active workflow set.`
						: entry.status == "merged_without_identifier"
							? `${entry.item_key} -> Pending without an exact identifier.`
							: `${entry.item_key} -> Pending`;
				await SystematicReviewerWorkflowJobs.log(reviewer, current, job.job_id, "info", message, {
					refresh: false,
				});
			}
			if (state.omittedDetailLogs > 0) {
				await SystematicReviewerWorkflowJobs.log(
					reviewer,
					current,
					job.job_id,
					"info",
					`Omitted ${state.omittedDetailLogs} additional item-level merge log lines to keep the UI responsive.`,
					{ refresh: false }
				);
			}
			let primary = sourceResults[0] || null;
			let previewTruncated =
				state.mergedCount > state.mergedItemKeys.length
				|| state.duplicateCount > state.duplicateItemKeys.length
				|| state.alreadyActiveCount > state.alreadyActiveItemKeys.length
				|| state.noIdentifierCount > state.noIdentifierItemKeys.length;
			let result = {
				ok: true,
				job_id: job.job_id,
				source_collection_key: optionalString(primary?.source_collection_key),
				source_collection_name: optionalString(primary?.source_collection_name),
				source_collection_keys: sourceResults.map((entry) => optionalString(entry.source_collection_key)).filter(Boolean),
				source_item_count: sourceCollections.length == 1
					? Number(primary?.source_item_count || 0) || 0
					: Number(processed || 0) || 0,
				merged_sources: sourceResults.length,
				merged_count: state.mergedCount,
				duplicate_count: state.duplicateCount,
				already_active_count: state.alreadyActiveCount,
				no_identifier_count: state.noIdentifierCount,
				skipped_repeat_source_count: state.skippedRepeatSourceCount,
				pending_collection_key: optionalString(projectCollections.pending.key),
				pending_collection_name: optionalString(projectCollections.pending.name),
				duplicates_collection_key: optionalString(projectCollections.duplicates.key),
				duplicates_collection_name: optionalString(projectCollections.duplicates.name),
				merged_item_keys: state.mergedItemKeys,
				duplicate_item_keys: state.duplicateItemKeys,
				already_active_item_keys: state.alreadyActiveItemKeys,
				no_identifier_item_keys: state.noIdentifierItemKeys,
				item_key_previews_truncated: previewTruncated,
				source_results: sourceResults,
				results: sourceResults,
			};
			let autoFollowup = {
				queued: false,
				queued_after_merge: false,
				embeddings_job: null,
				embeddings_skipped_reason: "",
				embeddings_error: "",
			};
			if (withEmbeddings) {
				if (state.mergedCount > 0) {
					autoFollowup = await queuePendingEmbeddingsFollowup({
						reviewer,
						current,
						options: {
							queue_origin: "harvest.mergeSource.after_merge",
						},
					});
					if (autoFollowup?.queued && autoFollowup?.embeddings_job?.job_id) {
						await SystematicReviewerWorkflowJobs.log(
							reviewer,
							current,
							job.job_id,
							"info",
							`Queued Pending title + abstract embeddings after merge completion (${autoFollowup.embeddings_job.job_id}).`,
							{ refresh: false }
						);
					}
					else if (autoFollowup?.embeddings_skipped_reason) {
						await SystematicReviewerWorkflowJobs.log(
							reviewer,
							current,
							job.job_id,
							"info",
							String(autoFollowup.embeddings_skipped_reason || "").trim(),
							{ refresh: false }
						);
					}
					else if (autoFollowup?.embeddings_error) {
						await SystematicReviewerWorkflowJobs.log(
							reviewer,
							current,
							job.job_id,
							"error",
							`Post-merge embeddings queue failed: ${String(autoFollowup.embeddings_error || "").trim()}`,
							{ refresh: false }
						);
					}
				}
				else {
					autoFollowup = {
						queued: false,
						queued_after_merge: false,
						embeddings_job: null,
						embeddings_skipped_reason: "No new Pending items were merged, so title + abstract embeddings were skipped.",
						embeddings_error: "",
					};
				}
			}
			result.with_embeddings = withEmbeddings;
			result.auto_followup = autoFollowup;
			await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
				used_mode: "exact_identifier_deduplication",
				output_path: outputRoot(reviewer, context),
				progress_current: Math.max(Number(processed || 0) || 0, Number(resolved.totalSourceItems || 0) || 0),
				progress_total: Math.max(Number(processed || 0) || 0, Number(resolved.totalSourceItems || 0) || 0),
				message: sourceResults.length == 1
					? `Merged ${state.mergedCount} items into Pending. Sent ${state.duplicateCount} to Duplicates.`
					: `Merged ${state.mergedCount} items into Pending from ${sourceResults.length} Harvest sources. Sent ${state.duplicateCount} to Duplicates.`,
				metadata: result,
			});
			for (let sourceResult of sourceResults) {
				await recordHarvestMergeArtifact(reviewer, current, sourceResult).catch((artifactError) => {
					reviewer?.log?.(`harvest merge artifact write skipped: ${artifactError}`);
				});
			}
			await reviewer._refreshAllControllers?.();
			return result;
		}
		catch (error) {
			if (job?.job_id) {
				await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
			}
			throw error;
		}
		finally {
			if (scratch?.db) {
				await closeMergeScratchDB(scratch.db);
			}
			if (scratch?.path) {
				await reviewer._removeIfExists(scratch.path);
			}
		}
	}

	function jobTitle(prefix, query) {
		let text = String(query || "").trim().replace(/\s+/g, " ");
		if (!text) {
			return prefix;
		}
		return `${prefix}: ${text.slice(0, 96)}`;
	}

	function initialRunState(summary = {}) {
		let paginationMode = String(summary.pagination_mode || (summary.query_mode == "semantic" ? "page" : "cursor"));
		return Object.assign({}, summary, {
			stage: optionalString(summary.stage || "fetch"),
			total_fetched: 0,
			processed_candidates: 0,
			imported_count: 0,
			imported_item_count: 0,
			duplicate_count: 0,
			skipped_no_abstract: 0,
			skipped_no_supported_identifier: 0,
			skipped_pmcid_without_pmid: 0,
			converted_pmcid_count: 0,
			import_error_count: 0,
			attachment_fetch_attempted: 0,
			attachment_fetch_succeeded: 0,
			attachment_fetch_failed: 0,
			last_cursor: paginationMode == "cursor" ? (summary.resume_cursor || null) : null,
			last_page: null,
			next_page: paginationMode == "page"
				? (Math.max(1, Math.round(Number(summary.resume_page || 1)) || 1))
				: null,
			ndjson_records_written: 0,
			import_line_index: 0,
			import_candidate_index: 0,
			page_count: 0,
			fetch_completed_at: "",
			records: [],
		});
	}

	function harvestCanceledError(message = "Harvest run canceled.") {
		let error = new Error(String(message || "Harvest run canceled.").trim() || "Harvest run canceled.");
		error.isCanceled = true;
		error.canceled = true;
		error.code = "SR_JOB_CANCELED";
		return error;
	}

	async function ensureHarvestRunCurrentJob(reviewer, context, runID, jobID = "") {
		let cleanJobID = optionalString(jobID);
		let row = await loadHarvestRunByID(reviewer, context, runID);
		if (!row || !cleanJobID) {
			return row;
		}
		let activeJobID = optionalString(row?.job_id);
		if (activeJobID && activeJobID != cleanJobID) {
			throw harvestCanceledError("Harvest run is continuing under a newer job from the saved checkpoint.");
		}
		return row;
	}

	function harvestRunPatchFromState(state = {}, extras = {}) {
		let heartbeatAt = optionalString(extras.last_heartbeat_at) || new Date().toISOString();
		return {
			status: optionalString(extras.status || state.status),
			query: optionalString(state.query),
			query_mode: optionalString(state.query_mode),
			pagination_mode: optionalString(state.pagination_mode),
			summary_path: optionalString(state.summary_path),
			ndjson_path: optionalString(state.ndjson_path),
			job_id: optionalString(extras.job_id !== undefined ? extras.job_id : state.job_id),
			post_import_action: optionalString(extras.post_import_action !== undefined ? extras.post_import_action : state.post_import_action),
			attachment_fetch_mode: optionalString(state.attachment_fetch_mode),
			stage: optionalString(extras.stage || state.stage || "fetch"),
			cancel_requested: extras.cancel_requested !== undefined ? Number(extras.cancel_requested ? 1 : 0) : Number(state.cancel_requested ? 1 : 0),
			total_fetched: Number(state.total_fetched || 0) || 0,
			processed_candidates: Number(state.processed_candidates || 0) || 0,
			imported_count: Number(state.imported_count || 0) || 0,
			imported_item_count: Number(state.imported_item_count || 0) || 0,
			duplicate_count: Number(state.duplicate_count || 0) || 0,
			skipped_no_abstract: Number(state.skipped_no_abstract || 0) || 0,
			skipped_no_supported_identifier: Number(state.skipped_no_supported_identifier || 0) || 0,
			skipped_pmcid_without_pmid: Number(state.skipped_pmcid_without_pmid || 0) || 0,
			converted_pmcid_count: Number(state.converted_pmcid_count || 0) || 0,
			import_error_count: Number(state.import_error_count || 0) || 0,
			attachment_fetch_attempted: Number(state.attachment_fetch_attempted || 0) || 0,
			attachment_fetch_succeeded: Number(state.attachment_fetch_succeeded || 0) || 0,
			attachment_fetch_failed: Number(state.attachment_fetch_failed || 0) || 0,
			page_count: Number(extras.page_count !== undefined ? extras.page_count : state.page_count || 0) || 0,
			last_cursor: optionalString(state.last_cursor) || null,
			last_page: Number(state.last_page || 0) || null,
			next_page: Number(state.next_page || 0) || null,
			import_line_index: Number(state.import_line_index || 0) || 0,
			import_candidate_index: Number(state.import_candidate_index || 0) || 0,
			fetch_completed_at: optionalString(state.fetch_completed_at) || null,
			last_heartbeat_at: heartbeatAt,
			error_message: extras.error_message !== undefined ? optionalString(extras.error_message) : optionalString(state.error_message),
			started_at: extras.started_at !== undefined ? optionalString(extras.started_at) || null : undefined,
			completed_at: extras.completed_at !== undefined ? optionalString(extras.completed_at) || null : undefined,
		};
	}

	async function loadHarvestRunByJobID(reviewer, context, jobID = "") {
		let cleanJobID = optionalString(jobID);
		if (!cleanJobID) {
			return null;
		}
		let db = await reviewer._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT *
			 FROM harvest_runs
			 WHERE job_id=?
			 ORDER BY updated_at DESC
			 LIMIT 1`,
			[cleanJobID]
		);
		return rows?.[0] || null;
	}

	async function loadHarvestRunsByRequest(reviewer, context, identity = {}) {
		let cleanHash = optionalString(identity?.request_hash);
		if (!cleanHash) {
			return [];
		}
		let db = await reviewer._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT *
			 FROM harvest_runs
			 WHERE request_hash=?
			 ORDER BY created_at DESC`,
			[cleanHash]
		);
		let requestJSON = optionalString(identity?.request_json);
		return (rows || []).filter((row) => optionalString(row?.request_json) == requestJSON);
	}

	async function createHarvestRunRow({
		reviewer,
		current,
		context,
		options,
		attachmentFetchMode,
		postImportAction,
		requestIdentity,
		status = "queued",
		stage = "fetch",
		summaryPath = "",
		ndjsonPath = "",
		resumeState = null,
		initialState = null,
		preserveExistingArtifacts = false,
	}) {
		let activeContext = context || current?.context;
		let runID = harvestRunID();
		let harvestDir = outputRoot(reviewer, activeContext);
		await reviewer._ensureDirectory(harvestDir);
		let projectCollections = await ensureProjectCollections(reviewer, current);
		let stamp = nowStamp();
		let slug = sanitizeSlug(reviewer, options.query.slice(0, 48));
		let nextSummaryPath = optionalString(summaryPath) || reviewer._joinPath(harvestDir, `${stamp}-${slug}.summary.json`);
		let nextNDJSONPath = optionalString(ndjsonPath) || reviewer._joinPath(harvestDir, `${stamp}-${slug}.ndjson`);
		let summary = buildSummaryBase(
			activeContext,
			current,
			options,
			nextSummaryPath,
			resumeState,
			attachmentFetchMode,
			projectCollections
		);
		summary.mode = options.searchMode || "limited";
		summary.ndjson_path = nextNDJSONPath;
		summary.request_preview = SystematicReviewerWorkflowOpenAlex.previewRequest(options, resumeState, options.pageSize);
		summary.run_id = runID;
		summary.request_hash = optionalString(requestIdentity?.request_hash);
		summary.post_import_action = optionalString(postImportAction);
		summary.stage = optionalString(stage || "fetch");
		let state = initialState && typeof initialState == "object"
			? Object.assign({}, initialState)
			: initialRunState(summary);
		state.run_id = runID;
		state.request_hash = optionalString(requestIdentity?.request_hash);
		state.post_import_action = optionalString(postImportAction);
		state.stage = optionalString(stage || state.stage || "fetch");
		state.status = optionalString(status);
		if (!preserveExistingArtifacts) {
			await reviewer._writeTextFile(nextNDJSONPath, "");
		}
		await writeSummary(reviewer, nextSummaryPath, state);
		let now = new Date().toISOString();
		let db = await reviewer._projectDB(activeContext);
		await db.queryAsync(
			`INSERT INTO harvest_runs (
				run_id, project_id, source, mode, status, request_hash, request_json,
				query, query_mode, pagination_mode, summary_path, ndjson_path,
				post_import_action, attachment_fetch_mode, stage, cancel_requested,
				created_at, updated_at
			) VALUES (?, ?, 'openalex', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
			[
				runID,
				activeContext.projectID,
				"run",
				optionalString(status),
				optionalString(requestIdentity?.request_hash),
				optionalString(requestIdentity?.request_json),
				optionalString(options.query),
				optionalString(options.queryMode || "boolean"),
				optionalString(SystematicReviewerWorkflowOpenAlex.paginationMode(options)),
				nextSummaryPath,
				nextNDJSONPath,
				optionalString(postImportAction),
				optionalString(attachmentFetchMode),
				optionalString(stage || "fetch"),
				now,
				now,
			]
		);
		await updateHarvestRun(reviewer, activeContext, runID, harvestRunPatchFromState(state, {
			status,
			post_import_action: postImportAction,
			last_heartbeat_at: now,
		}));
		return await loadHarvestRunByID(reviewer, activeContext, runID);
	}

	async function writeHarvestRunCheckpoint(reviewer, context, runID, summaryPath, state = {}, extras = {}) {
		await ensureHarvestRunCurrentJob(reviewer, context, runID, extras.job_id);
		await writeSummary(reviewer, summaryPath, state);
		return await updateHarvestRun(reviewer, context, runID, harvestRunPatchFromState(state, extras));
	}

	function buildResumeStateFromRun(row = {}) {
		let paginationMode = optionalString(row?.pagination_mode || row?.request?.pagination_mode);
		if (paginationMode == "page") {
			let page = Math.max(1, Math.round(Number(row?.next_page || row?.resume_page || 1)) || 1);
			return { page };
		}
		let cursor = optionalString(row?.last_cursor || row?.resume_cursor || "");
		return cursor ? { cursor } : null;
	}

	async function createQueuedHarvestJobForRun(reviewer, current, runRow, options = {}) {
		let request = parseRunRequest(runRow);
		let job = await reviewer._queueWorkflowJob(current, {
			prefix: "harvest",
			kind: "manual_harvest",
			title: jobTitle("Harvest", request.query || runRow?.query || ""),
			requested_mode: optionalString(request.searchMode || request.search_mode || "limited"),
			used_mode: "openalex_to_zotero",
			source_title: current?.context?.collectionName || current?.collection?.name || "Harvest",
			source_path: current?.context?.projectRoot || "",
			output_path: outputRoot(reviewer, current.context),
			metadata: {
				payload: {
					run_id: optionalString(runRow?.run_id),
				},
				run_id: optionalString(runRow?.run_id),
				query: optionalString(runRow?.query),
				queue_origin: optionalString(options.queue_origin),
			},
			targetWin: options.targetWin || null,
			openJobsTab: options.openJobsTab === true,
			refreshControllers: options.refreshControllers !== false,
		});
		await updateHarvestRun(reviewer, current.context, runRow.run_id, {
			status: "queued",
			job_id: job.job_id,
			cancel_requested: 0,
			error_message: "",
			started_at: null,
			completed_at: null,
			last_heartbeat_at: new Date().toISOString(),
		});
		return job;
	}

	function shouldReuseActiveHarvestRun(row = {}) {
		let status = optionalString(row?.status);
		if (status == "queued") {
			return true;
		}
		return status == "running" && (Date.now() - harvestRunFreshAt(row)) <= HARVEST_RUN_STALE_MS;
	}

	async function resolveHarvestRunForRequest({
		reviewer,
		current,
		context,
		options,
		attachmentFetchMode,
		postImportAction,
		requestIdentity,
	}) {
		await reconcileHarvestRunStaleness(reviewer, context);
		let matching = await loadHarvestRunsByRequest(reviewer, context, requestIdentity);
		let active = matching.find((row) => shouldReuseActiveHarvestRun(row)) || null;
		if (active) {
			await updateHarvestRun(reviewer, context, active.run_id, {
				post_import_action: optionalString(postImportAction),
			});
			return {
				action: "reuse_active",
				run: await loadHarvestRunByID(reviewer, context, active.run_id),
			};
		}
		let resumable = matching.find((row) => ["failed", "canceled", "interrupted"].includes(optionalString(row?.status))) || null;
		if (resumable) {
			await updateHarvestRun(reviewer, context, resumable.run_id, {
				post_import_action: optionalString(postImportAction),
				cancel_requested: 0,
				error_message: "",
			});
			return {
				action: "resume",
				run: await loadHarvestRunByID(reviewer, context, resumable.run_id),
			};
		}
		return {
			action: "new",
			run: await createHarvestRunRow({
				reviewer,
				current,
				context,
				options,
				attachmentFetchMode,
				postImportAction,
				requestIdentity,
				status: "queued",
				stage: "fetch",
				resumeState: buildResumeStateFromRun({
					pagination_mode: SystematicReviewerWorkflowOpenAlex.paginationMode(options),
					next_page: String(options.queryMode || "boolean") == "semantic"
						? Math.round(Number(options.page || 1)) || 1
						: null,
					last_cursor: options.cursor || "",
				}),
			}),
		};
	}

	async function getHarvestConfig({ reviewer, current = null, settings, payload = {} }) {
		let canEmbed = await embeddingsAvailable(reviewer);
		let defaultPostImportAction = normalizePostImportAction(
			payload?.post_import_action
			?? payload?.postImportAction
			?? "",
			canEmbed
		);
		let cleanKey = SystematicReviewerWorkflowSearchOptions.optionalString(
			payload.openalex_api_key !== undefined ? payload.openalex_api_key : (settings?.openalex_api_key || "")
		) || "";
		let refreshCatalog = !!payload.refresh_catalog;
		let refreshRateLimit = !!payload.refresh_rate_limit;
		let catalog = await SystematicReviewerWorkflowOpenAlex.fetchHarvestCatalog({
			// The Harvest filter catalog is UI metadata, not a user-initiated
			// OpenAlex search. Keep it off the saved API key so opening the app
			// or rebuilding the plugin cannot spend API-key credits silently.
			apiKey: "",
			refresh: refreshCatalog,
		});
		let rateLimit = await SystematicReviewerWorkflowOpenAlex.fetchRateLimitStatus({
			apiKey: cleanKey,
			refresh: refreshRateLimit,
		}).catch((error) => ({
			ok: false,
			has_api_key: !!cleanKey,
			error: error?.message || String(error),
			rate_limit: null,
		}));
		return {
			ok: true,
			openalex: {
				has_api_key: !!cleanKey,
				rate_limit: rateLimit?.rate_limit || null,
				rate_limit_ok: !!rateLimit?.ok,
				rate_limit_error: rateLimit?.ok ? "" : (rateLimit?.error || ""),
			},
			embeddings_available: canEmbed,
			default_post_import_action: defaultPostImportAction,
			form: {
				query_modes: [
					{ value: "boolean", label: "Boolean search" },
					{ value: "semantic", label: "Semantic search" },
				],
				fields: [
					{ value: "title_and_abstract", label: "Title and abstract" },
					{ value: "title", label: "Title" },
					{ value: "all", label: "All metadata" },
					{ value: "abstract", label: "Abstract only" },
					{ value: "author", label: "Author names" },
					{ value: "fulltext", label: "Full text" },
				],
				sort_options: [
					{ value: "relevance", label: "Relevance" },
					{ value: "date", label: "Publication date" },
					{ value: "citations", label: "Citation count" },
				],
				sort_orders: [
					{ value: "desc", label: "Descending" },
					{ value: "asc", label: "Ascending" },
				],
				attachment_fetch_modes: [
					{ value: "included_only", label: "Included only" },
					{ value: "all", label: "All harvested items" },
					{ value: "none", label: "Do not fetch PDFs" },
				],
				post_import_actions: postImportActionOptions(canEmbed),
				availability_options: [
					{ value: "", label: "Any" },
					{ value: "true", label: "Yes" },
					{ value: "false", label: "No" },
				],
				open_access_options: [
					{ value: "", label: "Any" },
					{ value: "true", label: "Open access only" },
					{ value: "false", label: "Closed access only" },
				],
				work_types: catalog.work_types || [],
				source_types: catalog.source_types || [],
				languages: catalog.languages || [],
				countries: catalog.countries || [],
				oa_statuses: catalog.oa_statuses || [],
			},
			collections: current ? await listSources(reviewer, current) : null,
		};
	}

	async function maybeRefreshCurrentProject(reviewer, context, importedCount) {
		if (!importedCount) {
			return;
		}
		let currentProject = reviewer?.currentProject || null;
		if (currentProject?.projectID != context.projectID) {
			return;
		}
		try {
			reviewer._scheduleCurrentProjectRefresh?.();
		}
		catch (error) {
			Zotero.logError(error);
		}
	}

	async function queueHarvestPostImportFollowup({ reviewer, current, postImportAction = "", queueOrigin = "" }) {
		let followup = {
			post_import_action: optionalString(postImportAction),
			merge_queue: null,
			merge_queue_error: "",
			embeddings_job: null,
			embeddings_skipped_reason: "",
			embeddings_error: "",
		};
		let currentProjectType = optionalString(current?.projectType);
		if (!currentProjectType && current?.context && typeof reviewer?._projectTypeForContext == "function") {
			currentProjectType = optionalString(await reviewer._projectTypeForContext(current.context, "systematic_review"));
		}
		if (currentProjectType != "systematic_review") {
			return followup;
		}
		let canEmbed = await embeddingsAvailable(reviewer);
		let selectedAction = normalizePostImportAction(postImportAction, canEmbed, { context: "openalex" });
		followup.post_import_action = selectedAction;
		if (selectedAction == "none") {
			return followup;
		}
		try {
			if (selectedAction == "merge_all_embed" || selectedAction == "merge_all") {
				let mergeQueue = await queueMergeAllSourcesIntoPending({
					reviewer,
					current,
					payload: {
						with_embeddings: selectedAction == "merge_all_embed",
					},
					options: {
						openJobsTab: false,
						refreshControllers: false,
						queue_origin: optionalString(queueOrigin) || "harvest.run",
					},
				});
				followup.merge_queue = mergeQueue;
				followup.embeddings_job = mergeQueue?.auto_followup?.embeddings_job || null;
				followup.embeddings_skipped_reason = mergeQueue?.auto_followup?.embeddings_skipped_reason || "";
				followup.embeddings_error = mergeQueue?.auto_followup?.embeddings_error || "";
			}
			else if (selectedAction == "merge_openalex_embed" || selectedAction == "merge_openalex") {
				let sources = await listSources(reviewer, current);
				let openalexCollectionKey = optionalString(sources?.openalex_collection_key);
				if (!openalexCollectionKey) {
					throw new Error("The Harvest/OpenAlex source collection is not available.");
				}
				let mergeQueue = await queueMergeSourceIntoPending({
					reviewer,
					current,
					payload: {
						source_collection_key: openalexCollectionKey,
						with_embeddings: selectedAction == "merge_openalex_embed",
					},
					options: {
						openJobsTab: false,
						refreshControllers: false,
						queue_origin: optionalString(queueOrigin) || "harvest.run",
					},
				});
				followup.merge_queue = {
					ok: true,
					queued: !!mergeQueue?.queued,
					merged_sources: mergeQueue?.queued ? 1 : 0,
					jobs: mergeQueue?.job ? [mergeQueue.job] : [],
					results: [mergeQueue],
					auto_followup: mergeQueue?.auto_followup || null,
				};
				followup.embeddings_job = mergeQueue?.auto_followup?.embeddings_job || null;
				followup.embeddings_skipped_reason = mergeQueue?.auto_followup?.embeddings_skipped_reason || "";
				followup.embeddings_error = mergeQueue?.auto_followup?.embeddings_error || "";
			}
		}
		catch (error) {
			followup.merge_queue_error = String(error?.message || error || "").trim();
		}
		return followup;
	}

	async function ensureHarvestRunNotCanceled(reviewer, current, runID, jobID = "") {
		let row = await ensureHarvestRunCurrentJob(reviewer, current.context, runID, jobID);
		let rowStatus = optionalString(row?.status);
		if (["canceled", "failed", "interrupted"].includes(rowStatus)) {
			throw harvestCanceledError(optionalString(row?.error_message) || "Harvest run is no longer active.");
		}
		if (!row || Number(row.cancel_requested || 0) !== 1) {
			return row;
		}
		let cancelMessage = optionalString(row?.error_message) || "Harvest run canceled by user.";
		if (optionalString(jobID)) {
			await SystematicReviewerWorkflowJobs.cancel(reviewer, current, jobID, {
				message: cancelMessage,
			});
		}
		await updateHarvestRun(reviewer, current.context, runID, {
			status: "canceled",
			cancel_requested: 0,
			error_message: cancelMessage,
			completed_at: new Date().toISOString(),
			last_heartbeat_at: new Date().toISOString(),
		});
		throw harvestCanceledError(cancelMessage);
	}

	function buildHarvestResultFromState(state = {}, jobID = "", extras = {}) {
		return {
			ok: true,
			mode: "run",
			run_id: optionalString(state.run_id),
			job_id: optionalString(jobID || state.job_id),
			status: optionalString(extras.status || state.status || "succeeded"),
			stage: optionalString(state.stage || extras.stage || "completed"),
			total_fetched: Number(state.total_fetched || 0) || 0,
			processed_candidates: Number(state.processed_candidates || 0) || 0,
			imported_count: Number(state.imported_count || 0) || 0,
			imported_item_count: Number(state.imported_item_count || 0) || 0,
			duplicate_count: Number(state.duplicate_count || 0) || 0,
			skipped_no_abstract: Number(state.skipped_no_abstract || 0) || 0,
			skipped_no_supported_identifier: Number(state.skipped_no_supported_identifier || 0) || 0,
			skipped_pmcid_without_pmid: Number(state.skipped_pmcid_without_pmid || 0) || 0,
			converted_pmcid_count: Number(state.converted_pmcid_count || 0) || 0,
			import_error_count: Number(state.import_error_count || 0) || 0,
			attachment_fetch_mode: optionalString(state.attachment_fetch_mode),
			attachment_fetch_attempted: Number(state.attachment_fetch_attempted || 0) || 0,
			attachment_fetch_succeeded: Number(state.attachment_fetch_succeeded || 0) || 0,
			attachment_fetch_failed: Number(state.attachment_fetch_failed || 0) || 0,
			page_count: Number(state.page_count || 0) || 0,
			last_cursor: optionalString(state.last_cursor),
			last_page: Number(state.last_page || 0) || null,
			next_page: Number(state.next_page || 0) || null,
			import_line_index: Number(state.import_line_index || 0) || 0,
			import_candidate_index: Number(state.import_candidate_index || 0) || 0,
			fetch_completed_at: optionalString(state.fetch_completed_at),
			ndjson_path: optionalString(state.ndjson_path),
			summary_path: optionalString(state.summary_path),
			summary: extras.summary || null,
			reused_existing_run: extras.reused_existing_run === true,
			auto_followup: extras.auto_followup || null,
			post_import_action: optionalString(extras.post_import_action || state.post_import_action),
			error_message: optionalString(state.error_message),
		};
	}

	async function readNDJSONRecords(reviewer, path = "") {
		let text = await reviewer._readFileText(path);
		return String(text || "")
			.split(/\r?\n/)
			.map((line) => String(line || "").trim())
			.filter(Boolean);
	}

	function isCanonicalHarvestStage(stage = "") {
		return ["fetch", "import", "completed"].includes(optionalString(stage).toLowerCase());
	}

	function inferImportFrontierFromNDJSONLines(lines = [], options = {}, processedCandidateTarget = 0) {
		let target = Math.max(0, Math.round(Number(processedCandidateTarget || 0)) || 0);
		if (!target || !Array.isArray(lines) || !lines.length) {
			return {
				import_line_index: 0,
				import_candidate_index: 0,
			};
		}
		let importLineIndex = 0;
		let importCandidateIndex = 0;
		for (let rawLine of lines) {
			if (importCandidateIndex >= target) {
				break;
			}
			let record = null;
			try {
				record = JSON.parse(String(rawLine || ""));
			}
			catch (_error) {
				importLineIndex += 1;
				continue;
			}
			if (options.mustHaveAbstract && !SystematicReviewerWorkflowOpenAlex.extractAbstractText(record)) {
				importLineIndex += 1;
				continue;
			}
			if (options.searchMode != "all" && options.maxResults && importCandidateIndex >= options.maxResults) {
				break;
			}
			importCandidateIndex += 1;
			importLineIndex += 1;
		}
		return {
			import_line_index: importLineIndex,
			import_candidate_index: importCandidateIndex,
		};
	}

	async function executeTwoStageHarvestRun({
		reviewer,
		current,
		context,
		options,
		attachmentFetchMode,
		runRow,
		jobID,
		projectCollections,
	}) {
		let summaryPath = optionalString(runRow?.summary_path);
		let ndjsonPath = optionalString(runRow?.ndjson_path);
		let state = (await reviewer._readJSONFile(summaryPath).catch(() => null)) || initialRunState(buildSummaryBase(
			context,
			current,
			options,
			summaryPath,
			buildResumeStateFromRun(runRow),
			attachmentFetchMode,
			projectCollections
		));
		state.run_id = optionalString(runRow?.run_id);
		state.post_import_action = optionalString(runRow?.post_import_action);
		state.attachment_fetch_mode = optionalString(runRow?.attachment_fetch_mode || attachmentFetchMode);
		state.status = "running";
		let normalizedStage = optionalString(state.stage);
		if (!isCanonicalHarvestStage(normalizedStage)) {
			let existingLines = await readNDJSONRecords(reviewer, ndjsonPath).catch(() => []);
			if (
				!(Number(state.import_line_index || 0) || 0)
				&& !(Number(state.import_candidate_index || 0) || 0)
				&& (Number(state.processed_candidates || 0) || 0) > 0
				&& existingLines.length
			) {
				let frontier = inferImportFrontierFromNDJSONLines(existingLines, options, state.processed_candidates);
				state.import_line_index = frontier.import_line_index;
				state.import_candidate_index = frontier.import_candidate_index;
			}
			normalizedStage = optionalString(state.fetch_completed_at) ? "import" : "fetch";
			state.stage = normalizedStage;
			await SystematicReviewerWorkflowJobs.log(
				reviewer,
				current,
				jobID,
				"info",
				"Normalizing earlier harvest checkpoint into the current fetch/import engine.",
				{ refresh: false }
			);
			await writeHarvestRunCheckpoint(reviewer, context, state.run_id, summaryPath, state, {
				status: "running",
				stage: normalizedStage,
				job_id: jobID,
			});
		}
		if (optionalString(state.stage) != "import" && optionalString(state.fetch_completed_at)) {
			state.stage = "import";
		}
		if (!optionalString(state.stage) || optionalString(state.stage) == "completed") {
			state.stage = optionalString(state.fetch_completed_at) ? "import" : "fetch";
		}
		await SystematicReviewerWorkflowJobs.log(
			reviewer,
			current,
			jobID,
			"info",
			`Starting OpenAlex harvest into "${projectCollections.harvest.openalex.name}" inside "${projectCollections.harvest.root.name}".`,
			{ refresh: false }
		);
		if (state.stage == "fetch") {
			let stopFetch = false;
			let paginationMode = SystematicReviewerWorkflowOpenAlex.paginationMode(options);
			let pageCount = Number(state.page_count || 0) || 0;
			while (!stopFetch) {
				await ensureHarvestRunNotCanceled(reviewer, current, state.run_id, jobID);
				let requestPagination = paginationMode == "page"
					? { page: Math.max(1, Math.round(Number(state.next_page || 1)) || 1) }
					: { cursor: state.last_cursor };
				let page = await SystematicReviewerWorkflowOpenAlex.fetchPage(options, requestPagination);
				pageCount += 1;
				let results = Array.isArray(page?.results) ? page.results : [];
				let currentPageNumber = paginationMode == "page" ? Number(requestPagination.page || 1) || 1 : null;
				if (!results.length) {
					if (paginationMode == "page") {
						state.last_page = currentPageNumber;
						state.next_page = null;
					}
					break;
				}
				await appendNDJSONLines(reviewer, ndjsonPath, results);
				state.ndjson_records_written = Number(state.ndjson_records_written || 0) + results.length;
				for (let record of results) {
					state.total_fetched += 1;
					if (options.mustHaveAbstract && !SystematicReviewerWorkflowOpenAlex.extractAbstractText(record)) {
						state.skipped_no_abstract += 1;
						continue;
					}
					if (options.searchMode != "all" && options.maxResults && state.processed_candidates >= options.maxResults) {
						stopFetch = true;
						break;
					}
					state.processed_candidates += 1;
				}
				state.page_count = pageCount;
				if (paginationMode == "page") {
					state.last_page = currentPageNumber;
					let semanticCap = SystematicReviewerWorkflowSearchOptions.SEMANTIC_MAX_PAGE_SIZE;
					let semanticPageSize = SystematicReviewerWorkflowOpenAlex.effectivePageSize(options, options.pageSize);
					let reachedSemanticCap = state.total_fetched >= semanticCap;
					state.next_page = (!stopFetch && !reachedSemanticCap && results.length >= semanticPageSize)
						? currentPageNumber + 1
						: null;
					state.last_cursor = null;
				}
				else {
					state.last_cursor = SystematicReviewerWorkflowSearchOptions.optionalString(page?.meta?.next_cursor || page?.next_cursor);
					state.next_page = null;
				}
				await writeHarvestRunCheckpoint(reviewer, context, state.run_id, summaryPath, state, {
					status: "running",
					stage: "fetch",
					job_id: jobID,
				});
				await SystematicReviewerWorkflowJobs.progress(
					reviewer,
					current,
					jobID,
					Number(state.total_fetched || 0) || 0,
					Number(options.maxResults || 0) || 0,
					`Fetched page ${pageCount}. Saved ${state.total_fetched} raw OpenAlex records.`
				);
				if ((paginationMode == "page" && !state.next_page) || (paginationMode != "page" && !state.last_cursor) || stopFetch) {
					break;
				}
			}
			state.stage = "import";
			state.fetch_completed_at = new Date().toISOString();
			await writeHarvestRunCheckpoint(reviewer, context, state.run_id, summaryPath, state, {
				status: "running",
				stage: "import",
				job_id: jobID,
			});
		}

			let fetchFiles = shouldFetchAttachments(attachmentFetchMode);
			let lines = await readNDJSONRecords(reviewer, ndjsonPath);
			while (state.import_line_index < lines.length) {
				await ensureHarvestRunNotCanceled(reviewer, current, state.run_id, jobID);
				let rawLines = lines.slice(state.import_line_index, state.import_line_index + HARVEST_IMPORT_SLICE_SIZE);
				if (!rawLines.length) {
					break;
				}
				let sliceStartCandidateIndex = (Number(state.import_candidate_index || 0) || 0) + 1;
				let candidates = [];
				let stopImport = false;
				for (let rawLine of rawLines) {
					let record = null;
				try {
					record = JSON.parse(String(rawLine || ""));
				}
				catch (_error) {
					state.import_line_index += 1;
					continue;
				}
				if (options.mustHaveAbstract && !SystematicReviewerWorkflowOpenAlex.extractAbstractText(record)) {
					state.import_line_index += 1;
					continue;
				}
				if (options.searchMode != "all" && options.maxResults && state.import_candidate_index >= options.maxResults) {
					stopImport = true;
					break;
				}
				state.import_candidate_index += 1;
				state.import_line_index += 1;
				candidates.push({
					record,
					title: extractTitle(record),
					openalex_id: extractOpenAlexID(record),
				});
			}
				let pmcidNeeded = Array.from(new Set(
					candidates
						.map(({ record }) => extractIdentifiers(record))
						.filter((identifiers) => !identifiers.doi && !identifiers.pmid && !identifiers.arxiv && !identifiers.isbn && identifiers.pmcid)
						.map((identifiers) => identifiers.pmcid)
						.filter(Boolean)
				));
				let pmcidMappings = pmcidNeeded.length
					? await SystematicReviewerWorkflowOpenAlex.resolvePmcids(pmcidNeeded)
					: {};
				if (candidates.length) {
					await SystematicReviewerWorkflowJobs.log(
						reviewer,
						current,
						jobID,
						"info",
						`Importing saved NDJSON candidates ${sliceStartCandidateIndex}-${sliceStartCandidateIndex + candidates.length - 1}.`
					);
				}
				let importedItemsForFetch = [];
				let importedOpenAlexItems = [];
				let openalexOverrides = new Map();
				for (let entry of candidates) {
					await ensureHarvestRunNotCanceled(reviewer, current, state.run_id, jobID);
					let target = await buildImportTarget(entry.record, pmcidMappings);
					if (target.converted_pmcid?.pmcid && target.converted_pmcid?.pmid) {
						state.converted_pmcid_count += 1;
					}
					if (!target.identifier) {
						if (target.identifier_type == "pmcid_unresolved") {
							state.skipped_pmcid_without_pmid += 1;
						}
						else {
							state.skipped_no_supported_identifier += 1;
						}
						continue;
					}
					try {
						let items = await importIdentifierIntoCollections({
							reviewer,
							current,
							context,
							jobID,
							libraryID: current.collection.libraryID,
							collectionIDs: [projectCollections.harvest.openalex.id],
							identifier: target.identifier,
						});
						if (!items.length) {
							throw new Error("Zotero import returned no items.");
						}
						state.imported_count += 1;
						state.imported_item_count += items.length;
						let annotatedItems = selectImportedItemsForOpenAlexAnnotation(reviewer, items, target);
						let openalexMetadata = reviewer?._extractOpenAlexRecordMetadata?.(entry.record) || {};
						openalexMetadata.openalex_id = entry.openalex_id || openalexMetadata.openalex_id || "";
						for (let item of annotatedItems) {
							importedOpenAlexItems.push(item);
							openalexOverrides.set(String(item.key || ""), openalexMetadata);
						}
						if (fetchFiles) {
							importedItemsForFetch.push(...items);
						}
					}
					catch (error) {
						state.import_error_count += 1;
						Zotero.logError(error);
					}
				}
				if (importedOpenAlexItems.length) {
					await ensureHarvestRunNotCanceled(reviewer, current, state.run_id, jobID);
					await annotateOpenAlexItems(reviewer, importedOpenAlexItems, openalexOverrides, {
						current,
						context,
						jobID,
					});
				}
				if (fetchFiles && importedItemsForFetch.length) {
					await ensureHarvestRunNotCanceled(reviewer, current, state.run_id, jobID);
					await SystematicReviewerWorkflowJobs.log(
						reviewer,
						current,
						jobID,
						"info",
						`Fetching available files for ${importedItemsForFetch.length} imported item(s).`
					);
					let fetchSummary = await fetchAvailableFiles(importedItemsForFetch, {
						reviewer,
						current,
						context,
						jobID,
					});
					state.attachment_fetch_attempted += Number(fetchSummary.attempted || 0) || 0;
					state.attachment_fetch_succeeded += Number(fetchSummary.succeeded || 0) || 0;
					state.attachment_fetch_failed += Array.isArray(fetchSummary.failed) ? fetchSummary.failed.length : 0;
				}
			await writeHarvestRunCheckpoint(reviewer, context, state.run_id, summaryPath, state, {
				status: "running",
				stage: "import",
				job_id: jobID,
			});
			await SystematicReviewerWorkflowJobs.progress(
				reviewer,
				current,
				jobID,
				Number(state.import_candidate_index || 0) || 0,
				Number(state.processed_candidates || 0) || 0,
				`Imported ${state.imported_count} candidates from saved NDJSON.`
			);
			if (stopImport) {
				break;
			}
			if (typeof Zotero?.Promise?.delay == "function") {
				await Zotero.Promise.delay(0);
			}
		}
		await ensureHarvestRunNotCanceled(reviewer, current, state.run_id, jobID);
		state.stage = "completed";
		state.status = "succeeded";
		state.completed_at = new Date().toISOString();
		let finalSummary = await writeSummary(reviewer, summaryPath, state);
		return buildHarvestResultFromState(state, jobID, { summary: finalSummary });
	}

	async function finalizeHarvestRunSuccess({ reviewer, current, context, runID, jobID, result }) {
		await ensureHarvestRunNotCanceled(reviewer, current, runID, jobID);
		let followup = {
			post_import_action: optionalString(result?.post_import_action || "none"),
			merge_queue: null,
			merge_queue_error: "",
			embeddings_job: null,
			embeddings_skipped_reason: "",
			embeddings_error: "",
		};
		if ((Number(result?.imported_count || 0) || 0) > 0) {
			followup = await queueHarvestPostImportFollowup({
				reviewer,
				current,
				postImportAction: result?.post_import_action || "none",
				queueOrigin: "harvest.run",
			});
		}
		let runRow = await updateHarvestRun(reviewer, context, runID, {
			status: "succeeded",
			cancel_requested: 0,
			error_message: "",
			completed_at: new Date().toISOString(),
			last_heartbeat_at: new Date().toISOString(),
		});
		await maybeRefreshCurrentProject(reviewer, context, Number(result?.imported_count || 0) || 0);
		await SystematicReviewerWorkflowJobs.succeed(reviewer, current, jobID, {
			used_mode: "openalex_to_zotero",
			output_path: optionalString(result?.summary_path || runRow?.summary_path),
			progress_current: Number(result?.processed_candidates || result?.import_candidate_index || 0) || Number(result?.imported_count || 0) || 0,
			progress_total: Number(result?.processed_candidates || 0) || Number(result?.imported_count || 0) || 0,
			message: `Harvest finished. Imported ${Number(result?.imported_count || 0) || 0} records into Harvest/OpenAlex, skipped ${Number(result?.skipped_no_supported_identifier || 0) + Number(result?.skipped_pmcid_without_pmid || 0)}.`,
			metadata: Object.assign({}, result || {}, {
				auto_followup: followup,
				run_id: optionalString(runID),
			}),
		});
		return Object.assign({}, result || {}, {
			post_import_action: optionalString(result?.post_import_action || runRow?.post_import_action),
			auto_followup: followup,
		});
	}

	async function executeHarvestRunByRow({
		reviewer,
		current,
		context,
		settings,
		runRow,
		jobID,
	}) {
		let activeContext = context || current?.context;
		let nextSettings = settings || await reviewer._globalSettings();
		let defaults = {
			openalexApiKey: nextSettings?.openalex_api_key || "",
		};
		let request = parseRunRequest(runRow);
		let options = SystematicReviewerWorkflowSearchOptions.normalizeRequest(request, defaults);
		let attachmentFetchMode = optionalString(runRow?.attachment_fetch_mode) || normalizeAttachmentFetchMode(request);
		let projectCollections = await ensureProjectCollections(reviewer, current);
		let result = await executeTwoStageHarvestRun({
			reviewer,
			current,
			context: activeContext,
			options,
			attachmentFetchMode,
			runRow,
			jobID,
			projectCollections,
		});
		result.post_import_action = optionalString(runRow?.post_import_action);
		return await finalizeHarvestRunSuccess({
			reviewer,
			current,
			context: activeContext,
			runID: optionalString(runRow?.run_id),
			jobID,
			result,
		});
	}

	async function runQueuedHarvestJob({ reviewer, current, payload = {} }) {
		let runID = optionalString(payload?.run_id ?? payload?.runID);
		if (!runID) {
			throw new Error("run_id is required.");
		}
		let jobID = optionalString(payload?.existing_job_id ?? payload?.existingJobID ?? payload?.job_id ?? payload?.jobID);
		if (!jobID) {
			throw new Error("existing_job_id is required.");
		}
		let runRow = await loadHarvestRunByID(reviewer, current.context, runID);
		if (!runRow) {
			throw new Error("Harvest run was not found.");
		}
		await updateHarvestRun(reviewer, current.context, runID, {
			status: "running",
			cancel_requested: 0,
			error_message: "",
			started_at: optionalString(runRow?.started_at) || new Date().toISOString(),
			last_heartbeat_at: new Date().toISOString(),
		});
		try {
			return await executeHarvestRunByRow({
				reviewer,
				current,
				context: current.context,
				settings: await reviewer._globalSettings(),
				runRow: await loadHarvestRunByID(reviewer, current.context, runID),
				jobID,
			});
		}
		catch (error) {
			if (error?.isCanceled === true || error?.canceled === true || String(error?.code || "").trim() == "SR_JOB_CANCELED") {
				throw error;
			}
			await updateHarvestRun(reviewer, current.context, runID, {
				status: "failed",
				error_message: error?.message || String(error),
				cancel_requested: 0,
				last_heartbeat_at: new Date().toISOString(),
			});
			throw error;
		}
	}

	async function queueHarvestRun({ reviewer, current, context, settings, payload = {}, options = {} }) {
		let activeContext = context || current?.context;
		let defaults = {
			openalexApiKey: settings?.openalex_api_key || "",
		};
		let normalized = SystematicReviewerWorkflowSearchOptions.normalizeRequest(payload, defaults);
		let attachmentFetchMode = normalizeAttachmentFetchMode(payload);
		if (!normalized.query) {
			throw new Error("Harvest query is required.");
		}
		let canEmbed = await embeddingsAvailable(reviewer);
		let postImportAction = normalizePostImportAction(
			payload?.post_import_action ?? payload?.postImportAction ?? "",
			canEmbed,
			{ context: "openalex" }
		);
		let requestIdentity = harvestRequestIdentity(normalized, attachmentFetchMode);
		let resolved = await resolveHarvestRunForRequest({
			reviewer,
			current,
			context: activeContext,
			options: normalized,
			attachmentFetchMode,
			postImportAction,
			requestIdentity,
		});
		let runRow = resolved.run;
		if (resolved.action == "reuse_active") {
			let serialized = serializeHarvestRun(runRow);
			return Object.assign({
				ok: true,
				queued: true,
				reused_existing_run: true,
				message: "Matching harvest already exists. Track progress in Jobs.",
			}, serialized);
		}
		let job = await createQueuedHarvestJobForRun(reviewer, current, runRow, options || {});
		let refreshed = await loadHarvestRunByID(reviewer, activeContext, runRow.run_id);
		return Object.assign({
			ok: true,
			queued: true,
			reused_existing_run: false,
			message: "Harvest started. Track progress in Jobs.",
		}, serializeHarvestRun(refreshed || runRow), {
			job_id: job.job_id,
		});
	}

	async function stopHarvestRun({ reviewer, current, payload = {} }) {
		let runID = optionalString(payload?.run_id ?? payload?.runID);
		if (!runID) {
			throw new Error("run_id is required.");
		}
		let requestedCancelMessage = optionalString(payload?.cancel_message ?? payload?.cancelMessage ?? payload?.message);
		let runRow = await loadHarvestRunByID(reviewer, current.context, runID);
		if (!runRow) {
			throw new Error("Harvest run was not found.");
		}
		let jobID = optionalString(runRow?.job_id);
		if (optionalString(runRow?.status) == "queued" && jobID) {
			reviewer._removePendingJobReference?.(jobID);
			await SystematicReviewerWorkflowJobs.cancel(reviewer, current, jobID, {
				message: requestedCancelMessage || "Queued harvest was canceled.",
			});
			if (reviewer?._settleJobCompletion) {
				let error = new Error(requestedCancelMessage || "Queued harvest was canceled.");
				error.isCanceled = true;
				error.canceled = true;
				error.code = "SR_JOB_CANCELED";
				reviewer._settleJobCompletion(current.context.projectID, jobID, {
					error,
				});
			}
			runRow = await updateHarvestRun(reviewer, current.context, runID, {
				status: "canceled",
				cancel_requested: 0,
				error_message: requestedCancelMessage || "Queued harvest was canceled.",
				completed_at: new Date().toISOString(),
				last_heartbeat_at: new Date().toISOString(),
			});
		}
		else {
			if (jobID) {
				await reviewer._setJobCancelRequested?.(current.context, jobID, true);
			}
			runRow = await updateHarvestRun(reviewer, current.context, runID, {
				cancel_requested: 1,
				error_message: requestedCancelMessage || "Harvest run canceled by user.",
				last_heartbeat_at: new Date().toISOString(),
			});
		}
		return {
			ok: true,
			message: optionalString(runRow?.status) == "canceled"
				? "Harvest canceled."
				: "Harvest stop requested.",
			run: serializeHarvestRun(runRow),
		};
	}

	async function continueHarvestRun({ reviewer, current, payload = {} }) {
		let runID = optionalString(payload?.run_id ?? payload?.runID);
		if (!runID) {
			throw new Error("run_id is required.");
		}
		let runRow = await loadHarvestRunByID(reviewer, current.context, runID);
		if (!runRow) {
			throw new Error("Harvest run was not found.");
		}
		if (shouldReuseActiveHarvestRun(runRow)) {
			return {
				ok: true,
				queued: true,
				reused_existing_run: true,
				message: "Matching harvest is already active.",
				run: serializeHarvestRun(runRow),
				job_id: optionalString(runRow?.job_id),
			};
		}
		if (!["failed", "canceled", "interrupted"].includes(optionalString(runRow?.status))) {
			throw new Error("Only interrupted, canceled, or failed harvest runs can be continued.");
		}
		let job = await createQueuedHarvestJobForRun(reviewer, current, runRow, {
			openJobsTab: false,
			refreshControllers: false,
			queue_origin: "harvest.run.continue",
		});
		return {
			ok: true,
			queued: true,
			message: "Harvest continue queued. Track progress in Jobs.",
			run: serializeHarvestRun(await loadHarvestRunByID(reviewer, current.context, runID)),
			job_id: job.job_id,
		};
	}

	async function restartHarvestRun({ reviewer, current, payload = {} }) {
		let runID = optionalString(payload?.run_id ?? payload?.runID);
		if (!runID) {
			throw new Error("run_id is required.");
		}
		let sourceRun = await loadHarvestRunByID(reviewer, current.context, runID);
		if (!sourceRun) {
			throw new Error("Harvest run was not found.");
		}
		let settings = await reviewer._globalSettings();
		let request = parseRunRequest(sourceRun);
		let defaults = { openalexApiKey: settings?.openalex_api_key || "" };
		let options = SystematicReviewerWorkflowSearchOptions.normalizeRequest(request, defaults);
		let attachmentFetchMode = optionalString(sourceRun?.attachment_fetch_mode) || normalizeAttachmentFetchMode(request);
		let identity = harvestRequestIdentity(options, attachmentFetchMode);
		let canEmbed = await embeddingsAvailable(reviewer);
		let postImportAction = normalizePostImportAction(sourceRun?.post_import_action || "", canEmbed, { context: "openalex" });
		let newRun = await createHarvestRunRow({
			reviewer,
			current,
			context: current.context,
			options,
			attachmentFetchMode,
			postImportAction,
			requestIdentity: identity,
			status: "queued",
			stage: "fetch",
			resumeState: buildResumeStateFromRun({
				pagination_mode: SystematicReviewerWorkflowOpenAlex.paginationMode(options),
				next_page: String(options.queryMode || "boolean") == "semantic"
					? Math.round(Number(options.page || 1)) || 1
					: null,
				last_cursor: options.cursor || "",
			}),
		});
		let job = await createQueuedHarvestJobForRun(reviewer, current, newRun, {
			openJobsTab: false,
			refreshControllers: false,
			queue_origin: "harvest.run.restart",
		});
		return {
			ok: true,
			queued: true,
			message: "Harvest restart queued. Track progress in Jobs.",
			run: serializeHarvestRun(await loadHarvestRunByID(reviewer, current.context, newRun.run_id)),
			job_id: job.job_id,
		};
	}

	async function runHarvest({ reviewer, current, context, settings, payload = {} }) {
		let activeContext = context || current?.context;
		if (!activeContext || !current?.collection) {
			throw new Error("Open a collection project first.");
		}
		let defaults = {
			openalexApiKey: settings?.openalex_api_key || "",
		};
		let options = SystematicReviewerWorkflowSearchOptions.normalizeRequest(payload, defaults);
		let attachmentFetchMode = normalizeAttachmentFetchMode(payload);
		if (!options.query) {
			throw new Error("Harvest query is required.");
		}
		if (options.searchMode == "estimate") {
			return await estimateHarvest({
				reviewer,
				current,
				context: activeContext,
				options,
				attachmentFetchMode,
			});
		}

		let canEmbed = await embeddingsAvailable(reviewer);
		let postImportAction = normalizePostImportAction(
			payload?.post_import_action ?? payload?.postImportAction ?? "",
			canEmbed,
			{ context: "openalex" }
		);
		let requestIdentity = harvestRequestIdentity(options, attachmentFetchMode);
		let resolved = await resolveHarvestRunForRequest({
			reviewer,
			current,
			context: activeContext,
			options,
			attachmentFetchMode,
			postImportAction,
			requestIdentity,
		});
		if (resolved.action == "reuse_active") {
			let reused = serializeHarvestRun(resolved.run);
			let result = buildHarvestResultFromState(Object.assign({}, reused, {
				run_id: reused.run_id,
				post_import_action: reused.post_import_action,
				summary_path: reused.summary_path,
				ndjson_path: reused.ndjson_path,
			}), reused.job_id, {
				status: reused.status,
				reused_existing_run: true,
				post_import_action: reused.post_import_action,
			});
			if (waitForJobCompletion(payload, true) && optionalString(reused.job_id)) {
				return await reviewer._awaitJobCompletion(activeContext.projectID, reused.job_id);
			}
			return result;
		}
		let runRow = await loadHarvestRunByID(reviewer, activeContext, resolved.run.run_id);
		let job = await createQueuedHarvestJobForRun(reviewer, current, runRow, {
			openJobsTab: false,
			refreshControllers: false,
			queue_origin: "harvest.run",
		});
		if (!job?.job_id) {
			throw new Error("Harvest job could not be queued.");
		}
		if (!waitForJobCompletion(payload, true)) {
			return Object.assign({
				ok: true,
				queued: true,
				job_kind: "manual_harvest",
				message: "Harvest started. Track progress in Jobs.",
			}, serializeHarvestRun(runRow), job);
		}
		return await reviewer._awaitJobCompletion(activeContext.projectID, job.job_id);
	}

	async function mergeAllSourcesIntoPending({ reviewer, current, payload = {} }) {
		let projectCollections = await ensureProjectCollections(reviewer, current);
		let sources = Array.isArray(projectCollections?.harvest?.sources) ? projectCollections.harvest.sources : [];
		if (!sources.length) {
			return {
				ok: true,
				merged_sources: 0,
				results: [],
			};
		}
		return await mergeSourceIntoPending({
			reviewer,
			current,
			payload: Object.assign({}, payload || {}, {
				source_collection_keys: sources.map((entry) => optionalString(entry?.key)).filter(Boolean),
			}),
		});
	}

	return {
		ensureProjectCollections,
		embeddingsAvailable,
		listOutputs,
		listRuns,
		listSources,
		readOutput,
		getHarvestConfig,
		importIdentifierIntoCollections,
		normalizePostImportAction,
		postImportActionOptions,
		postImportActionHelpLines,
		runHarvest,
		queueHarvestRun,
		runQueuedHarvestJob,
		stopHarvestRun,
		continueHarvestRun,
		restartHarvestRun,
		estimateHarvest,
		queueMergeAllSourcesIntoPending,
		queueMergeSourceIntoPending,
		mergeAllSourcesIntoPending,
		mergeSourceIntoPending,
	};
})();
