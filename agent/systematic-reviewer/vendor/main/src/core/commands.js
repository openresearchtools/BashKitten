var SystematicReviewerWorkflowCommands = (() => {
	let reviewer = null;
	let registry = new Map();
	let automationCitationCatalogCache = new Map();
	let automationWorkspaceRenderCache = new Map();
	let automationChatRuns = new Map();
	let automationSessionContextRuns = new Map();
	let itemTargetLocks = new Map();
	let automationChatRunCounter = 0;
	const AUTODRIVE_SYSTEMATIC_PROMPT_PATH = "core/prompts/autodrive-systematic-review.md";
	const AUTODRIVE_REVIEWER_PROMPT_PATH = "core/prompts/autodrive-reviewer.md";
	const AUTODRIVE_CUSTOM_WRAPPER_PATH = "core/prompts/autodrive-custom-analysis-wrapper.md";

	function register(nextReviewer) {
		reviewer = nextReviewer || null;
		automationCitationCatalogCache = new Map();
		automationWorkspaceRenderCache = new Map();
		automationChatRuns = new Map();
		automationSessionContextRuns = new Map();
		itemTargetLocks = new Map();
		automationChatRunCounter = 0;
		registry = buildRegistry();
	}

	function unregister() {
		reviewer = null;
		automationCitationCatalogCache = new Map();
		automationWorkspaceRenderCache = new Map();
		automationChatRuns = new Map();
		automationSessionContextRuns = new Map();
		itemTargetLocks = new Map();
		automationChatRunCounter = 0;
		registry = new Map();
	}

	function list() {
		return Array.from(registry.values()).map((entry) => ({
			id: entry.id,
			description: entry.description,
			tab: entry.tab || "",
		}));
	}

	async function call(commandID, payload = {}) {
		let command = registry.get(String(commandID || "").trim());
		if (!command) {
			throw new Error(`Unknown workflow command: ${commandID}`);
		}
		if (command.tab && command.tab != "workflow") {
			let current = await requireCurrentProject(payload || {});
			let capabilities = await workflowCapabilities(current).catch(() => ({ embeddings_available: false }));
			if (current && !SystematicReviewerWorkflowManifest.isCommandTabAvailable(command.tab, current.projectType || "", capabilities)) {
				throw new Error(`${command.tab} is not available for ${reviewer._projectTypeLabel(current.projectType || "")}.`);
			}
		}
		return await command.execute(payload || {});
	}

	async function restartZoteroApplication() {
		let ci = typeof Ci != "undefined" ? Ci : Components.interfaces;
		let startup = null;
		try {
			startup = Services?.startup || null;
		}
		catch (_error) {
			startup = null;
		}
		if (!startup) {
			startup = Components.classes["@mozilla.org/toolkit/app-startup;1"]
				.getService(ci.nsIAppStartup);
		}
		if (!startup?.quit) {
			throw new Error("Zotero restart service is not available.");
		}
		let flags = ci.nsIAppStartup.eAttemptQuit | ci.nsIAppStartup.eRestart;
		Zotero.Promise.delay(150).then(() => {
			startup.quit(flags);
		}).catch(() => {
			startup.quit(flags);
		});
		return {
			ok: true,
			restarting: true,
		};
	}

	async function requireCurrentProject(payload = {}) {
		let projectID = String(payload?.project_id || payload?.projectID || "").trim();
		let sessionID = String(payload?.session_id || payload?.sessionID || "").trim();
		let current = null;
		if (projectID) {
			current = await reviewer?._resolveProjectByID?.(projectID, {
				sessionID,
			});
			if (!current) {
				throw new Error(`Project ${projectID} is not available in Zotero.`);
			}
			return current;
		}
		current = await reviewer?._resolveCurrentProject?.();
		if (!current) {
			current = await reviewer?._restoreLastProjectSelection?.();
		}
		if (!current) {
			throw new Error("Open a collection project first.");
		}
		if (current?.context?.settingsPath) {
			current.settings = (await reviewer?._readJSONFile?.(current.context.settingsPath)) || {};
		}
		return current;
	}

	async function workflowBootstrap(payload = {}) {
		let current = null;
		let requestedTab = String(payload?.active_tab || payload?.activeTab || "").trim();
		let requestedProjectID = String(payload?.project_id || payload?.projectID || "").trim();
		if (!(requestedTab == "settings" && !requestedProjectID)) {
			try {
				current = await requireCurrentProject(payload || {});
			}
			catch (_err) {
				current = null;
			}
		}
		let themeClass = reviewer?._themeClassForWindow?.(reviewer?._primaryWindow?.()) || "theme-dark";
		let settings = await reviewer?._globalSettings?.();
		let projectType = current?.projectType || "";
		let capabilities = await workflowCapabilities(current).catch(() => ({ embeddings_available: false }));
		let tabs = current ? SystematicReviewerWorkflowManifest.listTabs(projectType, capabilities) : [];
		if (!current) {
				return {
					ok: true,
					theme: themeClass == "theme-dark" ? "dark" : "light",
					preview_page_theme: reviewer?._previewEditorPageTheme?.(settings) || "light",
					ui_appearance: reviewer?._workflowUIAppearance?.() || { font_scale: 1 },
					project: null,
				tabs,
				capabilities,
				commands: list(),
				openalex: {
					has_api_key: !!SystematicReviewerWorkflowSearchOptions.optionalString(settings?.openalex_api_key),
				},
			};
		}
		let counts = await reviewer._projectCounts(current.context);
		let workflowUI = await readWorkflowUIState(current.context, tabs);
			return {
				ok: true,
				theme: themeClass == "theme-dark" ? "dark" : "light",
				preview_page_theme: reviewer?._previewEditorPageTheme?.(settings) || "light",
				ui_appearance: reviewer?._workflowUIAppearance?.() || { font_scale: 1 },
					project: {
					project_id: current.context.projectID,
					project_root: current.context.projectRoot,
					collection_name: current.context.collectionName,
					library_id: current.context.libraryID,
					collection_key: current.context.collectionKey,
					project_item_key: current.projectItem?.key || "",
					project_type: current.projectType || "systematic_review",
					project_type_label: reviewer._projectTypeLabel(current.projectType || ""),
					settings: current.settings || {},
					counts,
				},
			workflow_ui: workflowUI,
			tabs,
			capabilities,
			commands: list(),
			openalex: {
				has_api_key: !!SystematicReviewerWorkflowSearchOptions.optionalString(settings?.openalex_api_key),
			},
		};
	}

	function automationOptionalString(value) {
		return String(value || "").trim();
	}

	function automationExistingJobID(payload = {}) {
		return automationOptionalString(
			payload?.existing_job_id
			?? payload?.existingJobID
			?? payload?.job_id
			?? payload?.jobID
		);
	}

	function automationWaitForJobCompletion(payload = {}, defaultWait = true) {
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

	function attachmentViewerString(value = "") {
		return String(value || "").trim();
	}

	function attachmentViewerRequestedKind(payload = {}) {
		let raw = attachmentViewerString(payload?.viewer_type || payload?.viewerType || payload?.kind || "");
		if (raw == "markdown" || raw == "csv" || raw == "text") {
			return raw;
		}
		return "";
	}

	function attachmentViewerResolveItem(payload = {}) {
		let libraryID = Number(payload?.library_id ?? payload?.libraryID ?? 0) || Zotero.Libraries.userLibraryID;
		let attachmentKey = attachmentViewerString(payload?.attachment_key || payload?.attachmentKey || "");
		if (!attachmentKey) {
			throw new Error("attachment_key is required.");
		}
		let item = Zotero.Items.getByLibraryAndKey(libraryID, attachmentKey);
		if (!item || item.deleted || !item.isAttachment?.()) {
			throw new Error("Attachment could not be found in Zotero.");
		}
		return { libraryID, attachmentKey, item };
	}

	function attachmentViewerKindForItem(item, requestedKind = "") {
		let kind = "";
		if (reviewer?._isMarkdownAttachmentItem?.(item) || reviewer?._isMarkdownOnlyAttachmentItem?.(item)) {
			kind = "markdown";
		}
		else if (reviewer?._isCSVAttachmentViewerItem?.(item)) {
			kind = "csv";
		}
		else if (reviewer?._isTextAttachmentViewerItem?.(item)) {
			kind = "text";
		}
		if (!kind) {
			throw new Error("Attachment is not a supported text, code, CSV, or Markdown file.");
		}
		if (requestedKind && requestedKind != kind) {
			throw new Error(`Attachment viewer kind mismatch: requested ${requestedKind}, resolved ${kind}.`);
		}
		return kind;
	}

	async function attachmentViewerFilePath(item) {
		let path = item.getFilePathAsync
			? await item.getFilePathAsync()
			: (item.getFilePath ? item.getFilePath() : "");
		path = attachmentViewerString(path);
		if (!path) {
			throw new Error("Attachment file was not found on disk.");
		}
		return path;
	}

	function attachmentViewerLeafName(path = "") {
		let raw = String(path || "");
		return raw.split(/[\\/]/).pop() || raw;
	}

	function attachmentViewerDisplayTitle(item, path = "") {
		let title = "";
		try {
			title = attachmentViewerString(reviewer?._itemField ? reviewer._itemField(item, "title") : item?.getField?.("title"));
		}
		catch (_err) {
			title = "";
		}
		return title || attachmentViewerLeafName(path) || item?.key || "Attachment";
	}

	async function attachmentViewerLoad(payload = {}) {
		let { libraryID, attachmentKey, item } = attachmentViewerResolveItem(payload || {});
		let requestedKind = attachmentViewerRequestedKind(payload || {});
		let kind = attachmentViewerKindForItem(item, requestedKind);
		let path = await attachmentViewerFilePath(item);
		let content = await Zotero.File.getContentsAsync(path);
		let title = attachmentViewerDisplayTitle(item, path);
		return {
			ok: true,
			kind,
			library_id: libraryID,
			attachment_key: attachmentKey,
			title,
			window_title: `${title} - Systematic Reviewer`,
			file_name: attachmentViewerLeafName(path),
			content_type: String(item.attachmentContentType || ""),
			line_ending: String(content || "").includes("\r\n") ? "\r\n" : "\n",
			content: String(content || ""),
		};
	}

	async function attachmentViewerSave(payload = {}) {
		let { libraryID, attachmentKey, item } = attachmentViewerResolveItem(payload || {});
		let requestedKind = attachmentViewerRequestedKind(payload || {});
		let kind = attachmentViewerKindForItem(item, requestedKind);
		let path = await attachmentViewerFilePath(item);
		let content = String(payload?.content ?? "");
		await Zotero.File.putContentsAsync(path, content);
		let title = attachmentViewerDisplayTitle(item, path);
		return {
			ok: true,
			saved: true,
			kind,
			library_id: libraryID,
			attachment_key: attachmentKey,
			title,
			window_title: `${title} - Systematic Reviewer`,
			file_name: attachmentViewerLeafName(path),
			line_ending: content.includes("\r\n") ? "\r\n" : "\n",
		};
	}

	async function queueProjectReconcileJob(current, payload = {}, origin = "automation") {
		if (!current?.context || !current?.collection || !current?.projectItem) {
			throw new Error("Open a collection project first.");
		}
		let job = await reviewer._launchWorkflowJob(current, {
			prefix: "reconcile",
			kind: "manual_project_reconcile",
			title: "Reconcile project",
			requested_mode: "batched",
			used_mode: "queued",
			source_title: current.context.collectionName || "Project",
			source_path: current.context.projectRoot || "",
			output_path: current.context.databasePath || "",
			metadata: {
				payload: payload || {},
				origin: String(origin || "automation").trim() || "automation",
			},
			openJobsTab: payload?.open_jobs_tab === true || payload?.openJobsTab === true,
			startDelayMs: 80,
			waitForCompletion: false,
			refreshControllers: true,
			message: "Project reconcile queued. Track progress in Jobs.",
		});
		return Object.assign({}, job || {}, {
			ok: true,
			queued: true,
			job_id: String(job?.job_id || "").trim(),
			job_kind: "manual_project_reconcile",
			message: "Project reconcile queued. Track progress in Jobs.",
		});
	}

	function normalizeWorkflowUIState(raw = {}, tabs = []) {
		let visibleTabs = Array.isArray(tabs) ? tabs.map((tab) => String(tab?.id || "").trim()).filter(Boolean) : [];
		let activeTab = String(raw?.active_tab || raw?.activeTab || "").trim();
		if (activeTab && visibleTabs.length && !visibleTabs.includes(activeTab)) {
			activeTab = "";
		}
		let tabJobsRaw = raw?.tab_jobs && typeof raw.tab_jobs == "object"
			? raw.tab_jobs
			: (raw?.tabJobs && typeof raw.tabJobs == "object" ? raw.tabJobs : {});
		let tabJobs = {};
		for (let [tabID, jobID] of Object.entries(tabJobsRaw || {})) {
			let cleanTabID = String(tabID || "").trim();
			let cleanJobID = String(jobID || "").trim();
			if (!cleanTabID) {
				continue;
			}
			tabJobs[cleanTabID] = cleanJobID;
		}
		return {
			active_tab: activeTab,
			last_scope_key: String(raw?.last_scope_key || raw?.lastScopeKey || "").trim(),
			tab_jobs: tabJobs,
			updated_at: String(raw?.updated_at || raw?.updatedAt || "").trim(),
		};
	}

	async function readWorkflowUIStateRow(context) {
		return null;
	}

	async function readWorkflowUIState(context, tabs = []) {
		let settings = (await reviewer?._readJSONFile?.(context?.settingsPath || "")) || {};
		let row = await readWorkflowUIStateRow(context).catch(() => null);
		let raw = row || (settings?.workflow_ui && typeof settings.workflow_ui == "object"
			? settings.workflow_ui
			: {});
		return normalizeWorkflowUIState(raw, tabs);
	}

	async function saveWorkflowUIState(context, tabs = [], payload = {}) {
		if (!context?.settingsPath) {
			throw new Error("Project settings are unavailable.");
		}
		let settings = (await reviewer?._readJSONFile?.(context.settingsPath)) || {};
		let existing = await readWorkflowUIState(context, tabs);
		let nextState = normalizeWorkflowUIState(existing || settings?.workflow_ui || {}, tabs);
		if (Object.prototype.hasOwnProperty.call(payload, "active_tab") || Object.prototype.hasOwnProperty.call(payload, "activeTab")) {
			nextState.active_tab = String(payload.active_tab || payload.activeTab || "").trim();
		}
		if (Object.prototype.hasOwnProperty.call(payload, "last_scope_key") || Object.prototype.hasOwnProperty.call(payload, "lastScopeKey")) {
			nextState.last_scope_key = String(payload.last_scope_key || payload.lastScopeKey || "").trim();
		}
		if (Object.prototype.hasOwnProperty.call(payload, "tab_jobs") || Object.prototype.hasOwnProperty.call(payload, "tabJobs")) {
			let nextJobs = payload.tab_jobs && typeof payload.tab_jobs == "object"
				? payload.tab_jobs
				: (payload.tabJobs && typeof payload.tabJobs == "object" ? payload.tabJobs : {});
			nextState.tab_jobs = Object.assign({}, nextState.tab_jobs || {});
			for (let [tabID, jobID] of Object.entries(nextJobs || {})) {
				let cleanTabID = String(tabID || "").trim();
				if (!cleanTabID) {
					continue;
				}
				nextState.tab_jobs[cleanTabID] = String(jobID || "").trim();
			}
		}
		if (
			Object.prototype.hasOwnProperty.call(payload, "tab_id")
			|| Object.prototype.hasOwnProperty.call(payload, "tabID")
			|| Object.prototype.hasOwnProperty.call(payload, "last_job_id")
			|| Object.prototype.hasOwnProperty.call(payload, "lastJobID")
			|| Object.prototype.hasOwnProperty.call(payload, "job_id")
			|| Object.prototype.hasOwnProperty.call(payload, "jobID")
		) {
			let tabID = String(payload.tab_id || payload.tabID || "").trim();
			if (tabID) {
				nextState.tab_jobs = Object.assign({}, nextState.tab_jobs || {});
				nextState.tab_jobs[tabID] = String(
					payload.last_job_id
					|| payload.lastJobID
					|| payload.job_id
					|| payload.jobID
					|| ""
				).trim();
			}
		}
		nextState = normalizeWorkflowUIState(nextState, tabs);
		nextState.updated_at = new Date().toISOString();
		settings.workflow_ui = nextState;
		await reviewer._writeJSONFile(context.settingsPath, settings);
		return nextState;
	}

	async function workflowCapabilities(_current = null) {
		let embeddingsAvailable = await reviewer?._hasConfiguredEmbeddingsModel?.().catch(() => false);
		return {
			embeddings_available: !!embeddingsAvailable,
		};
	}

	function requireEmbeddingsCapability(capabilities = null) {
		if (capabilities?.embeddings_available) {
			return;
		}
		throw new Error("Embeddings model is not configured.");
	}

	async function automationProjectSettings(current) {
		let settings = (await reviewer?._readJSONFile?.(current?.context?.settingsPath || "")) || {};
		current.settings = settings;
		return settings;
	}

	function automationEditorSettings(settings = {}, payload = {}) {
		let raw = payload?.editor_settings || payload?.editorSettings || payload?.editor || {};
		return reviewer._normalizeEditorSettings(Object.assign({}, settings?.editor || {}, raw || {}, {
			headingScale: null,
			headingScales: null,
			headingStyles: null,
		}));
	}

	function automationDocumentBaseURL(current) {
		try {
			let parent = reviewer._parentPath(current?.context?.reportPath || "");
			if (!parent) {
				return "";
			}
			return Services.io.newFileURI(reviewer._nsIFile(parent)).spec;
		}
		catch (_error) {
			return "";
		}
	}

	function automationNoopToggle() {}

	function automationStubClassList() {
		return {
			toggle: automationNoopToggle,
			add: automationNoopToggle,
			remove: automationNoopToggle,
		};
	}

	function automationCitationCatalogCacheKey(current) {
		return [
			current?.context?.projectID || "",
			current?.context?.libraryID || 0,
			current?.context?.collectionKey || "",
			current?.projectItem?.key || "",
			reviewer?.reconcileGeneration || 0,
		].join("|");
	}

	function automationWorkspaceRenderCacheEntry(controller) {
		let namespace = reviewer?._workspaceCitationCacheNamespace?.(controller) || "";
		if (!namespace) {
			return null;
		}
		let entry = automationWorkspaceRenderCache.get(namespace);
		if (!entry) {
			entry = {
				namespace,
				citationHTMLCache: new Map(),
				bibliographyHTMLCache: new Map(),
				citationPreviewEngine: null,
				bibliographyPreviewEngine: null,
				citationTextEngine: null,
				bibliographyTextEngine: null,
			};
			automationWorkspaceRenderCache.set(namespace, entry);
		}
		return entry;
	}

	function automationLocalCommands() {
		return [
			{ command: "/help", label: "Help", description: "Explain Find Arguments, Explore, Status, and agent tasks." },
				{ command: "/Autodrive", label: "Auto Drive", description: "Keep the agent working for a chosen number of turns with optional reviewer checks." },
				{ command: "/explore", label: "Explore", description: "Run scoped table synthesis from selected Explore columns." },
				{ command: "/status", label: "Status", description: "Show the current project scope and item counts." },
				{ command: "/memory", label: "Memory", description: "Rebuild active-memory.txt from chronological memory.txt." },
				{ command: "/find", label: "Find Arguments", description: "Search project full-text chunks with keyword or semantic retrieval." },
			];
		}

	function cleanupAutomationChatRuns() {
		let cutoff = Date.now() - (1000 * 60 * 60);
		for (let [runID, run] of automationChatRuns.entries()) {
			let finishedAt = Date.parse(run?.finishedAt || "") || 0;
			if (finishedAt && finishedAt < cutoff) {
				automationChatRuns.delete(runID);
			}
		}
	}

	function automationChatRunSnapshot(run) {
		if (!run) {
			return null;
		}
		let now = Date.now();
		let startedAt = Date.parse(run.startedAt || "") || now;
		let finishedAt = run.finishedAt ? (Date.parse(run.finishedAt) || now) : now;
		return {
			run_id: run.runID,
			project_id: run.projectID,
			session_id: run.sessionID,
			status: run.status || "running",
			started_at: run.startedAt || "",
			finished_at: run.finishedAt || "",
			error: run.error || "",
			sequence_base: Number(run.sequenceBase || 0) || 0,
			elapsed_ms: Math.max(0, finishedAt - startedAt),
			kind: String(run.kind || "chat").trim() || "chat",
			autodrive: run.autodrive && typeof run.autodrive == "object"
				? {
					sequence_id: String(run.autodrive.sequenceID || run.autodrive.sequence_id || "").trim(),
					total_turns: Number(run.autodrive.totalTurns || run.autodrive.total_turns || 0) || 0,
					completed_turns: Number(run.autodrive.completedTurns || run.autodrive.completed_turns || 0) || 0,
					remaining_turns: Number(run.autodrive.remainingTurns || run.autodrive.remaining_turns || 0) || 0,
					reviewer_mode: String(run.autodrive.reviewerMode || run.autodrive.reviewer_mode || "").trim(),
					reviewer_session_id: String(run.autodrive.reviewerSessionID || run.autodrive.reviewer_session_id || "").trim(),
					status_message: String(run.autodrive.statusMessage || run.autodrive.status_message || "").trim(),
				}
				: null,
		};
	}

	function automationAbortError(message = "Session run stopped.") {
		let error = new Error(String(message || "Session run stopped."));
		error.name = "AbortError";
		return error;
	}

	function isAutomationAbortError(error) {
		let name = String(error?.name || "").trim();
		let message = String(error?.message || error || "").trim().toLowerCase();
		return name == "AbortError"
			|| message.includes("aborted")
			|| message.includes("cancelled")
			|| message.includes("canceled");
	}

	function createAutomationRunAbortController() {
		let AbortCtor = globalThis.AbortController || null;
		if (AbortCtor) {
			return new AbortCtor();
		}
		let listeners = new Set();
		let signal = {
			aborted: false,
			addEventListener(type, listener) {
				if (type == "abort" && typeof listener == "function") {
					listeners.add(listener);
				}
			},
			removeEventListener(type, listener) {
				if (type == "abort") {
					listeners.delete(listener);
				}
			},
		};
		return {
			signal,
			abort() {
				if (signal.aborted) {
					return;
				}
				signal.aborted = true;
				for (let listener of Array.from(listeners)) {
					try {
						listener();
					}
					catch (_error) {}
				}
				listeners.clear();
			},
		};
	}

	function createAutomationChatRun(current, sessionID, runID, sequenceBase = 0) {
		let abortController = createAutomationRunAbortController();
		return {
			runID,
			projectID: current?.context?.projectID || "",
			sessionID,
			sequenceBase: Number(sequenceBase || 0) || 0,
			startedAt: new Date().toISOString(),
			finishedAt: "",
			status: "running",
			error: "",
			abortController,
			canceled: false,
			cancelReason: "",
			promise: null,
			cancel(reason = "Session run stopped.") {
				if (String(this.status || "").trim() == "running") {
					this.status = "canceled";
					this.finishedAt = new Date().toISOString();
				}
				this.canceled = true;
				this.cancelReason = String(reason || "Session run stopped.").trim() || "Session run stopped.";
				this.error = this.cancelReason;
				try {
					this.abortController?.abort?.();
				}
				catch (_error) {}
				return automationAbortError(this.cancelReason);
			},
		};
	}

	function activeAutomationChatRun(current, sessionID = "") {
		let projectID = String(current?.context?.projectID || "").trim();
		let targetSessionID = String(sessionID || current?.sessionID || "").trim();
		for (let run of automationChatRuns.values()) {
			if (String(run?.projectID || "").trim() != projectID) {
				continue;
			}
			if (targetSessionID && String(run?.sessionID || "").trim() != targetSessionID) {
				continue;
			}
			if (String(run?.status || "").trim() == "running") {
				return run;
			}
		}
		return null;
	}

	async function automationChatState(current, sessionID = "", run = null, options = {}) {
		let activeSessionID = String(sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		let status = await reviewer._sessionStatus(current, activeSessionID, {
			surface: "automation",
			includeInspection: options?.includeInspection,
			includeSessionInspection: options?.includeSessionInspection,
			includePromptProjection: options?.includePromptProjection,
			includeSessionPromptProjection: options?.includeSessionPromptProjection,
			historyLimit: options?.historyLimit || options?.history_limit,
		});
		let reportHash = "";
		try {
			let markdown = await automationMarkdown(current, {});
			reportHash = reviewer?._simpleContentHash
				? reviewer._simpleContentHash(markdown || "")
				: String(markdown || "").length.toString(36);
		}
		catch (_error) {
			reportHash = "";
		}
		return {
			ok: true,
			active_session_id: activeSessionID,
			session: status.session,
			runtime_state: status.runtime_state,
			sessions: status.sessions,
			chat_history: status.timeline || status.visible_timeline || [],
			chat_history_visible: status.visible_timeline || [],
			chat_history_raw: status.timeline || [],
			chat_history_total: Number(status.timeline_total || 0) || (Array.isArray(status.timeline) ? status.timeline.length : 0),
			chat_history_complete: status.timeline_complete !== false,
			chat_budget: status.chat_budget || null,
			pending_messages: status.pending_messages || [],
			prompt_projection: status.prompt_projection || null,
			report_hash: reportHash,
			report_path: String(current?.context?.reportPath || "").trim(),
			run: automationChatRunSnapshot(run || activeAutomationChatRun(current, activeSessionID)),
		};
	}

	function automationSessionContextKey(current, sessionID = "") {
		return [
			current?.context?.projectID || "",
			current?.context?.libraryID || 0,
			current?.context?.collectionKey || "",
			sessionID || current?.sessionID || "",
		].join("|");
	}

	async function automationEnsureSessionContext(current, payload = {}) {
		let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		await reviewer._activateSessionContext(current, sessionID);
		current.sessionID = sessionID;
		let key = automationSessionContextKey(current, sessionID);
		let existing = automationSessionContextRuns.get(key);
		if (existing) {
			return await existing;
		}
		let task = (async () => {
			await Zotero.Promise.delay(0);
			await reviewer._ensureSessionWelcome(current, sessionID, { surface: "automation" });
			return await automationChatState(current, sessionID, null, {
				includeInspection: false,
				includePromptProjection: false,
				historyLimit: payload?.history_limit || payload?.historyLimit,
			});
		})().finally(() => {
			automationSessionContextRuns.delete(key);
		});
		automationSessionContextRuns.set(key, task);
		return await task;
	}

	function normalizeProjectDataLimit(value) {
		let numeric = Math.round(Number(value || 0) || 0);
		if (!numeric) {
			numeric = 25;
		}
		return Math.max(1, Math.min(25, numeric));
	}

	function serializeCollectionForTools(collection = null) {
		if (!collection) {
			return null;
		}
		return {
			collection_id: Number(collection.id || 0) || 0,
			collection_key: String(collection.key || "").trim(),
			collection_name: String(collection.name || "").trim(),
			library_id: Number(collection.libraryID || 0) || 0,
			parent_collection_key: String(collection.parentKey || "").trim(),
		};
	}

	function projectCollectionNodes(current) {
		let root = current?.collection || null;
		if (!root || !reviewer?._projectCollectionNodes) {
			return [];
		}
		return reviewer._projectCollectionNodes(root) || [];
	}

	function allowedProjectCollections(current) {
		let root = current?.collection || null;
		let nodes = projectCollectionNodes(current);
		let byKey = new Map();
		if (root?.key) {
			byKey.set(String(root.key), root);
		}
		for (let node of nodes) {
			if (node?.collection?.key) {
				byKey.set(String(node.collection.key), node.collection);
			}
		}
		return byKey;
	}

	function findAllowedCollectionByName(current, name = "") {
		let target = String(name || "").trim().toLowerCase();
		if (!target) {
			return null;
		}
		let matches = [];
		for (let collection of allowedProjectCollections(current).values()) {
			if (String(collection?.name || "").trim().toLowerCase() == target) {
				matches.push(collection);
			}
		}
		if (matches.length > 1) {
			throw new Error(`Multiple in-project collections are named '${name}'. Use collection_key instead.`);
		}
		return matches[0] || null;
	}

	function collectionByAllowedKey(current, collectionKey = "") {
		let key = String(collectionKey || "").trim();
		if (!key) {
			return null;
		}
		return allowedProjectCollections(current).get(key) || null;
	}

	async function withItemTargetLock(lockKey, task) {
		let key = String(lockKey || "").trim();
		if (!key) {
			return await task();
		}
		let previous = itemTargetLocks.get(key) || Promise.resolve();
		let release = null;
		let gate = new Promise((resolve) => {
			release = resolve;
		});
		let marker = previous.catch(() => {}).then(() => gate);
		itemTargetLocks.set(key, marker);
		await previous.catch(() => {});
		try {
			return await task();
		}
		finally {
			if (typeof release == "function") {
				release();
			}
			if (itemTargetLocks.get(key) === marker) {
				itemTargetLocks.delete(key);
			}
		}
	}

	function resolveScopeCollection(current, scope = "") {
		let raw = String(scope || "").trim();
		if (!raw) {
			return null;
		}
		let lowered = raw.toLowerCase();
		let scopes = [];
		try {
			scopes = SystematicReviewerWorkflowScreening?.availableScopes
				? (SystematicReviewerWorkflowScreening.availableScopes(reviewer, current) || [])
				: [];
		}
		catch (_error) {
			scopes = [];
		}
		let entry = scopes.find((candidate) => {
			let values = [
				candidate?.collection_key,
				candidate?.collection_name,
				candidate?.label,
				candidate?.scope,
				candidate?.id,
				candidate?.key,
			].map((value) => String(value || "").trim().toLowerCase());
			return values.includes(lowered);
		}) || null;
		if (entry?.collection_key) {
			return collectionByAllowedKey(current, entry.collection_key);
		}
		return collectionByAllowedKey(current, raw) || findAllowedCollectionByName(current, raw);
	}

	async function ensureHarvestSourceCollection(current, sourceName = "") {
		let name = String(sourceName || "").trim();
		if (!name) {
			throw new Error("harvest_source_name must be provided.");
		}
		let projectKey = String(current?.projectID || current?.collection?.key || "").trim() || "current";
		let lockKey = `harvest-source:${projectKey}:${name.toLowerCase()}`;
		return await withItemTargetLock(lockKey, async () => {
			if (!SystematicReviewerWorkflowHarvest?.ensureProjectCollections) {
				throw new Error("Harvest collections are not available.");
			}
			let projectCollections = await SystematicReviewerWorkflowHarvest.ensureProjectCollections(reviewer, current, {
				ensureAddedByUser: true,
			});
			let harvestRoot = projectCollections?.harvest?.root || null;
			if (!harvestRoot) {
				throw new Error("The current project does not have a Harvest collection.");
			}
			for (let source of projectCollections?.harvest?.sources || []) {
				if (String(source?.name || "").trim().toLowerCase() == name.toLowerCase()) {
					return source;
				}
			}
			let existing = findAllowedCollectionByName(current, name);
			if (existing && String(existing.parentKey || "") == String(harvestRoot.key || "")) {
				return existing;
			}
			projectCollections = await SystematicReviewerWorkflowHarvest.ensureProjectCollections(reviewer, current, {
				ensureAddedByUser: true,
			});
			for (let source of projectCollections?.harvest?.sources || []) {
				if (String(source?.name || "").trim().toLowerCase() == name.toLowerCase()) {
					return source;
				}
			}
			return await reviewer._ensureDirectChildCollection(harvestRoot, name);
		});
	}

	async function resolveExplicitItemTarget(current, payload = {}) {
		let target = payload?.target && typeof payload.target == "object" && !Array.isArray(payload.target)
			? payload.target
			: {};
		let merged = Object.assign({}, target, payload || {});
		let collection = null;
		let targetKind = "";
		if (String(merged.harvest_source_name || merged.harvestSourceName || "").trim()) {
			collection = await ensureHarvestSourceCollection(current, merged.harvest_source_name || merged.harvestSourceName);
			targetKind = "harvest_source";
		}
		else if (String(merged.collection_key || merged.collectionKey || "").trim()) {
			collection = collectionByAllowedKey(current, merged.collection_key || merged.collectionKey);
			targetKind = "collection_key";
		}
		else if (String(merged.collection_name || merged.collectionName || "").trim()) {
			collection = findAllowedCollectionByName(current, merged.collection_name || merged.collectionName);
			targetKind = "collection_name";
		}
		else if (String(merged.scope || "").trim()) {
			collection = resolveScopeCollection(current, merged.scope);
			targetKind = "scope";
		}
		if (!collection) {
			throw new Error("Explicit in-project target is required: provide collection_key, collection_name, scope, or harvest_source_name.");
		}
		let allowed = allowedProjectCollections(current);
		if (!allowed.has(String(collection.key || ""))) {
			throw new Error("Target collection must be inside the current project tree.");
		}
		return {
			kind: targetKind,
			collection,
			collection_info: serializeCollectionForTools(collection),
		};
	}

	function normalizeZoteroIdentifierRecord(entry) {
		if (typeof entry == "string" || typeof entry == "number") {
			let text = String(entry || "").trim();
			if (!text) {
				return null;
			}
			let lowered = text.toLowerCase();
			if (/^pmcid[:\s]/i.test(text) || /^pmc\d+$/i.test(text)) {
				return { type: "PMCID", value: text.replace(/^pmcid[:\s]*/i, "") };
			}
			if (/^pmid[:\s]/i.test(text) || /^\d{6,}$/.test(text)) {
				return { type: "PMID", value: text.replace(/^pmid[:\s]*/i, "") };
			}
			if (/^arxiv[:\s]/i.test(text) || /^\d{4}\.\d{4,5}(v\d+)?$/i.test(text)) {
				return { type: "arXiv", value: text.replace(/^arxiv[:\s]*/i, "") };
			}
			if (/^(97[89][-\s]?)?[\d-\sXx]{9,}$/.test(text) && !lowered.includes("/")) {
				return { type: "ISBN", value: text };
			}
			return { type: "DOI", value: text.replace(/^doi[:\s]*/i, "") };
		}
		if (!entry || typeof entry != "object") {
			return null;
		}
		let type = String(entry.type || entry.identifier_type || entry.identifierType || "").trim();
		let value = String(entry.value || entry.identifier || entry.doi || entry.DOI || entry.pmid || entry.PMID || entry.pmcid || entry.PMCID || entry.arxiv || entry.arXiv || entry.isbn || entry.ISBN || "").trim();
		if (!type) {
			if (entry.doi || entry.DOI) type = "DOI";
			else if (entry.pmid || entry.PMID) type = "PMID";
			else if (entry.pmcid || entry.PMCID) type = "PMCID";
			else if (entry.arxiv || entry.arXiv) type = "arXiv";
			else if (entry.isbn || entry.ISBN) type = "ISBN";
		}
		if (!value) {
			return null;
		}
		return {
			type,
			value,
		};
	}

	function identifierPayloadForTranslator(record) {
		let type = String(record?.type || "").trim().toLowerCase();
		let value = String(record?.value || "").trim();
		if (!value) {
			return null;
		}
		if (type == "doi") return { DOI: value.replace(/^doi[:\s]*/i, "") };
		if (type == "pmid") return { PMID: value.replace(/^pmid[:\s]*/i, "") };
		if (type == "arxiv" || type == "arxiv_id") return { arXiv: value.replace(/^arxiv[:\s]*/i, "") };
		if (type == "isbn") return { ISBN: value };
		return null;
	}

	function serializeCreatedItem(item = null) {
		if (!item) {
			return null;
		}
		let collections = [];
		try {
			collections = (item.getCollections?.() || [])
				.map((collectionID) => Zotero.Collections.get(collectionID))
				.filter(Boolean)
				.map((collection) => serializeCollectionForTools(collection));
		}
		catch (_error) {
			collections = [];
		}
		let itemType = "";
		try {
			itemType = item.itemTypeID ? Zotero.ItemTypes.getName(item.itemTypeID) : String(item.itemType || "");
		}
		catch (_error) {
			itemType = String(item?.itemType || "");
		}
		return {
			item_id: Number(item?.id || 0) || 0,
			item_key: String(item?.key || "").trim(),
			item_type: itemType,
			title: String(item?.getField?.("title") || "").trim(),
			year: String(item?.getField?.("date") || "").trim(),
			doi: String(item?.getField?.("DOI") || "").trim(),
			pmid: String(item?.getField?.("PMID") || "").trim(),
			pmcid: String(item?.getField?.("PMCID") || "").trim(),
			arxiv: String(item?.getField?.("arXiv") || "").trim(),
			isbn: String(item?.getField?.("ISBN") || "").trim(),
			collections,
			citation_token: item?.key ? `@[${item.key}]` : "",
		};
	}

	function normalizeCreatorForZotero(entry = {}) {
		if (typeof entry == "string") {
			let name = String(entry || "").trim();
			return name ? { creatorType: "author", name, fieldMode: 1 } : null;
		}
		if (!entry || typeof entry != "object") {
			return null;
		}
		let creatorType = String(entry.creatorType || entry.creator_type || entry.type || "author").trim() || "author";
		let firstName = String(entry.firstName || entry.first_name || entry.given || "").trim();
		let lastName = String(entry.lastName || entry.last_name || entry.family || "").trim();
		let name = String(entry.name || entry.fullName || entry.full_name || "").trim();
		if (name && !firstName && !lastName) {
			return { creatorType, name, fieldMode: 1 };
		}
		if (!firstName && !lastName) {
			return null;
		}
		return { creatorType, firstName, lastName };
	}

	function setItemFieldIfPresent(item, field, value, errors = []) {
		if (value === undefined || value === null || String(value).trim() === "") {
			return;
		}
		try {
			item.setField(field, String(value));
		}
		catch (error) {
			errors.push({
				field,
				error: error?.message || String(error),
			});
		}
	}

	function upsertExtraLine(existingExtra, label, value) {
		let normalizedLabel = String(label || "").trim();
		let normalizedValue = String(value || "").trim();
		if (!normalizedLabel || !normalizedValue) {
			return String(existingExtra || "");
		}
		let pattern = new RegExp(`^${normalizedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "i");
		let lines = String(existingExtra || "")
			.split(/\r?\n/)
			.filter((line) => !pattern.test(String(line || "").trim()));
		lines.push(`${normalizedLabel}: ${normalizedValue}`);
		return lines.filter((line) => String(line || "").trim()).join("\n");
	}

	function updateItemField(item, field, value, changed = {}, errors = []) {
		if (value === undefined || value === null || String(value).trim() === "") {
			return false;
		}
		let normalized = String(value).trim();
		try {
			item.setField(field, normalized);
			changed[field] = normalized;
			return true;
		}
		catch (error) {
			errors.push({
				field,
				error: error?.message || String(error),
			});
			return false;
		}
	}

	function nativeItemJSON(item) {
		let native = {};
		try {
			native = typeof item?.toJSON == "function" ? item.toJSON() : {};
		}
		catch (_error) {
			native = {};
		}
		let supportedFields = [];
		try {
			if (Zotero?.ItemFields?.getItemTypeFields && Zotero?.ItemFields?.getName) {
				supportedFields = (Zotero.ItemFields.getItemTypeFields(item.itemTypeID) || [])
					.map((fieldID) => Zotero.ItemFields.getName(fieldID))
					.filter(Boolean);
			}
		}
		catch (_error) {
			supportedFields = [];
		}
		return {
			item_id: Number(item?.id || 0) || 0,
			item_key: String(item?.key || "").trim(),
			library_id: Number(item?.libraryID || 0) || 0,
			item_type: item?.itemTypeID ? Zotero.ItemTypes.getName(item.itemTypeID) : "",
			native,
			supported_fields: supportedFields,
		};
	}

	function forbiddenNativeWriteKeys(payload = {}) {
		let forbidden = new Set([
			"key",
			"itemKey",
			"item_key",
			"libraryID",
			"library_id",
			"itemID",
			"item_id",
			"version",
		]);
		let found = [];
		let checkObject = (value, prefix) => {
			if (!value || typeof value != "object" || Array.isArray(value)) {
				return;
			}
			for (let key of Object.keys(value)) {
				if (forbidden.has(key)) {
					found.push(prefix ? `${prefix}.${key}` : key);
				}
			}
		};
		checkObject(payload?.fields, "fields");
		checkObject(payload?.metadata, "metadata");
		return found;
	}

	function nativeFieldWritePayload(payload = {}) {
		let fields = {};
		if (payload?.metadata && typeof payload.metadata == "object" && !Array.isArray(payload.metadata)) {
			Object.assign(fields, payload.metadata);
		}
		if (payload?.fields && typeof payload.fields == "object" && !Array.isArray(payload.fields)) {
			Object.assign(fields, payload.fields);
		}
		for (let [source, target] of [
			["title", "title"],
			["date", "date"],
			["year", "date"],
			["abstract", "abstractNote"],
			["abstractNote", "abstractNote"],
			["abstract_note", "abstractNote"],
			["publication_title", "publicationTitle"],
			["publicationTitle", "publicationTitle"],
			["publisher", "publisher"],
			["url", "url"],
			["URL", "url"],
			["DOI", "DOI"],
			["doi", "DOI"],
			["PMID", "PMID"],
			["pmid", "PMID"],
			["PMCID", "PMCID"],
			["pmcid", "PMCID"],
			["arXiv", "arXiv"],
			["arxiv", "arXiv"],
			["ISBN", "ISBN"],
			["isbn", "ISBN"],
			["extra", "extra"],
		]) {
			if (payload?.[source] !== undefined && payload?.[source] !== null) {
				fields[target] = payload[source];
			}
		}
		for (let key of ["key", "itemKey", "item_key", "libraryID", "library_id", "itemID", "item_id", "version"]) {
			delete fields[key];
		}
		return fields;
	}

	function resolveRegularZoteroItem(current, payload = {}, toolName = "items") {
		let itemKey = String(payload?.item_key || payload?.itemKey || "").trim();
		if (!itemKey) {
			throw new Error(`${toolName} requires item_key.`);
		}
		let libraryID = Number(payload?.library_id || payload?.libraryID || current?.context?.libraryID || 0) || 0;
		if (!libraryID) {
			throw new Error(`${toolName} requires a library_id or current project context.`);
		}
		let item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
		if (!item || item.deleted) {
			throw new Error(`Zotero item not found: ${itemKey}.`);
		}
		if (item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
			throw new Error(`${toolName} reads/writes regular Zotero items, not attachments, notes, or annotations.`);
		}
		return item;
	}

	async function createManualZoteroItem(current, definition = {}, targetInfo = null) {
		let target = targetInfo || await resolveExplicitItemTarget(current, definition || {});
		let itemType = String(definition?.item_type || definition?.itemType || "journalArticle").trim() || "journalArticle";
		let item = new Zotero.Item(itemType);
		item.libraryID = target.collection.libraryID;
		item.setCollections([target.collection.id]);
		let fieldErrors = [];
		setItemFieldIfPresent(item, "title", definition?.title, fieldErrors);
		setItemFieldIfPresent(item, "date", definition?.date || definition?.year, fieldErrors);
		setItemFieldIfPresent(item, "abstractNote", definition?.abstract || definition?.abstractNote || definition?.abstract_note, fieldErrors);
		setItemFieldIfPresent(item, "publicationTitle", definition?.publication_title || definition?.publicationTitle, fieldErrors);
		setItemFieldIfPresent(item, "publisher", definition?.publisher, fieldErrors);
		setItemFieldIfPresent(item, "url", definition?.url || definition?.URL, fieldErrors);
		setItemFieldIfPresent(item, "DOI", definition?.DOI || definition?.doi, fieldErrors);
		setItemFieldIfPresent(item, "PMID", definition?.PMID || definition?.pmid, fieldErrors);
		setItemFieldIfPresent(item, "PMCID", definition?.PMCID || definition?.pmcid, fieldErrors);
		setItemFieldIfPresent(item, "arXiv", definition?.arXiv || definition?.arxiv, fieldErrors);
		setItemFieldIfPresent(item, "ISBN", definition?.ISBN || definition?.isbn, fieldErrors);
		setItemFieldIfPresent(item, "extra", definition?.extra, fieldErrors);
		let genericFields = definition?.fields && typeof definition.fields == "object" && !Array.isArray(definition.fields)
			? definition.fields
			: {};
		for (let [field, value] of Object.entries(genericFields)) {
			setItemFieldIfPresent(item, field, value, fieldErrors);
		}
		let creators = (Array.isArray(definition?.creators) ? definition.creators : [])
			.map((entry) => normalizeCreatorForZotero(entry))
			.filter(Boolean);
		if (creators.length) {
			try {
				if (typeof item.setCreators == "function") {
					item.setCreators(creators);
				}
				else if (typeof item.setCreator == "function") {
					creators.forEach((creator, index) => item.setCreator(index, creator, creator.creatorType || "author"));
				}
			}
			catch (error) {
				fieldErrors.push({
					field: "creators",
					error: error?.message || String(error),
				});
			}
		}
		await item.saveTx();
		for (let tag of Array.isArray(definition?.tags) ? definition.tags : []) {
			let text = typeof tag == "string" ? tag : String(tag?.tag || tag?.name || "").trim();
			if (!text) {
				continue;
			}
			try {
				item.addTag(text);
			}
			catch (error) {
				fieldErrors.push({ field: "tags", error: error?.message || String(error) });
			}
		}
		if (Array.isArray(definition?.tags) && definition.tags.length) {
			await item.saveTx();
		}
		let notes = Array.isArray(definition?.notes)
			? definition.notes
			: (definition?.notes ? [definition.notes] : []);
		let noteKeys = [];
		for (let noteText of notes) {
			let text = String(noteText || "").trim();
			if (!text) {
				continue;
			}
			let note = new Zotero.Item("note");
			note.libraryID = item.libraryID;
			note.parentID = item.id;
			note.setNote(text);
			await note.saveTx();
			noteKeys.push(String(note.key || ""));
		}
		return {
			item,
			summary: Object.assign({}, serializeCreatedItem(item), {
				note_keys: noteKeys.filter(Boolean),
				field_errors: fieldErrors,
			}),
		};
	}

	async function readExistingZoteroItemMetadata(current, payload = {}) {
		let item = resolveRegularZoteroItem(current, payload, "items__read_metadata");
		return nativeItemJSON(item);
	}

	async function updateExistingZoteroItemMetadata(current, payload = {}) {
		let forbidden = forbiddenNativeWriteKeys(payload || {});
		if (forbidden.length) {
			throw new Error(`items__write_metadata cannot change immutable Zotero item identity fields: ${forbidden.join(", ")}.`);
		}
		let item = resolveRegularZoteroItem(current, payload, "items__write_metadata");
		let fieldErrors = [];
		let changed = {};
		let genericFields = nativeFieldWritePayload(payload || {});
		for (let [field, value] of Object.entries(genericFields)) {
			updateItemField(item, field, value, changed, fieldErrors);
		}
		if (Array.isArray(payload?.creators)) {
			let creators = payload.creators
				.map((entry) => normalizeCreatorForZotero(entry))
				.filter(Boolean);
			try {
				if (typeof item.setCreators == "function") {
					item.setCreators(creators);
				}
				else if (typeof item.setCreator == "function") {
					item.setCreators([]);
					creators.forEach((creator, index) => item.setCreator(index, creator, creator.creatorType || "author"));
				}
				changed.creators = creators.length;
			}
			catch (error) {
				fieldErrors.push({
					field: "creators",
					error: error?.message || String(error),
				});
			}
		}
		await item.saveTx();
		try {
			if (reviewer?._ensureProjectItemIdentitiesBatched && current?.context) {
				await reviewer._ensureProjectItemIdentitiesBatched(current.context, [item], null, 1);
			}
		}
		catch (error) {
			fieldErrors.push({
				field: "item_identities",
				error: error?.message || String(error),
			});
		}
		return Object.assign({}, serializeCreatedItem(item), {
			updated_fields: changed,
			field_errors: fieldErrors,
			native: nativeItemJSON(item).native,
		});
	}

	async function itemsReadMetadata(current, payload = {}) {
		let item = await readExistingZoteroItemMetadata(current, payload || {});
		return {
			ok: true,
			item,
		};
	}

	async function itemsUpdateMetadata(current, payload = {}) {
		let updated = await updateExistingZoteroItemMetadata(current, payload || {});
		return {
			ok: true,
			updated_count: 1,
			items: [updated],
		};
	}

	async function itemsUpdateMetadataMany(current, payload = {}) {
		let items = Array.isArray(payload?.items) ? payload.items : [];
		if (!items.length) {
			throw new Error("items must be a non-empty array.");
		}
		if (items.length > 50) {
			throw new Error("items__update_metadata_many accepts at most 50 items per call.");
		}
		let updated = [];
		for (let definition of items) {
			updated.push(await updateExistingZoteroItemMetadata(current, Object.assign({}, definition || {}, {
				library_id: definition?.library_id || definition?.libraryID || payload?.library_id || payload?.libraryID,
			})));
		}
		return {
			ok: true,
			updated_count: updated.length,
			items: updated,
		};
	}

	async function applyItemsPostImportAction(current, targetInfo = null, action = "none") {
		let mode = String(action || "none").trim().toLowerCase();
		if (!mode || mode == "none") {
			return null;
		}
		if (!targetInfo?.collection?.key) {
			return null;
		}
		if (!["merge_to_pending", "merge_to_pending_with_embeddings"].includes(mode)) {
			throw new Error("post_import_action must be none, merge_to_pending, or merge_to_pending_with_embeddings.");
		}
		let projectCollections = await SystematicReviewerWorkflowHarvest.ensureProjectCollections(reviewer, current, {
			ensureAddedByUser: false,
		});
		if (String(targetInfo.collection.parentKey || "") != String(projectCollections?.harvest?.root?.key || "")) {
			throw new Error("post_import_action can only be used when the explicit target is a Harvest child source.");
		}
		return await SystematicReviewerWorkflowHarvest.mergeSourceIntoPending({
			reviewer,
			current,
			payload: {
				source_collection_key: String(targetInfo.collection.key || ""),
				with_embeddings: mode == "merge_to_pending_with_embeddings",
				queue_origin: "items.import_identifiers",
			},
			options: {
				openJobsTab: false,
				refreshControllers: false,
				showMergeNotice: false,
				queue_origin: "items.import_identifiers",
			},
		});
	}

	async function itemsCreate(current, payload = {}) {
		let targetInfo = await resolveExplicitItemTarget(current, payload || {});
		let created = await createManualZoteroItem(current, payload || {}, targetInfo);
		return {
			ok: true,
			target: targetInfo.collection_info,
			created_count: 1,
			items: [created.summary],
		};
	}

	async function itemsCreateMany(current, payload = {}) {
		let targetInfo = await resolveExplicitItemTarget(current, payload || {});
		let items = Array.isArray(payload?.items) ? payload.items : [];
		if (!items.length) {
			throw new Error("items must be a non-empty array.");
		}
		if (items.length > 50) {
			throw new Error("items__create_many accepts at most 50 items per call.");
		}
		let created = [];
		for (let definition of items) {
			let result = await createManualZoteroItem(current, Object.assign({}, definition || {}, {
				collection_key: targetInfo.collection.key,
			}), targetInfo);
			created.push(result.summary);
		}
		return {
			ok: true,
			target: targetInfo.collection_info,
			created_count: created.length,
			items: created,
		};
	}

	async function itemsImportIdentifiers(current, payload = {}) {
		let targetInfo = await resolveExplicitItemTarget(current, payload || {});
		let rawIdentifiers = Array.isArray(payload?.identifiers)
			? payload.identifiers
			: (payload?.identifier ? [payload.identifier] : []);
		if (!rawIdentifiers.length) {
			throw new Error("identifiers must be a non-empty array.");
		}
		if (rawIdentifiers.length > 50) {
			throw new Error("items__import_identifiers accepts at most 50 identifiers per call.");
		}
		let records = rawIdentifiers.map((entry) => normalizeZoteroIdentifierRecord(entry)).filter(Boolean);
		let pmcidRecords = records.filter((entry) => String(entry.type || "").trim().toLowerCase() == "pmcid");
		let pmcidMappings = {};
		if (pmcidRecords.length) {
			pmcidMappings = await SystematicReviewerWorkflowOpenAlex.resolvePmcids(
				pmcidRecords.map((entry) => entry.value).filter(Boolean)
			);
		}
		let imported = [];
		let failures = [];
		for (let record of records) {
			let identifier = identifierPayloadForTranslator(record);
			if (!identifier && String(record.type || "").trim().toLowerCase() == "pmcid") {
				let normalizedPMCID = SystematicReviewerWorkflowOpenAlex.normalizePMCID(record.value);
				let mapped = pmcidMappings?.[normalizedPMCID] || null;
				if (mapped?.pmid) {
					identifier = { PMID: String(mapped.pmid || "").trim() };
				}
			}
			if (!identifier) {
				failures.push({
					identifier: record,
					error: "Identifier type is unsupported or could not be resolved for Zotero translator import.",
				});
				continue;
			}
			try {
				let items = await SystematicReviewerWorkflowHarvest.importIdentifierIntoCollections({
					reviewer,
					current,
					context: current.context,
					jobID: "",
					libraryID: targetInfo.collection.libraryID,
					collectionIDs: [targetInfo.collection.id],
					identifier,
				});
				if (!items.length) {
					throw new Error("Zotero translator returned no items.");
				}
				for (let item of items) {
					imported.push(Object.assign({}, serializeCreatedItem(item), {
						source_identifier: record,
					}));
				}
			}
			catch (error) {
				failures.push({
					identifier: record,
					translator_identifier: identifier,
					error: error?.message || String(error),
				});
			}
		}
		let postImportResult = await applyItemsPostImportAction(
			current,
			targetInfo,
			payload?.post_import_action ?? payload?.postImportAction ?? "none"
		);
		return {
			ok: true,
			target: targetInfo.collection_info,
			imported_count: imported.length,
			failed_count: failures.length,
			items: imported,
			failures,
			post_import_action: String(payload?.post_import_action ?? payload?.postImportAction ?? "none"),
			post_import_result: postImportResult,
		};
	}

	function automationChatHasExploreTrigger(message = "") {
		return !!SystematicReviewerWorkflowExplore?.hasColumnPlaceholders?.([message]);
	}

	function normalizeAutoDriveCount(value) {
		let numeric = Math.round(Number(value || 0) || 0);
		if (!numeric) {
			numeric = 3;
		}
		return Math.max(1, Math.min(20, numeric));
	}

	function normalizeAutoDriveReviewerMode(value) {
		let clean = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
		if (["every", "each", "every_turn", "after_every_turn", "after_each_turn"].includes(clean)) {
			return "every_turn";
		}
		if (["final", "final_turn", "final_check", "at_final_turn"].includes(clean)) {
			return "final_turn";
		}
		return "done_blocked";
	}

	function autoDriveReviewerModeLabel(mode = "") {
		let normalized = normalizeAutoDriveReviewerMode(mode);
		if (normalized == "every_turn") {
			return "After every turn";
		}
		if (normalized == "final_turn") {
			return "Final check only";
		}
		return "When agent says done/blocked";
	}

	function autoDriveProjectType(current) {
		return String(current?.projectType || current?.context?.projectType || "systematic_review").trim().toLowerCase() || "systematic_review";
	}

	function autoDrivePromptFallback(assetPath = "") {
		let path = String(assetPath || "").trim();
		if (path == AUTODRIVE_REVIEWER_PROMPT_PATH) {
			return [
				"You are the Auto Drive reviewer. Inspect the current project, the main agent's latest result, REPORT.md, and log.txt.",
				"Decide whether Auto Drive should stop or continue. Use tools when needed.",
				"Check that report citations sit on the exact supported argument, clause, statistic, table cell, or study-specific phrase instead of loose paragraph-end bundles.",
				"Check that large or wide report tables have a table number/title and use page-break plus landscape markers when appropriate.",
				"End with AUTODRIVE_REVIEW_DECISION: continue or AUTODRIVE_REVIEW_DECISION: stop.",
				"Also include AUTODRIVE_REVIEW_SUMMARY and AUTODRIVE_NEXT_PROMPT.",
			].join("\n");
		}
		if (path == AUTODRIVE_CUSTOM_WRAPPER_PATH) {
			return [
				"Auto Drive is running for a custom analysis project.",
				"Follow the user's Auto Drive task below. Inspect project files and tools as needed, update project artifacts when useful, and continue from the real current state.",
				"Use exact @[itemkey] citations on the smallest supported argument, clause, statistic, table cell, or study-specific phrase. For large or wide report tables, use a titled landscape section bounded by page breaks.",
				"{user_prompt}",
			].join("\n\n");
		}
		return [
			"You are in Auto Drive mode for a systematic review project. Continue the review from the real project state.",
			"Inspect REPORT.md at {report_path} first, use log.txt at {log_path} for details, and use tool_search/manual__read when you need workflow or tool guidance.",
			"Make reasonable review decisions on the user's behalf, keep REPORT.md current, and cite citable claims with @[itemkey]. Put citations on the smallest supported argument, clause, statistic, table cell, or study-specific phrase; use multi-key citations only when all keys support the same proposition.",
			"For large or wide report tables, place a table number/title immediately above the table inside a landscape section bounded by <!-- sr:page-break --> markers and <!-- sr:page-layout:landscape -->.",
			"End with AUTODRIVE_CONTINUE or AUTODRIVE_REVIEW_REQUEST.",
		].join("\n");
	}

	async function readAutoDrivePromptAsset(assetPath = "") {
		let path = String(assetPath || "").trim();
		if (!path) {
			return "";
		}
		try {
			if (SystematicReviewerAutomationDocs?.readAssetText) {
				return await SystematicReviewerAutomationDocs.readAssetText(reviewer, path);
			}
		}
		catch (error) {
			reviewer?.log?.(`autodrive prompt asset fallback for ${path}: ${error?.message || String(error)}`);
		}
		return autoDrivePromptFallback(path);
	}

	function renderAutoDriveTemplate(template = "", values = {}) {
		return String(template || "").replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
			if (Object.prototype.hasOwnProperty.call(values || {}, key)) {
				return String(values[key] ?? "");
			}
			return match;
		}).trim();
	}

	function autoDriveScopeSummary(scopes = []) {
		let entries = (Array.isArray(scopes) ? scopes : [])
			.map((entry) => {
				let name = String(entry?.collection_name || entry?.label || entry?.collection_key || "").trim();
				let key = String(entry?.collection_key || "").trim();
				return name && key ? `${name} (${key})` : (name || key);
			})
			.filter(Boolean)
			.slice(0, 30);
		return entries.join(" | ");
	}

	async function autoDrivePromptValues(current, sessionID = "") {
		let activeSessionID = String(sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		let sessionState = await reviewer._loadSessionState(current.context, activeSessionID).catch(() => null);
		let projectCounts = await reviewer._projectCounts(current.context).catch(() => ({}));
		let inspection = await reviewer._inspectProjectSession(current).catch(() => ({}));
		let scopes = [];
		try {
			scopes = SystematicReviewerWorkflowScreening?.availableScopes
				? (SystematicReviewerWorkflowScreening.availableScopes(reviewer, current) || [])
				: [];
		}
		catch (_error) {
			scopes = [];
		}
		return {
			project_id: String(current?.context?.projectID || "").trim(),
			project_type: autoDriveProjectType(current),
			collection_name: String(current?.context?.collectionName || "").trim(),
			project_root: String(current?.context?.projectRoot || "").trim(),
			report_path: String(current?.context?.reportPath || "").trim(),
			log_path: String(current?.context?.logPath || "").trim(),
			session_id: activeSessionID,
			session_title: String(sessionState?.title || activeSessionID || "Collection Session").trim(),
			project_counts: JSON.stringify(projectCounts || {}, null, 2),
			project_counts_inline: [
				`total=${projectCounts.total ?? "?"}`,
				`pending=${projectCounts.pending ?? "?"}`,
				`included=${projectCounts.included ?? "?"}`,
				`excluded=${projectCounts.excluded ?? "?"}`,
				`excluded_ft=${projectCounts.excluded_ft ?? projectCounts.excludedFT ?? "?"}`,
				`attachments=${projectCounts.attachments ?? "?"}`,
			].join(", "),
			project_inspection: JSON.stringify(inspection || {}, null, 2),
			available_scopes: autoDriveScopeSummary(scopes),
		};
	}

	async function automationAutoDrivePromptDefaults(current, payload = {}) {
		let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		await reviewer._activateSessionContext(current, sessionID);
		current.sessionID = sessionID;
		let values = await autoDrivePromptValues(current, sessionID);
		let projectType = autoDriveProjectType(current);
		let systematic = projectType == "systematic_review";
		let promptText = "";
		if (systematic) {
			promptText = renderAutoDriveTemplate(
				await readAutoDrivePromptAsset(AUTODRIVE_SYSTEMATIC_PROMPT_PATH),
				values
			);
		}
		let customWrapper = renderAutoDriveTemplate(
			await readAutoDrivePromptAsset(AUTODRIVE_CUSTOM_WRAPPER_PATH),
			Object.assign({}, values, {
				user_prompt: "{user_prompt}",
			})
		);
		let reviewerPromptText = renderAutoDriveTemplate(
			await readAutoDrivePromptAsset(AUTODRIVE_REVIEWER_PROMPT_PATH),
			Object.assign({}, values, {
				main_session_id: sessionID,
				reviewer_session_id: autoDriveReviewerSessionID(sessionID),
				reviewer_mode: autoDriveReviewerModeLabel("done_blocked"),
				turn_index: "{turn_index}",
				total_turns: "{total_turns}",
				remaining_turns: "{remaining_turns}",
				main_reply: "{main_reply}",
				main_review_reason: "{main_review_reason}",
				previous_reviewer_summary: "{previous_reviewer_summary}",
			})
		);
		return {
			ok: true,
			project_id: values.project_id,
			project_type: projectType,
			requires_prompt: !systematic,
			prompt_text: promptText,
			reviewer_prompt_text: reviewerPromptText,
			custom_wrapper: customWrapper,
			default_count: 3,
			min_count: 1,
			max_count: 20,
			default_reviewer_mode: "done_blocked",
			reviewer_modes: [
				{ mode: "done_blocked", label: "When agent says done/blocked" },
				{ mode: "every_turn", label: "After every turn" },
				{ mode: "final_turn", label: "Final check only" },
			],
			paths: {
				project_root: values.project_root,
				report_path: values.report_path,
				log_path: values.log_path,
			},
			counts: JSON.parse(values.project_counts || "{}"),
			available_scopes: values.available_scopes,
		};
	}

	function automationScopeNameMatch(entry = {}, name = "") {
		return String(entry?.collection_name || "").trim().toLowerCase() == String(name || "").trim().toLowerCase();
	}

	async function resolveAutomationExploreScope(current, sessionID = "", payload = {}) {
		let scopes = SystematicReviewerWorkflowScreening.availableScopes(reviewer, current) || [];
		if (!scopes.length) {
			throw new Error("No project scopes are available for Explore.");
		}
		let requestedKey = String(
			payload?.explore_scope_key
			|| payload?.exploreScopeKey
			|| payload?.collection_key
			|| payload?.collectionKey
			|| ""
		).trim();
		if (requestedKey) {
			let requested = scopes.find((entry) => String(entry?.collection_key || "").trim() == requestedKey) || null;
			if (requested) {
				return requested;
			}
		}
		let sessionState = sessionID
			? await reviewer._loadSessionState(current.context, sessionID).catch(() => null)
			: null;
		let rememberedKey = String(sessionState?.last_explore_scope_key || "").trim();
		if (rememberedKey) {
			let remembered = scopes.find((entry) => String(entry?.collection_key || "").trim() == rememberedKey) || null;
			if (remembered) {
				return remembered;
			}
		}
		if (String(current?.projectType || current?.context?.projectType || "").trim() == "systematic_review") {
			let included = scopes.find((entry) => automationScopeNameMatch(entry, "Included")) || null;
			if (included) {
				return included;
			}
		}
		return scopes[0] || null;
	}

	async function prepareAutomationExploreRuntime(current, sessionID = "") {
		let activeSessionID = String(sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		let config = await reviewer._conversionConfig();
		reviewer._assertSessionChatExecutionReady(config);
		let runtimeState = await reviewer._loadSessionRuntimeState(current.context, activeSessionID);
		let prepared = await reviewer._prepareRoleAPIClient("session_chat", config.chatClient, config, {
			presetID: runtimeState?.chat_preset_id || "default",
			modelOverride: runtimeState?.chat_model_override || "",
			reasoningEffort: runtimeState?.chat_reasoning_effort || "",
			cwd: current?.context?.projectRoot || "",
		});
		let client = prepared.client || config.chatClient;
		let preparedClientHasReasoning = Object.prototype.hasOwnProperty.call(prepared?.client || {}, "reasoningEffort");
		client.reasoningEffort = String(preparedClientHasReasoning
			? prepared.client.reasoningEffort
			: (runtimeState?.chat_reasoning_effort || "")).trim().toLowerCase();
		let apiKind = String(client?.apiKind || "responses").trim();
		if (!["responses", "chat_completions"].includes(apiKind)) {
			await prepared.release?.();
			throw new Error("Automation Explore requires a Responses-compatible runtime.");
		}
		return {
			config,
			client,
			roleID: "session_chat",
			label: "Agent Model",
			context_tokens: Number(client?.contextWindow || 0) || 0,
			reserve_tokens: Number(client?.maxOutputTokens || 0) || 10000,
			preset_id: String(client?.presetID || runtimeState?.chat_preset_id || "default").trim() || "default",
			preset_label: String(client?.presetLabel || "").trim(),
			release: prepared.release || (async () => {}),
		};
	}

	async function runAutomationExploreSession(current, sessionID = "", message = "", payload = {}, handlers = null, options = {}) {
		let activeSessionID = String(sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		let scope = await resolveAutomationExploreScope(current, activeSessionID, payload || {});
		let runtime = null;
		try {
			runtime = await prepareAutomationExploreRuntime(current, activeSessionID);
			let result = await SystematicReviewerWorkflowExplore.runAutomationChat({
				reviewer,
				current,
				payload: {
					prompt: message,
					chat_name: String(payload?.chat_name || payload?.chatName || "").trim() || `Explore ${new Date().toLocaleString()}`,
					collection_key: String(scope?.collection_key || "").trim(),
					collection_name: String(scope?.collection_name || "").trim(),
					session_id: activeSessionID,
					system_prompt: String(payload?.system_prompt || payload?.systemPrompt || "").trim(),
					origin: "automation",
					abortSignal: payload?.abortSignal || null,
				},
				runtime,
				onProgress: async (event = {}) => {
					let type = String(event?.type || "").trim();
					if (type == "batch.completed") {
						await handlers?.onEvent?.({
							type: "explore.batch.completed",
							batch: {
								chat_id: String(event?.chat_id || "").trim(),
								chat_name: String(event?.chat_name || "").trim(),
								batch_index: Number(event?.batch_index || 0) || 0,
								batch_count: Number(event?.batch_count || 0) || 0,
								row_count: Number(event?.message?.row_count || 0) || 0,
								content: String(event?.message?.content || ""),
								artifact_path: String(event?.artifact_path || "").trim(),
								citations: Array.isArray(event?.message?.citations) ? event.message.citations : [],
							},
						});
						return;
					}
					if (type == "run.started") {
						await handlers?.onEvent?.({
							type: "explore.run.started",
							run: event,
						});
					}
				},
			});
			await reviewer._updateSessionState(current.context, activeSessionID, {
				last_explore_scope_key: String(scope?.collection_key || "").trim(),
			});
			if (String(result?.reply || "").trim()) {
				await recordExploreSynthesisArtifact(current, [
					markdownHeadingBlock(
						`${new Date().toISOString()} ${String(result?.chat?.name || "Explore Synthesis").trim()}`,
						[
							`- Scope: ${String(scope?.collection_name || "").trim() || "(not recorded)"}`,
							`- Rows: ${Number(result?.selection?.row_count || 0) || 0}`,
							`- Batches: ${Number(result?.selection?.batch_count || 0) || 0}`,
						]
					),
					"",
					String(result.reply || "").trim(),
				].join("\n"));
			}
			if (options?.appendSessionEntries !== false) {
				await appendExploreResultToSession(current, activeSessionID, result, scope || null, handlers);
			}
			return Object.assign({}, result, {
				scope: scope || null,
			});
		}
		finally {
			await runtime?.release?.();
		}
	}

	async function appendExploreResultToSession(current, sessionID = "", result = {}, scope = null, handlers = null) {
		let activeSessionID = String(sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		let reply = String(result?.reply || "").trim();
		if (!activeSessionID || !reply) {
			return {
				run_entry: null,
				assistant_entry: null,
			};
		}
		let resolvedScope = scope && typeof scope == "object"
			? scope
			: (result?.scope && typeof result.scope == "object" ? result.scope : null);
		let runEntry = await reviewer._appendSessionEvent(current.context, activeSessionID, "explore_run", {
			role: "system",
			title: `Explore: ${String(result?.chat?.name || "Run").trim()}`,
			content: [
				`Explore run over ${Number(result?.selection?.row_count || 0) || 0} rows in ${Number(result?.selection?.batch_count || 0) || 0} batch(es).`,
				String(resolvedScope?.collection_name || resolvedScope?.scope_name || "").trim()
					? `Scope: ${String(resolvedScope?.collection_name || resolvedScope?.scope_name || "").trim()}`
					: "",
				String(result?.chat?.name || "").trim() ? `Saved run: ${String(result.chat.name || "").trim()}` : "",
			].filter(Boolean).join("\n"),
			payload: {
				chat_id: String(result?.chat?.id || "").trim(),
				chat_name: String(result?.chat?.name || "").trim(),
				scope_key: String(resolvedScope?.collection_key || resolvedScope?.scope_key || "").trim(),
				scope_name: String(resolvedScope?.collection_name || resolvedScope?.scope_name || "").trim(),
				row_count: Number(result?.selection?.row_count || 0) || 0,
				batch_count: Number(result?.selection?.batch_count || 0) || 0,
				column_keys: Array.isArray(result?.selection?.column_keys) ? result.selection.column_keys : [],
				markdown_path: String(result?.markdown_path || "").trim(),
				batches: Array.isArray(result?.batches) ? result.batches : [],
				reply_source: String(result?.reply_source || "").trim(),
				completion_status: String(result?.completion_status || "").trim(),
			},
		});
		await emitAutomationTimelineEntry(handlers, runEntry);
		let assistantEntry = await reviewer._appendSessionMessage(current.context, activeSessionID, "assistant", reply, {
			eventType: "assistant_final",
			title: "Explore Synthesis",
			payload: {
				explore_chat_id: String(result?.chat?.id || "").trim(),
				scope_key: String(resolvedScope?.collection_key || resolvedScope?.scope_key || "").trim(),
				reply_source: String(result?.reply_source || "").trim(),
				completion_status: String(result?.completion_status || "").trim(),
			},
		});
		await emitAutomationTimelineEntry(handlers, assistantEntry);
		return {
			run_entry: runEntry,
			assistant_entry: assistantEntry,
		};
	}

	async function appendDocumentFindResultToSession(current, sessionID = "", result = {}, handlers = null) {
		let activeSessionID = String(sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		if (!activeSessionID) {
			return null;
		}
		let returned = Number(result?.returned_documents || 0) || 0;
		let total = Number(result?.total_documents || 0) || 0;
		let query = String(result?.query || "").trim();
		let mode = String(result?.mode || "keyword").trim() || "keyword";
		let reply = returned
			? [
				`Find Arguments (${mode}): ${query}`,
				`Returned ${returned}${total ? ` of ${total}` : ""} document${returned === 1 ? "" : "s"}.`,
			].filter(Boolean).join("\n")
			: `Find Arguments (${mode}): ${query}\nNo matching full-text chunks were found.`;
		let entry = await reviewer._appendSessionMessage(current.context, activeSessionID, "assistant", reply, {
			eventType: "documents_find",
			title: "Find Arguments",
			payload: {
				search_id: String(result?.search_id || "").trim(),
				query,
				mode,
				keyword_backend: String(result?.keyword_backend || "").trim(),
				model: String(result?.model || "").trim(),
				scope: result?.scope || null,
				has_more: !!result?.has_more,
				next_offset: Number(result?.next_offset || 0) || 0,
				returned_documents: Number(result?.returned_documents || 0) || 0,
				total_documents: Number(result?.total_documents || 0) || 0,
				results: compactDocumentFindSessionResults(result?.results || []),
			},
		});
		await emitAutomationTimelineEntry(handlers, entry);
		return entry;
	}

	function compactSessionEntry(entry = null) {
		if (!entry || typeof entry != "object") {
			return null;
		}
		return {
			session_id: String(entry?.session_id || "").trim(),
			sequence_no: Number(entry?.sequence_no || 0) || 0,
			event_type: String(entry?.event_type || "").trim(),
			role: String(entry?.role || "").trim(),
			title: String(entry?.title || "").trim(),
			created_at: String(entry?.created_at || "").trim(),
		};
	}

	function compactDocumentFindResult(result = {}) {
		let out = Object.assign({}, result || {});
		out.results = (Array.isArray(result?.results) ? result.results : []).map((doc) => Object.assign({}, doc, {
			chunks: (Array.isArray(doc?.chunks) ? doc.chunks : []).map((chunk) => {
				let next = Object.assign({}, chunk);
				delete next.long_excerpt;
				return next;
			}),
		}));
		delete out.all_results;
		return out;
	}

	function compactDocumentFindText(value = "", maxChars = 900) {
		let text = String(value || "").replace(/\s+/g, " ").trim();
		let limit = Math.max(120, Number(maxChars || 0) || 900);
		if (text.length <= limit) {
			return text;
		}
		return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
	}

	function compactDocumentFindSessionResults(results = []) {
		return (Array.isArray(results) ? results : []).map((doc) => ({
			item_key: String(doc?.item_key || "").trim(),
			citation_token: String(doc?.citation_token || "").trim(),
			chunks: (Array.isArray(doc?.chunks) ? doc.chunks : []).map((chunk) => ({
				chunk_id: String(chunk?.chunk_id || "").trim(),
				chunk_index: Number(chunk?.chunk_index || 0) || 0,
				attachment_key: String(chunk?.attachment_key || "").trim(),
				relative_path: String(chunk?.relative_path || "").trim(),
				page_label: String(chunk?.page_label || "").trim(),
				section_label: String(chunk?.section_label || "").trim(),
				heading_path: Array.isArray(chunk?.heading_path)
					? chunk.heading_path.map((part) => String(part || "").trim()).filter(Boolean)
					: [],
				next_heading_path: Array.isArray(chunk?.next_heading_path)
					? chunk.next_heading_path.map((part) => String(part || "").trim()).filter(Boolean)
					: [],
				excerpt: compactDocumentFindText(chunk?.excerpt || chunk?.snippet || "", 520),
				long_excerpt: compactDocumentFindText(chunk?.long_excerpt || "", 1000),
				highlight_text: compactDocumentFindText(chunk?.highlight_text || "", 220),
				start_offset: Number(chunk?.start_offset || 0) || 0,
				end_offset: Number(chunk?.end_offset || 0) || 0,
			})),
		}));
	}

	function combineAutomationSteerMessages(...messages) {
		if (typeof reviewer?._combineSteerMessages == "function") {
			return reviewer._combineSteerMessages(...messages);
		}
		let seen = new Set();
		let combined = [];
		for (let message of messages) {
			let text = String(message || "").trim();
			if (!text || seen.has(text)) {
				continue;
			}
			seen.add(text);
			combined.push(text);
		}
		return combined.join("\n\n").trim();
	}

	async function emitAutomationTimelineEntry(handlers = null, entry = null) {
		if (!entry) {
			return;
		}
		await handlers?.onEvent?.({
			type: "timeline.entry",
			entry,
		});
	}

	function automationProgressHandlers(handlers = null) {
		return handlers && typeof handlers.onEvent == "function"
			? handlers
			: { onEvent: async () => {} };
	}

	function compactAutomationUserPayload(payload = {}) {
		let source = payload && typeof payload == "object" ? payload : {};
		let out = {};
		for (let key of ["origin", "queue_id", "mode"]) {
			let value = String(source?.[key] || "").trim();
			if (value) {
				out[key] = value;
			}
		}
		for (let key of ["autodrive", "autodrive_reviewer"]) {
			if (source?.[key] && typeof source[key] == "object" && !Array.isArray(source[key])) {
				out[key] = Object.assign({}, source[key]);
			}
		}
		return Object.keys(out).length ? out : null;
	}

	async function appendAutomationUserMessage(current, sessionID = "", message = "", payload = {}, handlers = null) {
		let entry = await reviewer._appendSessionMessage(current.context, sessionID, "user", String(message || "").trim(), {
			eventType: "user_message",
			title: String(payload?.title || "").trim() || (payload?.origin == "api" ? "API Message" : ""),
			payload: compactAutomationUserPayload(payload || {}),
		});
		await emitAutomationTimelineEntry(handlers, entry);
		return entry;
	}

	async function appendAutomationAssistantMessage(current, sessionID = "", message = "", options = {}, handlers = null) {
		let entry = await reviewer._appendSessionMessage(current.context, sessionID, "assistant", String(message || "").trim(), options || {});
		await emitAutomationTimelineEntry(handlers, entry);
		return entry;
	}

	async function appendAutomationErrorEntries(current, sessionID = "", error, handlers = null) {
		let message = error?.message || String(error);
		let errorEntry = await reviewer._appendSessionEvent(current.context, sessionID, "error", {
			role: "system",
			title: "Assistant Error",
			content: message,
			payload: {
				message,
			},
		});
		await emitAutomationTimelineEntry(handlers, errorEntry);
		let assistantEntry = await reviewer._appendSessionMessage(
			current.context,
			sessionID,
			"assistant",
			`I hit an error while processing this session: ${message}`,
			{
				eventType: "assistant_final",
				title: "Assistant Error",
			}
		);
		await emitAutomationTimelineEntry(handlers, assistantEntry);
	}

	async function consumeAutomationPendingSteer(current, sessionID = "", handlers = null) {
		let pending = await reviewer._consumeSessionPendingMessage(current.context, sessionID, {
			mode: "steer",
		});
		if (!pending) {
			return null;
		}
		let entry = await reviewer._appendSessionMessage(current.context, sessionID, "user", String(pending.content || "").trim(), {
			eventType: "user_message",
			title: "Steer Message",
			payload: {
				queue_id: String(pending.queue_id || "").trim(),
				mode: "steer",
			},
		});
		await emitAutomationTimelineEntry(handlers, entry);
		return pending;
	}

	async function consumeAutomationQueuedMessage(current, sessionID = "") {
		return await reviewer._consumeSessionPendingMessage(current.context, sessionID, {
			mode: "queued",
		});
	}

	async function executeAutomationMessage(current, sessionID = "", message = "", payload = {}, handlers = null, options = {}) {
		let text = String(message || "").trim();
		if (!text) {
			return;
		}
		let nextPayload = payload && typeof payload == "object"
			? Object.assign({}, payload)
			: {};
		let queueMessage = options?.queueMessage && typeof options.queueMessage == "object"
			? options.queueMessage
			: null;
		if (queueMessage) {
			let queueID = String(queueMessage.queue_id || "").trim();
			let queueMode = String(queueMessage.mode || "queued").trim() || "queued";
			if (queueID && !String(nextPayload.queue_id || "").trim()) {
				nextPayload.queue_id = queueID;
			}
			if (queueMode && !String(nextPayload.mode || "").trim()) {
				nextPayload.mode = queueMode;
			}
		}
			let activeEntry = await appendAutomationUserMessage(current, sessionID, text, nextPayload, handlers);
		if (text.startsWith("/")) {
			let response = await reviewer._handleLocalCommand(current, sessionID, text);
			if (response) {
				await appendAutomationAssistantMessage(current, sessionID, response, {
					eventType: "assistant_final",
					title: "Local Command",
				}, handlers);
			}
			return response || "";
		}
		if (automationChatHasExploreTrigger(text)) {
			let steerMessage = await consumeAutomationPendingSteer(current, sessionID, handlers);
			let effectivePrompt = combineAutomationSteerMessages(text, steerMessage?.content || "");
			return await runAutomationExploreSession(current, sessionID, effectivePrompt, Object.assign({}, payload || {}, {
				abortSignal: options?.abortSignal || payload?.abortSignal || null,
			}), handlers || null);
		}
			return await reviewer._runSessionAgent(current, sessionID, text, {
				origin: payload?.origin || options?.origin || "ui",
				activeEntrySequenceNo: Number(activeEntry?.sequence_no || 0) || 0,
				activeEntrySequenceNos: [Number(activeEntry?.sequence_no || 0) || 0].filter(Boolean),
				activeInstructionPayload: activeEntry?.payload || nextPayload || null,
				emitProgress: false,
				abortSignal: options?.abortSignal || payload?.abortSignal || null,
			progress: handlers
				? {
					onEvent: async (event) => {
						await handlers?.onEvent?.(event);
					},
				}
				: null,
		});
	}

	async function runAutomationMessageLoop(current, sessionID = "", message = "", payload = {}, handlers = null, options = {}) {
		let nextMessage = String(message || "").trim();
		let nextPayload = payload && typeof payload == "object"
			? Object.assign({}, payload)
			: {};
		let nextQueueMessage = null;
		while (nextMessage) {
			if (options?.abortSignal?.aborted) {
				throw automationAbortError();
			}
			await executeAutomationMessage(current, sessionID, nextMessage, nextPayload, handlers, Object.assign({}, options || {}, {
				queueMessage: nextQueueMessage,
			}));
			if (options?.abortSignal?.aborted) {
				throw automationAbortError();
			}
			nextQueueMessage = null;
			let queued = await consumeAutomationQueuedMessage(current, sessionID);
			if (!queued?.content) {
				return;
			}
			nextMessage = String(queued.content || "").trim();
			nextPayload = queued?.payload && typeof queued.payload == "object"
				? Object.assign({}, queued.payload)
				: {};
			nextQueueMessage = queued;
		}
	}

	async function streamAutomationChat(payload = {}, handlers = {}) {
		let current = await requireCurrentProject(payload || {});
		let message = String(payload?.message || "").trim();
		if (!message) {
			throw new Error("message is required.");
		}
		cleanupAutomationChatRuns();
		for (let run of automationChatRuns.values()) {
			if (run?.projectID == current?.context?.projectID && run?.status == "running") {
				throw new Error("A collection session run is already in progress.");
			}
		}
		let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		await reviewer._activateSessionContext(current, sessionID);
		current.sessionID = sessionID;
		await reviewer._ensureSessionWelcome(current, sessionID);
		let existingTimeline = await reviewer._loadSessionTimeline(current.context, sessionID);
		let runID = `automation-stream-${Date.now()}-${++automationChatRunCounter}`;
		let sequenceBase = Number(existingTimeline[existingTimeline.length - 1]?.sequence_no || existingTimeline.length || 0) || 0;
		let run = createAutomationChatRun(current, sessionID, runID, sequenceBase);
		automationChatRuns.set(runID, run);
		await handlers?.onEvent?.({
			type: "run.started",
			run: automationChatRunSnapshot(run),
		});
		try {
			await runAutomationMessageLoop(current, sessionID, message, payload || {}, handlers || null, {
				origin: payload?.origin || "ui",
				abortSignal: run?.abortController?.signal || null,
			});
			if (String(run?.status || "").trim() == "running") {
				run.status = "complete";
				run.finishedAt = new Date().toISOString();
				run.error = "";
			}
		}
		catch (error) {
			if (isAutomationAbortError(error) || run?.canceled || run?.abortController?.signal?.aborted) {
				run.status = "canceled";
				run.finishedAt = run.finishedAt || new Date().toISOString();
				run.error = run.cancelReason || error?.message || "Session run stopped.";
				return Object.assign({
					ok: true,
					canceled: true,
				}, await automationChatState(current, sessionID, run, {
					historyLimit: payload?.history_limit || payload?.historyLimit,
				}));
			}
				await appendAutomationErrorEntries(current, sessionID, error, handlers);
				run.status = "error";
				run.error = error?.message || String(error);
				run.finishedAt = new Date().toISOString();
				try {
					error.automation_result = await automationChatState(current, sessionID, run, {
						historyLimit: payload?.history_limit || payload?.historyLimit,
					});
				}
				catch (_stateError) {}
				throw error;
			}
		return await automationChatState(current, sessionID, run, {
			historyLimit: payload?.history_limit || payload?.historyLimit,
		});
	}

	async function automationBeginChatRun(current, payload = {}) {
		let message = String(payload?.message || "").trim();
		if (!message) {
			throw new Error("message is required.");
		}
		cleanupAutomationChatRuns();
		for (let run of automationChatRuns.values()) {
			if (run?.projectID == current?.context?.projectID && run?.status == "running") {
				throw new Error("A collection session run is already in progress.");
			}
		}
		let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		await reviewer._activateSessionContext(current, sessionID);
		current.sessionID = sessionID;
		await reviewer._ensureSessionWelcome(current, sessionID);
		let existingTimeline = await reviewer._loadSessionTimeline(current.context, sessionID);
		let runID = `automation-chat-${Date.now()}-${++automationChatRunCounter}`;
		let run = createAutomationChatRun(
			current,
			sessionID,
			runID,
			Number(existingTimeline[existingTimeline.length - 1]?.sequence_no || existingTimeline.length || 0) || 0
		);
		run.promise = (async () => {
			try {
				await runAutomationMessageLoop(current, sessionID, message, payload || {}, automationProgressHandlers(null), {
					origin: payload?.origin || "ui",
					abortSignal: run?.abortController?.signal || null,
				});
				if (String(run?.status || "").trim() == "running") {
					run.status = "complete";
					run.finishedAt = new Date().toISOString();
					run.error = "";
				}
			}
			catch (error) {
				if (isAutomationAbortError(error) || run?.canceled || run?.abortController?.signal?.aborted) {
					run.status = "canceled";
					run.error = run.cancelReason || error?.message || "Session run stopped.";
					run.finishedAt = run.finishedAt || new Date().toISOString();
					return;
				}
				run.status = "error";
				run.error = error?.message || String(error);
				run.finishedAt = new Date().toISOString();
			}
		})();
		automationChatRuns.set(runID, run);
		return Object.assign({
			ok: true,
			run_id: runID,
		}, await automationChatState(current, sessionID, run, {
			historyLimit: payload?.history_limit || payload?.historyLimit,
		}));
	}

	function autoDriveMarkerValue(text = "", marker = "") {
		let source = String(text || "");
		let name = String(marker || "").trim();
		if (!source || !name) {
			return "";
		}
		let escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		let match = source.match(new RegExp(`${escaped}\\s*:\\s*([^\\n\\r]*)`, "i"));
		return String(match?.[1] || "").trim();
	}

	function parseAutoDriveMainReply(reply = "") {
		let reviewRequest = autoDriveMarkerValue(reply, "AUTODRIVE_REVIEW_REQUEST");
		let continueNote = autoDriveMarkerValue(reply, "AUTODRIVE_CONTINUE");
		return {
			review_requested: !!reviewRequest,
			review_reason: reviewRequest,
			continue_note: continueNote,
		};
	}

	function parseAutoDriveReviewerReply(reply = "") {
		let decision = autoDriveMarkerValue(reply, "AUTODRIVE_REVIEW_DECISION").toLowerCase();
		if (!["stop", "continue"].includes(decision)) {
			decision = "continue";
		}
		let summary = autoDriveMarkerValue(reply, "AUTODRIVE_REVIEW_SUMMARY");
		let nextPrompt = autoDriveMarkerValue(reply, "AUTODRIVE_NEXT_PROMPT");
		if (!summary) {
			summary = String(reply || "").trim().slice(0, 1200).trim();
		}
		return {
			decision,
			summary,
			next_prompt: nextPrompt,
		};
	}

	function autoDriveReviewerSessionID(mainSessionID = "") {
		let base = String(mainSessionID || "default").trim() || "default";
		return `${base}-autodrive-reviewer`;
	}

	async function ensureAutoDriveReviewerSession(current, mainSessionID = "") {
		let reviewerSessionID = autoDriveReviewerSessionID(mainSessionID);
		let existing = await reviewer._loadSessionMeta(current.context, reviewerSessionID, { create: false }).catch(() => null);
		if (!existing) {
			await reviewer._createSession(current.context, {
				sessionID: reviewerSessionID,
				title: "Auto Drive reviewer",
				activate: false,
			});
		}
		let mainState = await reviewer._loadSessionState(current.context, mainSessionID).catch(() => null);
		let title = `${String(mainState?.title || mainSessionID || "Collection Session").trim()} (Auto Drive reviewer)`;
		await reviewer._updateSessionState(current.context, reviewerSessionID, {
			title,
		});
		let mainRuntime = await reviewer._loadSessionRuntimeState(current.context, mainSessionID).catch(() => null);
		let reviewerMeta = await reviewer._loadSessionMeta(current.context, reviewerSessionID, { create: true }).catch(() => null);
		let reviewerRuntime = await reviewer._loadSessionRuntimeState(current.context, reviewerSessionID).catch(() => null);
		let runtimeMarker = reviewerMeta?.summary?.autodrive_reviewer_runtime && typeof reviewerMeta.summary.autodrive_reviewer_runtime == "object"
			? reviewerMeta.summary.autodrive_reviewer_runtime
			: {};
		let inheritedFromMain = String(runtimeMarker?.inherited_from || "").trim() == String(mainSessionID || "").trim();
		let reviewerDefaultRuntime =
			String(reviewerRuntime?.chat_preset_id || "default").trim() == "default"
			&& !String(reviewerRuntime?.chat_model_override || "").trim()
			&& !String(reviewerRuntime?.chat_reasoning_effort || "").trim();
		let reviewerMatchesMain =
			String(reviewerRuntime?.chat_preset_id || "default").trim() == String(mainRuntime?.chat_preset_id || "default").trim()
			&& String(reviewerRuntime?.chat_model_override || "").trim() == String(mainRuntime?.chat_model_override || "").trim()
			&& String(reviewerRuntime?.chat_reasoning_effort || "").trim() == String(mainRuntime?.chat_reasoning_effort || "").trim();
		if (mainRuntime && (!existing || inheritedFromMain || reviewerDefaultRuntime || reviewerMatchesMain)) {
			await reviewer._updateSessionRuntimeState(current.context, reviewerSessionID, {
				chat_preset_id: mainRuntime.chat_preset_id || "default",
				chat_previous_response_id: "",
				chat_reasoning_effort: mainRuntime.chat_reasoning_effort || "",
				chat_model_override: mainRuntime.chat_model_override || "",
			});
			await reviewer._updateSessionState(current.context, reviewerSessionID, {
				summaryPatch: {
					autodrive_reviewer_runtime: {
						inherited_from: String(mainSessionID || "").trim(),
						inherited_at: new Date().toISOString(),
						chat_preset_id: mainRuntime.chat_preset_id || "default",
						chat_reasoning_effort: mainRuntime.chat_reasoning_effort || "",
						chat_model_override: mainRuntime.chat_model_override || "",
					},
				},
			});
		}
		return reviewerSessionID;
	}

	function buildAutoDriveMainPrompt(state = {}, options = {}) {
		let turnIndex = Number(options.turnIndex || 0) || 1;
		let totalTurns = Number(state.totalTurns || 0) || 1;
		let remainingAfterThis = Math.max(0, totalTurns - turnIndex);
		let reviewerMode = normalizeAutoDriveReviewerMode(state.reviewerMode);
		let reviewerInstruction = String(state.nextReviewerInstruction || "").trim();
		let previousMain = String(state.previousMainContinueNote || "").trim();
		return [
			`Auto Drive turn ${turnIndex} of ${totalTurns}.`,
			`Reviewer mode: ${autoDriveReviewerModeLabel(reviewerMode)}.`,
			`Main-agent turns remaining after this one: ${remainingAfterThis}.`,
			"",
			reviewerInstruction
				? `Reviewer feedback to address before anything else:\n${reviewerInstruction}`
				: "",
			previousMain
				? `Previous Auto Drive continuation note:\n${previousMain}`
				: "",
			"",
			"End this turn with exactly one of these marker lines:",
			"- AUTODRIVE_CONTINUE: <brief next thing Auto Drive should continue with>",
			"- AUTODRIVE_REVIEW_REQUEST: <brief reason you believe the review is complete, blocked, or should stop>",
			"",
			"Auto Drive task prompt:",
			String(state.basePrompt || "").trim(),
		].filter((part) => String(part || "").trim()).join("\n\n").trim();
	}

	async function buildAutoDriveReviewerPrompt(current, state = {}, options = {}) {
		let values = await autoDrivePromptValues(current, state.mainSessionID || "");
		let template = String(state.reviewerPrompt || "").trim()
			|| await readAutoDrivePromptAsset(AUTODRIVE_REVIEWER_PROMPT_PATH);
		return renderAutoDriveTemplate(template, Object.assign({}, values, {
			main_session_id: String(state.mainSessionID || "").trim(),
			reviewer_session_id: String(state.reviewerSessionID || "").trim(),
			reviewer_mode: autoDriveReviewerModeLabel(state.reviewerMode || ""),
			turn_index: Number(options.turnIndex || 0) || 0,
			total_turns: Number(state.totalTurns || 0) || 0,
			remaining_turns: Math.max(0, Number(state.totalTurns || 0) - Number(options.turnIndex || 0)),
			main_reply: String(options.mainReply || "").trim(),
			main_review_reason: String(options.mainReviewReason || "").trim(),
			previous_reviewer_summary: String(state.lastReviewerSummary || "").trim(),
		}));
	}

	async function appendAutoDrivePromptEvent(current, sessionID = "", prompt = "", state = {}, options = {}, handlers = null) {
		let turnIndex = Number(options.turnIndex || 0) || 1;
		let entry = await reviewer._appendSessionEvent(current.context, sessionID, "autodrive_prompt", {
			role: "user",
			title: `Auto Drive Turn ${turnIndex}/${Number(state.totalTurns || 0) || turnIndex}`,
			content: String(prompt || "").trim(),
			payload: {
				sequence_id: String(state.sequenceID || "").trim(),
				turn_index: turnIndex,
				total_turns: Number(state.totalTurns || 0) || turnIndex,
				reviewer_mode: normalizeAutoDriveReviewerMode(state.reviewerMode || ""),
				reviewer_mode_label: autoDriveReviewerModeLabel(state.reviewerMode || ""),
				prompt_preview: String(prompt || "").trim().slice(0, 1200),
			},
		});
		await emitAutomationTimelineEntry(handlers, entry);
		return entry;
	}

	function autoDriveReviewerMirrorPayload(sourceEntry = {}, state = {}, options = {}) {
		let sourcePayload = sourceEntry?.payload && typeof sourceEntry.payload == "object" && !Array.isArray(sourceEntry.payload)
			? Object.assign({}, sourceEntry.payload)
			: {};
		return Object.assign({}, sourcePayload, {
			autodrive_reviewer_mirror: true,
			sequence_id: String(state.sequenceID || "").trim(),
			turn_index: Number(options.turnIndex || 0) || 0,
			total_turns: Number(state.totalTurns || 0) || 0,
			reviewer_mode: normalizeAutoDriveReviewerMode(state.reviewerMode || ""),
			source_session_id: String(state.reviewerSessionID || "").trim(),
			source_sequence_no: Number(sourceEntry?.sequence_no || 0) || 0,
			source_event_type: String(sourceEntry?.event_type || "").trim(),
		});
	}

	function autoDriveReviewerMirrorKey(sourceEntry = {}, state = {}) {
		return [
			String(state.reviewerSessionID || "").trim(),
			Number(sourceEntry?.sequence_no || 0) || 0,
			String(sourceEntry?.event_type || "").trim(),
			String(sourceEntry?.role || "").trim(),
		].join("|");
	}

	async function mirrorAutoDriveReviewerEntry(current, mainSessionID = "", sourceEntry = {}, state = {}, options = {}, handlers = null) {
		if (!sourceEntry || typeof sourceEntry != "object") {
			return null;
		}
		let mirrorKey = autoDriveReviewerMirrorKey(sourceEntry, state);
		if (!state.mirroredReviewerEntryKeys || !(state.mirroredReviewerEntryKeys instanceof Set)) {
			state.mirroredReviewerEntryKeys = new Set();
		}
		if (mirrorKey && state.mirroredReviewerEntryKeys.has(mirrorKey)) {
			return null;
		}
		let entry = await reviewer._appendSessionRecord(current.context, mainSessionID, {
			event_type: String(sourceEntry?.event_type || "message").trim() || "message",
			role: String(sourceEntry?.role || "system").trim() || "system",
			title: String(sourceEntry?.title || "").trim(),
			content: String(sourceEntry?.content || ""),
			payload: autoDriveReviewerMirrorPayload(sourceEntry, state, options),
			context_excluded: true,
		});
		if (mirrorKey) {
			state.mirroredReviewerEntryKeys.add(mirrorKey);
		}
		await emitAutomationTimelineEntry(handlers, entry);
		return entry;
	}

	async function mirrorAutoDriveReviewerEntries(current, mainSessionID = "", sourceEntries = [], state = {}, options = {}, handlers = null) {
		for (let entry of Array.isArray(sourceEntries) ? sourceEntries : []) {
			await mirrorAutoDriveReviewerEntry(current, mainSessionID, entry, state, options, handlers);
		}
	}

	async function runAutoDriveReviewer(current, run, state = {}, options = {}, handlers = null) {
		let baseHandlers = automationProgressHandlers(handlers);
		let reviewerPrompt = await buildAutoDriveReviewerPrompt(current, state, options || {});
		let beforeTimeline = await reviewer._loadSessionTimeline(current.context, state.reviewerSessionID).catch(() => []);
		let beforeSequence = Math.max(0, ...beforeTimeline.map((entry) => Number(entry?.sequence_no || 0) || 0));
		run.autodrive.statusMessage = "Reviewer is checking Auto Drive progress.";
		let reply = "";
		let progressHandlers = {
			onEvent: async (event = {}) => {
				if (String(event?.type || "").trim() == "timeline.entry" && event?.entry && typeof event.entry == "object") {
					await mirrorAutoDriveReviewerEntry(current, state.mainSessionID, event.entry, state, options, handlers);
				}
				await baseHandlers?.onEvent?.(event);
			},
		};
		try {
			reply = await executeAutomationMessage(current, state.reviewerSessionID, reviewerPrompt, {
				origin: "autodrive_reviewer",
				title: `Auto Drive Reviewer Turn ${Number(options.turnIndex || 0) || 0}`,
				autodrive_reviewer: {
					sequence_id: String(state.sequenceID || "").trim(),
					main_session_id: String(state.mainSessionID || "").trim(),
					turn_index: Number(options.turnIndex || 0) || 0,
					total_turns: Number(state.totalTurns || 0) || 0,
				},
			}, progressHandlers, {
				origin: "autodrive_reviewer",
				abortSignal: run?.abortController?.signal || null,
			});
		}
		finally {
			let afterTimeline = await reviewer._loadSessionTimeline(current.context, state.reviewerSessionID).catch(() => []);
			let newEntries = afterTimeline.filter((entry) => (Number(entry?.sequence_no || 0) || 0) > beforeSequence);
			await mirrorAutoDriveReviewerEntries(current, state.mainSessionID, newEntries, state, options, handlers);
			await reviewer._activateSessionContext(current, state.mainSessionID).catch(() => null);
		}
		let parsed = parseAutoDriveReviewerReply(reply);
		state.lastReviewerSummary = parsed.summary || "";
		state.nextReviewerInstruction = parsed.next_prompt || parsed.summary || "";
		return parsed;
	}

	async function resolveAutoDriveBasePrompt(current, sessionID = "", payload = {}) {
		let suppliedPrompt = String(payload?.prompt || payload?.message || "").trim();
		let values = await autoDrivePromptValues(current, sessionID);
		let projectType = autoDriveProjectType(current);
		if (projectType == "systematic_review") {
			let prompt = suppliedPrompt || renderAutoDriveTemplate(
				await readAutoDrivePromptAsset(AUTODRIVE_SYSTEMATIC_PROMPT_PATH),
				values
			);
			return renderAutoDriveTemplate(prompt, values);
		}
		if (!suppliedPrompt) {
			throw new Error("Custom analysis Auto Drive needs a prompt.");
		}
		let wrapper = await readAutoDrivePromptAsset(AUTODRIVE_CUSTOM_WRAPPER_PATH);
		return renderAutoDriveTemplate(wrapper, Object.assign({}, values, {
			user_prompt: suppliedPrompt,
		}));
	}

	async function resolveAutoDriveReviewerPrompt(current, sessionID = "", payload = {}) {
		let suppliedPrompt = String(payload?.reviewer_prompt || payload?.reviewerPrompt || "").trim();
		let template = suppliedPrompt || await readAutoDrivePromptAsset(AUTODRIVE_REVIEWER_PROMPT_PATH);
		let values = await autoDrivePromptValues(current, sessionID);
		return renderAutoDriveTemplate(template, values);
	}

	async function runAutoDriveSequence(current, sessionID = "", run = null, state = {}, handlers = null) {
		let progressHandlers = automationProgressHandlers(handlers);
		state.mainSessionID = sessionID;
		state.reviewerSessionID = await ensureAutoDriveReviewerSession(current, sessionID);
		run.autodrive.reviewerSessionID = state.reviewerSessionID;
		await reviewer._activateSessionContext(current, sessionID);
		for (let turnIndex = 1; turnIndex <= state.totalTurns; turnIndex += 1) {
			if (run?.abortController?.signal?.aborted || run?.canceled) {
				throw automationAbortError(run?.cancelReason || "Auto Drive stopped.");
			}
			run.autodrive.statusMessage = `Auto Drive turn ${turnIndex}/${state.totalTurns}.`;
			run.autodrive.completedTurns = turnIndex - 1;
			run.autodrive.remainingTurns = Math.max(0, state.totalTurns - (turnIndex - 1));
			let prompt = buildAutoDriveMainPrompt(state, { turnIndex });
			let reply = await executeAutomationMessage(current, sessionID, prompt, {
				origin: "autodrive",
				title: `Auto Drive Turn ${turnIndex}/${state.totalTurns}`,
				autodrive: {
					sequence_id: String(state.sequenceID || "").trim(),
					turn_index: turnIndex,
					total_turns: Number(state.totalTurns || 0) || turnIndex,
					reviewer_mode: normalizeAutoDriveReviewerMode(state.reviewerMode || ""),
					reviewer_mode_label: autoDriveReviewerModeLabel(state.reviewerMode || ""),
				},
			}, progressHandlers, {
				origin: "autodrive",
				emitProgress: false,
				abortSignal: run?.abortController?.signal || null,
			});
			run.autodrive.completedTurns = turnIndex;
			run.autodrive.remainingTurns = Math.max(0, state.totalTurns - turnIndex);
			let mainParsed = parseAutoDriveMainReply(reply);
			state.previousMainContinueNote = mainParsed.continue_note || "";
			let remaining = Math.max(0, state.totalTurns - turnIndex);
			let reviewerMode = normalizeAutoDriveReviewerMode(state.reviewerMode);
			let shouldReview = reviewerMode == "every_turn"
				|| (reviewerMode == "done_blocked" && mainParsed.review_requested)
				|| (reviewerMode == "final_turn" && remaining == 0);
			if (shouldReview) {
				let reviewerResult = await runAutoDriveReviewer(current, run, state, {
					turnIndex,
					mainReply: reply,
					mainReviewReason: mainParsed.review_reason || "",
				}, handlers);
				if (reviewerResult.decision == "stop") {
					run.autodrive.statusMessage = "Auto Drive stopped after reviewer approval.";
					return;
				}
				if (remaining <= 0) {
					run.autodrive.statusMessage = "Auto Drive reached the selected turn limit; reviewer says work remains.";
					return;
				}
				continue;
			}
			state.nextReviewerInstruction = "";
			if (remaining <= 0) {
				run.autodrive.statusMessage = "Auto Drive reached the selected turn limit.";
				return;
			}
		}
	}

	async function automationBeginAutoDriveRun(current, payload = {}) {
		cleanupAutomationChatRuns();
		for (let run of automationChatRuns.values()) {
			if (run?.projectID == current?.context?.projectID && run?.status == "running") {
				throw new Error("A collection session run is already in progress.");
			}
		}
		let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
			|| await reviewer._ensureActiveSession(current.context);
		await reviewer._activateSessionContext(current, sessionID);
		current.sessionID = sessionID;
		await reviewer._ensureSessionWelcome(current, sessionID);
		let basePrompt = await resolveAutoDriveBasePrompt(current, sessionID, payload || {});
		if (!basePrompt) {
			throw new Error("Auto Drive prompt is required.");
		}
		let existingTimeline = await reviewer._loadSessionTimeline(current.context, sessionID);
		let runID = `automation-autodrive-${Date.now()}-${++automationChatRunCounter}`;
		let sequenceID = `autodrive-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		let run = createAutomationChatRun(
			current,
			sessionID,
			runID,
			Number(existingTimeline[existingTimeline.length - 1]?.sequence_no || existingTimeline.length || 0) || 0
		);
		run.kind = "autodrive";
		run.autodrive = {
			sequenceID,
			totalTurns: normalizeAutoDriveCount(payload?.count || payload?.turns || payload?.max_turns || payload?.maxTurns),
			completedTurns: 0,
			remainingTurns: normalizeAutoDriveCount(payload?.count || payload?.turns || payload?.max_turns || payload?.maxTurns),
			reviewerMode: normalizeAutoDriveReviewerMode(payload?.reviewer_mode || payload?.reviewerMode),
			reviewerSessionID: "",
			statusMessage: "Auto Drive starting.",
		};
		let state = {
			sequenceID,
			mainSessionID: sessionID,
			reviewerSessionID: "",
			totalTurns: run.autodrive.totalTurns,
			reviewerMode: run.autodrive.reviewerMode,
			basePrompt,
			reviewerPrompt: await resolveAutoDriveReviewerPrompt(current, sessionID, payload || {}),
			lastReviewerSummary: "",
			nextReviewerInstruction: "",
			previousMainContinueNote: "",
			mirroredReviewerEntryKeys: new Set(),
		};
		run.promise = (async () => {
			try {
				await runAutoDriveSequence(current, sessionID, run, state, null);
				if (String(run?.status || "").trim() == "running") {
					run.status = "complete";
					run.finishedAt = new Date().toISOString();
					run.error = "";
				}
			}
			catch (error) {
				if (isAutomationAbortError(error) || run?.canceled || run?.abortController?.signal?.aborted) {
					run.status = "canceled";
					run.error = run.cancelReason || error?.message || "Auto Drive stopped.";
					run.finishedAt = run.finishedAt || new Date().toISOString();
					return;
				}
				await appendAutomationErrorEntries(current, sessionID, error, null);
				run.status = "error";
				run.error = error?.message || String(error);
				run.finishedAt = new Date().toISOString();
			}
			finally {
				await reviewer._activateSessionContext(current, sessionID).catch(() => null);
			}
		})();
		automationChatRuns.set(runID, run);
		return Object.assign({
			ok: true,
			run_id: runID,
		}, await automationChatState(current, sessionID, run, {
			historyLimit: payload?.history_limit || payload?.historyLimit,
		}));
	}

	function bindAutomationWorkspaceRenderCache(controller) {
		let entry = automationWorkspaceRenderCacheEntry(controller);
		if (!entry) {
			return null;
		}
		controller.renderCacheNamespace = entry.namespace;
		controller.citationHTMLCache = entry.citationHTMLCache;
		controller.bibliographyHTMLCache = entry.bibliographyHTMLCache;
		controller.citationPreviewEngine = entry.citationPreviewEngine;
		controller.bibliographyPreviewEngine = entry.bibliographyPreviewEngine;
		controller.citationTextEngine = entry.citationTextEngine;
		controller.bibliographyTextEngine = entry.bibliographyTextEngine;
		return entry;
	}

	function syncAutomationWorkspaceRenderCache(controller, entry = null) {
		let target = entry || automationWorkspaceRenderCacheEntry(controller);
		if (!target) {
			return;
		}
		target.namespace = controller.renderCacheNamespace || target.namespace;
		target.citationHTMLCache = controller.citationHTMLCache || target.citationHTMLCache;
		target.bibliographyHTMLCache = controller.bibliographyHTMLCache || target.bibliographyHTMLCache;
		target.citationPreviewEngine = controller.citationPreviewEngine || null;
		target.bibliographyPreviewEngine = controller.bibliographyPreviewEngine || null;
		target.citationTextEngine = controller.citationTextEngine || null;
		target.bibliographyTextEngine = controller.bibliographyTextEngine || null;
		automationWorkspaceRenderCache.set(target.namespace, target);
	}

	function automationRenderController(current, editorSettings = null, doc = null, mode = "preview") {
		let currentEditorSettings = reviewer._normalizeEditorSettings(editorSettings || current?.settings?.editor || {});
		let renderDoc = doc || reviewer?._primaryWindow?.()?.document || null;
		if (!renderDoc) {
			throw new Error("No Zotero window is available.");
		}
		let preview = renderDoc.createElement("div");
		let nativeEditor = renderDoc.createElement("div");
		let rawEditor = renderDoc.createElement("textarea");
		let controller = {
			doc: renderDoc,
			documentPath: current?.context?.reportPath || "",
			projectRef: reviewer._projectReferenceData(current, {
				sessionID: current?.sessionID || "default",
			}),
			mode: ["preview", "native", "raw"].includes(mode) ? mode : "preview",
			documentDirty: false,
			nativeDirty: false,
			previewStale: false,
			nativeBlocks: [],
			bootstrap: {
				current_project: {
					entry: {
						project_id: current?.context?.projectID || "",
						project_type: current?.projectType || "systematic_review",
					},
					zotero: {
						library_id: current?.context?.libraryID || 0,
						collection_key: current?.context?.collectionKey || "",
						collection_name: current?.context?.collectionName || "",
						project_item_key: current?.projectItem?.key || "",
					},
					settings: {
						editor: currentEditorSettings,
					},
				},
			},
			renderCacheNamespace: "",
			citationHTMLCache: new Map(),
			bibliographyHTMLCache: new Map(),
			citationPreviewEngine: null,
			bibliographyPreviewEngine: null,
			citationTextEngine: null,
			bibliographyTextEngine: null,
			prismaHTML: "",
			prismaExportHTML: "",
			els: {
				preview,
				nativeEditor,
				rawEditor,
				modePreviewBtn: { classList: automationStubClassList() },
				modeNativeBtn: { classList: automationStubClassList() },
				modeRawBtn: { classList: automationStubClassList() },
				editorToolbar: { toggleAttribute: automationNoopToggle },
				rawToolbar: { toggleAttribute: automationNoopToggle },
				editorSettings: { toggleAttribute: automationNoopToggle },
			},
		};
		bindAutomationWorkspaceRenderCache(controller);
		return controller;
	}

	function automationPrismaPlaceholderPresent(markdown = "") {
		return String(markdown || "").includes(SystematicReviewerNativeMarkdown.PRISMA_PLACEHOLDER_MARKDOWN);
	}

	function automationPrismaFallbackHTML(message = "PRISMA diagram is not available.") {
		return `<div class="sr-prisma-empty" data-sr-prisma="true">${reviewer._escapeHTML(String(message || "PRISMA diagram is not available."))}</div>`;
	}

	function automationPrismaPageContext(markdown = "") {
		try {
			let pages = SystematicReviewerNativeMarkdown.paginateBlocks(
				SystematicReviewerNativeMarkdown.parseMarkdown(markdown || "")
			);
			for (let page of pages || []) {
				let blocks = Array.isArray(page?.blocks) ? page.blocks : [];
				let prismaIndex = blocks.findIndex((block) => block?.type == "prisma");
				if (prismaIndex >= 0) {
					return {
						layout: String(page?.layout || "portrait").toLowerCase() == "landscape" ? "landscape" : "portrait",
						before: blocks.slice(0, prismaIndex),
						after: blocks.slice(prismaIndex + 1),
					};
				}
			}
		}
		catch (_error) {}
		return {
			layout: "portrait",
			before: [],
			after: [],
		};
	}

	function automationPrismaExportFitBox(editorSettings = {}, markdown = "") {
		return SystematicReviewerPrismaRenderer.computeReportFitBox(
			automationPrismaPageContext(markdown),
			{
				marginInches: Number(editorSettings?.printMarginInches || 1) || 1,
			}
		);
	}

	async function automationPrismaRenderPayload(current, doc, markdown = "", editorSettings = {}) {
		if (!automationPrismaPlaceholderPresent(markdown)) {
			return {
				present: false,
				html: "",
				state: null,
				error: "",
			};
		}
		try {
			let prismaState = await SystematicReviewerWorkflowPrisma.render({
				reviewer,
				current,
				payload: { editor_settings: editorSettings },
			});
			let fitBox = automationPrismaExportFitBox(editorSettings, markdown);
			let html = SystematicReviewerPrismaRenderer.renderFigureHTML(prismaState.diagram, prismaState, {
				doc,
				figureClass: "sr-prisma-figure",
				fitBox,
			});
			return {
				present: true,
				html,
				state: prismaState,
				error: "",
			};
		}
		catch (error) {
			return {
				present: true,
				html: automationPrismaFallbackHTML(error?.message || String(error)),
				state: null,
				error: error?.message || String(error),
			};
		}
	}

	async function automationPrismaExportHTML(current, win, markdown = "", editorSettings = {}) {
		if (!automationPrismaPlaceholderPresent(markdown)) {
			return "";
		}
		if (!win?.document) {
			throw new Error("No Zotero window is available for PRISMA export.");
		}
		try {
			let prismaState = await SystematicReviewerWorkflowPrisma.render({
				reviewer,
				current,
				payload: { editor_settings: editorSettings },
			});
			if (!prismaState?.diagram) {
				throw new Error("PRISMA diagram data is not available.");
			}
			let fitBox = automationPrismaExportFitBox(editorSettings, markdown);
			return SystematicReviewerPrismaRenderer.renderFigureHTML(prismaState.diagram, prismaState, {
				doc: win.document,
				figureClass: "sr-prisma-figure",
				fitBox,
			});
		}
		catch (error) {
			throw new Error(`PRISMA export failed: ${error?.message || String(error)}`);
		}
	}

	async function automationRenderedState(current, payload = {}) {
		let win = reviewer._primaryWindow?.();
		if (!win?.document) {
			throw new Error("No Zotero window is available.");
		}
		let settings = await automationProjectSettings(current);
		let editorSettings = automationEditorSettings(settings, payload || {});
		let markdown = await automationMarkdown(current, payload || {});
		let surface = String(payload?.surface || payload?.mode || "preview").trim().toLowerCase();
		if (surface == "continuous") {
			surface = "preview";
		}
		if (!["preview", "native", "both"].includes(surface)) {
			surface = "preview";
		}
		let previewController = automationRenderController(current, editorSettings, win.document, "preview");
		let prismaRender = await automationPrismaRenderPayload(current, win.document, markdown, editorSettings);
		previewController.prismaHTML = prismaRender.html || "";
		let previewCacheEntry = automationWorkspaceRenderCacheEntry(previewController);
		let includeLabels = !!(payload?.include_citation_labels || payload?.includeCitationLabels || payload?.include_labels || payload?.includeLabels);
		let labelsByKey = null;
		if (includeLabels) {
			let catalog = await automationCitationCatalog(current);
			labelsByKey = new Map(catalog.map((entry) => [String(entry.item_key || ""), entry]));
		}
		let seen = new Set();
		let citations = [];
		for (let citation of SystematicReviewerNativeMarkdown.extractCitations(markdown || "")) {
			let token = String(SystematicReviewerNativeMarkdown.makeCitationMarkdown(citation) || citation.markdown || "").trim();
			if (!token || seen.has(token)) {
				continue;
			}
			seen.add(token);
			let entry = {
				token,
				keys: Array.isArray(citation.keys) ? citation.keys.slice() : [],
				html: reviewer._formatCitationHTML(previewController, citation, token),
				text: reviewer._formatCitationText(previewController, citation, token),
			};
			if (labelsByKey) {
				entry.labels = (citation.keys || []).map((key) => labelsByKey.get(String(key || "")) || {
					item_key: String(key || ""),
					authors: "",
					year: "",
					title: "",
					publication_title: "",
				});
			}
			citations.push(entry);
		}
		syncAutomationWorkspaceRenderCache(previewController, previewCacheEntry);
		let previewHTML = "";
		let nativeHTML = "";
		if (surface == "preview" || surface == "both") {
			reviewer._renderWorkspace(previewController, {
				path: current?.context?.reportPath || "",
				markdown,
			});
			syncAutomationWorkspaceRenderCache(previewController, previewCacheEntry);
			previewHTML = String(previewController.els.preview.innerHTML || "");
		}
		if (surface == "native" || surface == "both") {
			let nativeController = automationRenderController(current, editorSettings, win.document, "native");
			nativeController.prismaHTML = prismaRender.html || "";
			let nativeCacheEntry = automationWorkspaceRenderCacheEntry(nativeController);
			reviewer._renderWorkspace(nativeController, {
				path: current?.context?.reportPath || "",
				markdown,
			});
			syncAutomationWorkspaceRenderCache(nativeController, nativeCacheEntry);
			nativeHTML = String(nativeController.els.nativeEditor.innerHTML || "");
		}
		syncAutomationWorkspaceRenderCache(previewController, previewCacheEntry);
		return {
			ok: true,
			surface,
			markdown,
			report_hash: reviewer._simpleContentHash(markdown),
			settings: editorSettings,
			base_url: automationDocumentBaseURL(current),
			citations,
			bibliography_html: reviewer._renderBibliographyHTML(previewController, markdown),
			bibliography_text: reviewer._renderBibliographyText(previewController, markdown),
			prisma_html: prismaRender.html || "",
			preview_html: previewHTML,
			native_html: nativeHTML,
		};
	}

	async function automationMarkdown(current, payload = {}) {
		if (Object.prototype.hasOwnProperty.call(payload, "markdown")) {
			return String(payload.markdown || "");
		}
		if (!(await reviewer._pathExists(current.context.reportPath))) {
			return "";
		}
		return await reviewer._readFileText(current.context.reportPath);
	}

	function automationSaveReason(payload = {}) {
		let clean = String(payload?.save_reason || payload?.saveReason || "").trim().toLowerCase();
		if (["manual-save", "mode-switch-save", "chat-send-save"].includes(clean)) {
			return clean;
		}
		return "manual-save";
	}

	async function automationPersistMarkdown(current, markdown = "", editorSettings = {}, payload = {}) {
		let settings = await automationProjectSettings(current);
		let nextSettings = Object.assign({}, settings, { editor: editorSettings });
		await reviewer._writeJSONFile(current.context.settingsPath, nextSettings);
		await reviewer._writeTextFile(current.context.reportPath, markdown);
		let saveReason = automationSaveReason(payload || {});
		let snapshotPath = await reviewer._writeReportSnapshot(current.context, markdown, saveReason);
		return {
			settings: editorSettings,
			save_reason: saveReason,
			snapshot_path: snapshotPath,
			report_hash: reviewer._simpleContentHash(markdown),
		};
	}

	function automationRollbackSnapshotID(payload = {}) {
		return automationOptionalString(payload?.snapshot_id || payload?.snapshotID || "");
	}

	function automationRollbackListLimit(payload = {}) {
		let parsed = Number(payload?.limit || payload?.max || 50);
		if (!Number.isInteger(parsed) || parsed < 1) {
			return 50;
		}
		return Math.min(parsed, 200);
	}

	function automationRollbackTokenize(text = "") {
		return String(text || "").match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];
	}

	function automationRollbackMergeSegments(segments = []) {
		let merged = [];
		for (let segment of Array.isArray(segments) ? segments : []) {
			let text = String(segment?.text || "");
			if (!text) {
				continue;
			}
			let kind = String(segment?.kind || "equal").trim() || "equal";
			let last = merged[merged.length - 1] || null;
			if (last?.kind == kind) {
				last.text += text;
			}
			else {
				merged.push({
					kind,
					text,
				});
			}
		}
		return merged;
	}

	function automationRollbackTextSegments(text = "", kind = "equal") {
		let value = String(text || "");
		return value
			? [{
				kind: String(kind || "equal").trim() || "equal",
				text: value,
			}]
			: [];
	}

	function automationRollbackSequenceDiff(left = [], right = []) {
		let previous = Array.isArray(left) ? left : [];
		let next = Array.isArray(right) ? right : [];
		let max = previous.length + next.length;
		let trace = [];
		let v = new Map();
		v.set(1, 0);
		let vectorValue = (map, key, fallback = 0) => {
			let value = map.get(key);
			return typeof value == "number" ? value : fallback;
		};
		for (let d = 0; d <= max; d += 1) {
			trace.push(new Map(v));
			for (let k = -d; k <= d; k += 2) {
				let x = 0;
				if (k == -d || (k != d && vectorValue(v, k - 1, Number.NEGATIVE_INFINITY) < vectorValue(v, k + 1, Number.NEGATIVE_INFINITY))) {
					x = vectorValue(v, k + 1, 0);
				}
				else {
					x = vectorValue(v, k - 1, 0) + 1;
				}
				let y = x - k;
				while (x < previous.length && y < next.length && previous[x] === next[y]) {
					x += 1;
					y += 1;
				}
				v.set(k, x);
				if (x >= previous.length && y >= next.length) {
					let operations = [];
					let currentX = previous.length;
					let currentY = next.length;
					for (let depth = trace.length - 1; depth >= 0; depth -= 1) {
						let history = trace[depth];
						let currentK = currentX - currentY;
						if (depth === 0) {
							while (currentX > 0 && currentY > 0) {
								operations.push({
									type: "equal",
									left_index: currentX - 1,
									right_index: currentY - 1,
								});
								currentX -= 1;
								currentY -= 1;
							}
							while (currentX > 0) {
								operations.push({
									type: "delete",
									left_index: currentX - 1,
								});
								currentX -= 1;
							}
							while (currentY > 0) {
								operations.push({
									type: "insert",
									right_index: currentY - 1,
								});
								currentY -= 1;
							}
							break;
						}
						let prevK = 0;
						if (currentK == -depth || (currentK != depth && vectorValue(history, currentK - 1, Number.NEGATIVE_INFINITY) < vectorValue(history, currentK + 1, Number.NEGATIVE_INFINITY))) {
							prevK = currentK + 1;
						}
						else {
							prevK = currentK - 1;
						}
						let prevX = vectorValue(history, prevK, 0);
						let prevY = prevX - prevK;
						while (currentX > prevX && currentY > prevY) {
							operations.push({
								type: "equal",
								left_index: currentX - 1,
								right_index: currentY - 1,
							});
							currentX -= 1;
							currentY -= 1;
						}
						if (currentX == prevX) {
							operations.push({
								type: "insert",
								right_index: currentY - 1,
							});
							currentY -= 1;
						}
						else {
							operations.push({
								type: "delete",
								left_index: currentX - 1,
							});
							currentX -= 1;
						}
					}
					return operations.reverse();
				}
			}
		}
		return [];
	}

	function automationRollbackInlineSegments(leftText = "", rightText = "") {
		let leftTokens = automationRollbackTokenize(leftText);
		let rightTokens = automationRollbackTokenize(rightText);
		let operations = automationRollbackSequenceDiff(leftTokens, rightTokens);
		let leftSegments = [];
		let rightSegments = [];
		for (let operation of operations) {
			if (operation.type == "equal") {
				let token = String(leftTokens[operation.left_index] || rightTokens[operation.right_index] || "");
				if (token) {
					leftSegments.push({ kind: "equal", text: token });
					rightSegments.push({ kind: "equal", text: token });
				}
			}
			else if (operation.type == "delete") {
				leftSegments.push({ kind: "removed", text: String(leftTokens[operation.left_index] || "") });
			}
			else if (operation.type == "insert") {
				rightSegments.push({ kind: "added", text: String(rightTokens[operation.right_index] || "") });
			}
		}
		return {
			left_segments: automationRollbackMergeSegments(leftSegments),
			right_segments: automationRollbackMergeSegments(rightSegments),
		};
	}

	function automationRollbackLines(text = "") {
		let normalized = String(text || "").replace(/\r\n?/g, "\n");
		if (!normalized) {
			return [];
		}
		if (normalized.endsWith("\n")) {
			normalized = normalized.slice(0, -1);
		}
		return normalized ? normalized.split("\n") : [];
	}

	function automationRollbackSideCell(lineNumber = null, text = "", segments = []) {
		return {
			line_number: Number.isInteger(lineNumber) ? lineNumber : null,
			text: String(text || ""),
			segments: automationRollbackMergeSegments(segments),
		};
	}

	function automationRollbackUnifiedDiff(snapshot = {}, current = {}, operations = [], snapshotLines = [], currentLines = []) {
		let snapshotLabel = automationOptionalString(snapshot?.snapshot_id || snapshot?.name || "snapshot");
		let currentLabel = automationOptionalString(current?.name || reviewer?._basename?.(current?.path || "") || "REPORT.md");
		let lines = [
			`--- ${snapshotLabel}`,
			`+++ ${currentLabel}`,
			`@@ -1,${snapshotLines.length} +1,${currentLines.length} @@`,
		];
		for (let operation of Array.isArray(operations) ? operations : []) {
			if (operation.type == "equal") {
				lines.push(` ${String(snapshotLines[operation.left_index] || "")}`);
			}
			else if (operation.type == "delete") {
				lines.push(`-${String(snapshotLines[operation.left_index] || "")}`);
			}
			else if (operation.type == "insert") {
				lines.push(`+${String(currentLines[operation.right_index] || "")}`);
			}
		}
		return `${lines.join("\n")}\n`;
	}

	async function automationCurrentReportMetadata(current, markdown = null) {
		let text = markdown === null || markdown === undefined
			? await reviewer._readReportMarkdown(current.context)
			: String(markdown || "");
		let modifiedAt = "";
		try {
			let file = reviewer._nsIFile(current.context.reportPath);
			if (file.exists()) {
				modifiedAt = new Date(file.lastModifiedTime).toISOString();
			}
		}
		catch (_error) {}
		return {
			snapshot_id: "current",
			name: reviewer._basename(current.context.reportPath),
			path: current.context.reportPath,
			reason: "current",
			created_at: modifiedAt,
			modified_at: modifiedAt,
			content_hash: reviewer._simpleContentHash(text),
			line_count: reviewer._countTextLines(text),
		};
	}

	async function automationRollbackSnapshots(current, payload = {}) {
		let snapshots = await reviewer._listReportSnapshots(current.context, {
			limit: automationRollbackListLimit(payload),
		});
		if (payload?.include_current_matches === true || payload?.includeCurrentMatches === true) {
			return snapshots;
		}
		let currentMarkdown = await reviewer._readReportMarkdown(current.context);
		let currentHash = reviewer._simpleContentHash(currentMarkdown);
		return snapshots.filter((entry) => String(entry?.content_hash || "") != currentHash);
	}

	async function automationRollbackDiff(current, payload = {}) {
		let snapshotID = automationRollbackSnapshotID(payload);
		if (!snapshotID) {
			throw new Error("snapshot_id is required.");
		}
		let snapshot = await reviewer._resolveReportSnapshot(current.context, snapshotID, {
			include_content: true,
		});
		if (!snapshot) {
			throw new Error(`Rollback snapshot not found: ${snapshotID}`);
		}
		let currentMarkdown = await reviewer._readReportMarkdown(current.context);
		let currentMeta = await automationCurrentReportMetadata(current, currentMarkdown);
		let snapshotLines = automationRollbackLines(snapshot.content || "");
		let currentLines = automationRollbackLines(currentMarkdown);
		let operations = automationRollbackSequenceDiff(snapshotLines, currentLines);
		let rows = [];
		let removedLines = 0;
		let addedLines = 0;
		let changedLines = 0;
		let leftLine = 1;
		let rightLine = 1;
		for (let index = 0; index < operations.length; index += 1) {
			let operation = operations[index];
			if (operation.type == "equal") {
				let text = String(snapshotLines[operation.left_index] || "");
				rows.push({
					type: "equal",
					left: automationRollbackSideCell(leftLine, text, automationRollbackTextSegments(text, "equal")),
					right: automationRollbackSideCell(rightLine, text, automationRollbackTextSegments(text, "equal")),
				});
				leftLine += 1;
				rightLine += 1;
				continue;
			}
			let deleted = [];
			let inserted = [];
			while (index < operations.length && operations[index].type != "equal") {
				let pending = operations[index];
				if (pending.type == "delete") {
					deleted.push(String(snapshotLines[pending.left_index] || ""));
				}
				else if (pending.type == "insert") {
					inserted.push(String(currentLines[pending.right_index] || ""));
				}
				index += 1;
			}
			index -= 1;
			let pairCount = Math.max(deleted.length, inserted.length);
			for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
				let leftText = pairIndex < deleted.length ? deleted[pairIndex] : null;
				let rightText = pairIndex < inserted.length ? inserted[pairIndex] : null;
				if (leftText !== null && rightText !== null) {
					let inline = automationRollbackInlineSegments(leftText, rightText);
					rows.push({
						type: "changed",
						left: automationRollbackSideCell(leftLine, leftText, inline.left_segments),
						right: automationRollbackSideCell(rightLine, rightText, inline.right_segments),
					});
					changedLines += 1;
					leftLine += 1;
					rightLine += 1;
					continue;
				}
				if (leftText !== null) {
					rows.push({
						type: "removed",
						left: automationRollbackSideCell(leftLine, leftText, automationRollbackTextSegments(leftText, "removed")),
						right: automationRollbackSideCell(null, "", []),
					});
					removedLines += 1;
					leftLine += 1;
					continue;
				}
				rows.push({
					type: "added",
					left: automationRollbackSideCell(null, "", []),
					right: automationRollbackSideCell(rightLine, rightText || "", automationRollbackTextSegments(rightText || "", "added")),
				});
				addedLines += 1;
				rightLine += 1;
			}
		}
		let snapshotMeta = Object.assign({}, snapshot);
		delete snapshotMeta.content;
		return {
			ok: true,
			current: currentMeta,
			snapshot: snapshotMeta,
			summary: {
				added_lines: addedLines,
				removed_lines: removedLines,
				changed_lines: changedLines,
				total_rows: rows.length,
				snapshot_line_count: snapshotLines.length,
				current_line_count: currentLines.length,
			},
			rows,
			unified_diff: automationRollbackUnifiedDiff(snapshotMeta, currentMeta, operations, snapshotLines, currentLines),
		};
	}

	async function automationRollbackRestore(current, payload = {}) {
		let snapshotID = automationRollbackSnapshotID(payload);
		if (!snapshotID) {
			throw new Error("snapshot_id is required.");
		}
		let snapshot = await reviewer._resolveReportSnapshot(current.context, snapshotID, {
			include_content: true,
		});
		if (!snapshot) {
			throw new Error(`Rollback snapshot not found: ${snapshotID}`);
		}
		let currentMarkdown = await reviewer._readReportMarkdown(current.context);
		let currentHash = reviewer._simpleContentHash(currentMarkdown);
		let backupSnapshot = null;
		let latestSnapshot = (await reviewer._listReportSnapshots(current.context, { limit: 1 }))[0] || null;
		if (latestSnapshot && String(latestSnapshot.content_hash || "") == currentHash) {
			backupSnapshot = latestSnapshot;
		}
		else {
			let backupPath = await reviewer._writeReportSnapshot(current.context, currentMarkdown, "restore-backup");
			backupSnapshot = await reviewer._resolveReportSnapshot(
				current.context,
				reviewer._basename(backupPath)
			);
		}
		await reviewer._writeTextFile(current.context.reportPath, String(snapshot.content || ""));
		let restoredMeta = Object.assign({}, snapshot);
		delete restoredMeta.content;
		return {
			ok: true,
			path: current.context.reportPath,
			markdown: String(snapshot.content || ""),
			report_hash: reviewer._simpleContentHash(snapshot.content || ""),
			snapshot: restoredMeta,
			backup_snapshot: backupSnapshot || null,
		};
	}

	function normalizedProjectType(current) {
		return reviewer?._normalizeProjectType
			? reviewer._normalizeProjectType(current?.projectType || "")
			: String(current?.projectType || "").trim();
	}

	function isSystematicReviewProject(current) {
		return normalizedProjectType(current) == "systematic_review";
	}

	function normalizeHarvestPostImportAction(value = "", embeddingsReady = false) {
		let raw = String(value || "").trim().toLowerCase();
		let allowed = new Set([
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

	function workflowArtifactFileEntries(dirPath = "") {
		if (!dirPath) {
			return [];
		}
		let dir = reviewer._nsIFile(dirPath);
		if (!dir.exists() || !dir.isDirectory()) {
			return [];
		}
		let out = [];
		let entries = dir.directoryEntries;
		while (entries.hasMoreElements()) {
			let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (!entry?.isFile?.() || entry.leafName.startsWith(".")) {
				continue;
			}
			out.push(entry.path);
		}
		return out.sort();
	}

	async function syncWorkflowCategoryBlock(current, category = "", headingPath = [], marker = "", emptyLabel = "") {
		let dir = await SystematicReviewerWorkflowArtifacts.ensureWorkflowDir(reviewer, current.context, category);
		let blocks = [];
		for (let path of workflowArtifactFileEntries(dir)) {
			if (!/\.md$/i.test(path)) {
				continue;
			}
			let text = String(await reviewer._readFileText(path) || "").trim();
			if (text) {
				blocks.push(text);
			}
		}
		let body = blocks.length
			? blocks.join("\n\n")
			: String(emptyLabel || "No saved workflow artifacts yet.").trim();
		return await SystematicReviewerWorkflowArtifacts.writeLogBlock(reviewer, current.context, {
			headingPath,
			marker,
			body,
		});
	}

	async function syncWorkflowCategoryBlockFromSource(current, sourceCategory = "", headingPath = [], marker = "", emptyLabel = "") {
		let dir = await SystematicReviewerWorkflowArtifacts.ensureWorkflowDir(reviewer, current.context, sourceCategory);
		let blocks = [];
		for (let path of workflowArtifactFileEntries(dir)) {
			if (!/\.md$/i.test(path)) {
				continue;
			}
			let text = String(await reviewer._readFileText(path) || "").trim();
			if (text) {
				blocks.push(text);
			}
		}
		let body = blocks.length
			? blocks.join("\n\n")
			: String(emptyLabel || "No saved workflow artifacts yet.").trim();
		return await SystematicReviewerWorkflowArtifacts.writeLogBlock(reviewer, current.context, {
			headingPath,
			marker,
			body,
		});
	}

	async function syncPrismaWorkflowBlock(current, emptyLabel = "") {
		let dir = await SystematicReviewerWorkflowArtifacts.ensureWorkflowDir(reviewer, current.context, "prisma");
		let blocks = [];
		for (let path of workflowArtifactFileEntries(dir)) {
			if (!/\.md$/i.test(path)) {
				continue;
			}
			let text = String(await reviewer._readFileText(path) || "").trim();
			if (text) {
				blocks.push(text);
			}
		}
		let body = blocks.length
			? blocks.join("\n\n")
			: String(emptyLabel || "No PRISMA summary has been logged yet.").trim();
		return await SystematicReviewerWorkflowArtifacts.writeLogBlock(reviewer, current.context, {
			headingPath: ["PRISMA"],
			marker: "prisma-log",
			body,
		});
	}

		async function recordWorkflowMarkdownArtifact(current, category = "", kind = "", markdown = "") {
			let artifact = await SystematicReviewerWorkflowArtifacts.writeArtifact(reviewer, current.context, {
				category,
			kind,
			extension: "md",
			content: String(markdown || "").trim() + "\n",
		});
			if (category == "harvest") {
				await syncWorkflowCategoryBlock(current, "harvest", ["Harvest"], "harvest-log", "No harvest activity has been logged yet.");
			}
			else if (category == "embeddings") {
				await syncWorkflowCategoryBlock(current, "embeddings", ["Embeddings"], "embedding-log", "No embeddings activity has been logged yet.");
			}
			else if (category == "screening") {
				await syncWorkflowCategoryBlock(current, "screening", ["Screening"], "screening-log", "No screening activity has been logged yet.");
			}
			else if (category == "semantic") {
				await syncWorkflowCategoryBlock(current, "semantic", ["Semantic Search"], "semantic-log", "No semantic-search activity has been logged yet.");
			}
			else if (category == "full-text") {
				await syncWorkflowCategoryBlock(current, "full-text", ["Full-Text"], "full-text-log", "No full-text activity has been logged yet.");
			}
			else if (category == "extraction") {
				await syncWorkflowCategoryBlock(current, "extraction", ["Extraction"], "extraction-log", "No extraction activity has been logged yet.");
			}
			else if (category == "explore") {
				await syncWorkflowCategoryBlock(current, "explore", ["Explore"], "explore-log", "No explore activity has been logged yet.");
			}
			else if (category == "prisma") {
				await syncPrismaWorkflowBlock(current, "No PRISMA summary has been logged yet.");
			}
			return artifact;
		}

	async function recordExploreSynthesisArtifact(current, markdown = "") {
		let artifact = await SystematicReviewerWorkflowArtifacts.writeArtifact(reviewer, current.context, {
			category: "explore-synthesis",
			kind: "explore-synthesis",
			extension: "md",
			content: String(markdown || "").trim() + "\n",
		});
		await syncWorkflowCategoryBlockFromSource(
			current,
			"explore-synthesis",
			["Explore Synthesis"],
			"explore-synthesis",
			"No explore synthesis has been logged yet."
		);
		return artifact;
	}

	async function recordExploreAppendixArtifact(current, markdown = "") {
		let artifact = await SystematicReviewerWorkflowArtifacts.writeArtifact(reviewer, current.context, {
			category: "explore-appendix",
			kind: "explore-output",
			extension: "md",
			content: String(markdown || "").trim() + "\n",
		});
		await syncWorkflowCategoryBlockFromSource(
			current,
			"explore-appendix",
			["Explore Outputs"],
			"explore-outputs",
			"No explore outputs have been saved yet."
		);
		return artifact;
	}

	async function syncExtractionTemplateAppendix(current) {
		let templates = await SystematicReviewerWorkflowExtractionTemplates.listTemplates(reviewer, current.context);
		let ordered = (Array.isArray(templates) ? templates : []).slice().sort((left, right) =>
			String(left.updated_at || "").localeCompare(String(right.updated_at || ""))
			|| String(left.name || "").localeCompare(String(right.name || ""))
		);
		let body = ordered.length
			? ordered.map((entry) => [
				`#### ${String(entry.name || "Template").trim()}`,
				"",
				`Path: \`${String(entry.path || "").trim()}\``,
				"",
				"```yaml",
				String(entry.yaml || "").trim(),
				"```",
			].join("\n")).join("\n\n")
			: "No extraction templates are saved yet.";
		return await SystematicReviewerWorkflowArtifacts.writeLogBlock(reviewer, current.context, {
			headingPath: ["Extraction Templates"],
			marker: "extraction-templates",
			body,
		});
	}

	function markdownHeadingBlock(title = "", lines = []) {
		return [
			`#### ${String(title || "Entry").trim()}`,
			"",
			...(Array.isArray(lines) ? lines : []).map((line) => String(line || "")),
		].join("\n").trim();
	}

	function markdownCode(value = "", fallback = "(not recorded)") {
		let text = String(value || "").trim();
		return text ? `\`${text}\`` : String(fallback || "(not recorded)").trim();
	}

	function compactInlineText(value = "", limit = 240) {
		let text = String(value || "").replace(/\s+/g, " ").trim();
		if (!text) {
			return "";
		}
		if (text.length <= limit) {
			return text;
		}
		return `${text.slice(0, Math.max(1, limit - 1)).trim()}...`;
	}

	function harvestLogLines(result = {}, payload = {}, postImportAction = "") {
		let summary = result?.summary && typeof result.summary == "object"
			? result.summary
			: (result && typeof result == "object" ? result : {});
		let queryMode = String(
			summary?.query_mode
			|| payload?.query_mode
			|| payload?.queryMode
			|| "boolean"
		).trim() || "boolean";
		let searchMode = String(
			summary?.mode
			|| result?.mode
			|| payload?.search_mode
			|| payload?.searchMode
			|| "limited"
		).trim() || "limited";
		let rawFilters = Array.isArray(summary?.filters)
			? summary.filters.map((entry) => String(entry || "").trim()).filter(Boolean)
			: [];
		let effectiveFilters = String(summary?.compiled_filter_query || "").trim();
		let yearRange = [
			Number(summary?.year_from || 0) || null,
			Number(summary?.year_to || 0) || null,
		];
		let yearRangeText = yearRange[0] || yearRange[1]
			? `${yearRange[0] ?? "?"} to ${yearRange[1] ?? "?"}`
			: "";
		let lines = [
			`- Query: ${String(summary?.query || payload?.query || "").trim() || "(not recorded)"}`,
			`- Query mode: ${queryMode}`,
			queryMode == "semantic" ? "" : `- Field: ${String(summary?.field || payload?.field || "title_and_abstract").trim() || "title_and_abstract"}`,
			`- Search mode: ${searchMode}`,
			`- Requested filters: ${rawFilters.length ? rawFilters.map((entry) => markdownCode(entry, entry)).join(", ") : "(none)"}`,
			`- Effective filters: ${effectiveFilters ? markdownCode(effectiveFilters, effectiveFilters) : "(none)"}`,
			String(summary?.language || "").trim() ? `- Language: ${String(summary.language || "").trim()}` : "",
			yearRangeText ? `- Year range: ${yearRangeText}` : "",
			String(summary?.since || "").trim() ? `- From publication date: ${String(summary.since || "").trim()}` : "",
			String(summary?.until || "").trim() ? `- To publication date: ${String(summary.until || "").trim()}` : "",
			`- Max results: ${summary?.max_results !== null && summary?.max_results !== undefined && summary?.max_results !== "" ? Number(summary.max_results || 0) || 0 : (searchMode == "limited" ? "(not recorded)" : "unbounded")}`,
			`- Page size: ${Number(summary?.page_size || 0) || 0 || "(not recorded)"}`,
			String(summary?.pagination_mode || "").trim() ? `- Pagination mode: ${String(summary.pagination_mode || "").trim()}` : "",
			`- Attachment fetch mode: ${String(summary?.attachment_fetch_mode || result?.attachment_fetch_mode || "included_only").trim() || "included_only"}`,
			postImportAction ? `- Post-import action: ${String(postImportAction || "").replace(/_/g, " ").trim()}` : "",
			`- Estimated count: ${Number(summary?.estimated || result?.estimated || 0) || 0}`,
			`- Total fetched: ${Number(summary?.total_fetched || result?.total_fetched || 0) || 0}`,
			`- Processed candidates: ${Number(summary?.processed_candidates || result?.processed_candidates || 0) || 0}`,
			`- Imported count: ${Number(summary?.imported_count || result?.imported_count || 0) || 0}`,
			`- Duplicate count: ${Number(summary?.duplicate_count || result?.duplicate_count || 0) || 0}`,
			`- Skipped without supported identifier: ${Number(summary?.skipped_no_supported_identifier || result?.skipped_no_supported_identifier || 0) || 0}`,
			`- Skipped without abstract: ${Number(summary?.skipped_no_abstract || result?.skipped_no_abstract || 0) || 0}`,
			`- Import errors: ${Number(summary?.import_error_count || result?.import_error_count || 0) || 0}`,
			`- Summary path: ${markdownCode(String(summary?.summary_path || result?.summary_path || "").trim(), "(not recorded)")}`,
			String(summary?.ndjson_path || result?.ndjson_path || "").trim() ? `- NDJSON path: ${markdownCode(String(summary?.ndjson_path || result?.ndjson_path || "").trim())}` : "",
			String(summary?.request_preview || "").trim() ? `- Request preview: ${markdownCode(compactInlineText(summary.request_preview, 260), "(not recorded)")}` : "",
		];
		return lines.filter(Boolean);
	}

	function automationEditorMeta() {
		let styles = [];
		try {
			styles = Zotero.Styles?.getVisible?.() || [];
		}
		catch (_error) {
			styles = [];
		}
		return {
			font_families: reviewer._listSystemFontNames(),
			citation_styles: styles.map((style) => ({
				style_id: String(style?.styleID || "").trim(),
				label: String(style?.title || style?.styleID || "").trim(),
			})).filter((entry) => entry.style_id),
			margins: [0.5, 0.75, 1, 1.25, 1.5],
		};
	}

	async function automationCitationCatalog(current) {
		let cacheKey = automationCitationCatalogCacheKey(current);
		let cached = automationCitationCatalogCache.get(cacheKey);
		if (cached) {
			return cached.map((entry) => Object.assign({}, entry));
		}
		let items = reviewer._projectCitableItems(current.collection, current.projectItem) || [];
		let catalog = items.map((item) => {
			let creators = item.getCreators
				? item.getCreators().map((creator) => creator.lastName || creator.name || "").filter(Boolean).join(", ")
				: "";
			let year = reviewer._extractYear(reviewer._itemField(item, "date")) || reviewer._itemField(item, "date") || "";
			return {
				item_key: String(item.key || ""),
				authors: String(creators || "").trim(),
				year: String(year || "").trim(),
				title: String(reviewer._itemField(item, "title") || "").trim(),
				publication_title: String(reviewer._itemField(item, "publicationTitle") || "").trim(),
			};
		}).filter((entry) => entry.item_key);
		automationCitationCatalogCache.set(cacheKey, catalog);
		return catalog.map((entry) => Object.assign({}, entry));
	}

	async function automationRuntimeOptions(current) {
		let config = await reviewer._conversionConfig();
		return {
			chat_presets: reviewer._listRuntimePresetOptions
				? reviewer._listRuntimePresetOptions("session_chat", config)
				: [],
			extraction_presets: reviewer._listRuntimePresetOptions
				? reviewer._listRuntimePresetOptions("data_extraction", config)
				: [],
			use_agent_model_for_data_extraction: !!config?.runtimePreferences?.use_agent_model_for_data_extraction,
		};
	}

		async function automationBootstrap(current, payload = {}) {
			let settings = await automationProjectSettings(current);
			let globalSettings = await reviewer._globalSettings();
			let reference = reviewer._projectReferenceData(current, {
				sessionID: current?.sessionID || "default",
		});
		let bootstrap = await reviewer._buildWorkspacePayload(reference, {
			includeDocumentHTML: false,
			includeProjectCounts: false,
			includeSessionInspection: false,
			includeSessionPromptProjection: false,
			ensureSessionWelcome: false,
			surface: "automation",
			historyLimit: payload?.history_limit || payload?.historyLimit,
		});
		if (!bootstrap.current_project) {
			bootstrap.current_project = {};
		}
		bootstrap.current_project.settings = settings;
		bootstrap.current_project.log_path = current?.context?.logPath || "";
		if (bootstrap.workspace_document) {
			bootstrap.workspace_document.base_url = automationDocumentBaseURL(current);
			bootstrap.workspace_document.directory_path = reviewer._parentPath(current.context.reportPath);
		}
		bootstrap.editor_meta = automationEditorMeta();
		bootstrap.local_commands = automationLocalCommands();
		bootstrap.stream_base_url = SystematicReviewerWorkflowServer?.getStreamBaseURL?.() || "";
		bootstrap.run = automationChatRunSnapshot(
			activeAutomationChatRun(
				current,
				bootstrap?.current_project?.active_session_id || current?.sessionID || ""
			)
		);
		bootstrap.session_context_deferred = true;
		if (payload?.include_citation_catalog || payload?.includeCitationCatalog) {
			bootstrap.citation_catalog = await automationCitationCatalog(current);
			}
			bootstrap.runtime_options = await automationRuntimeOptions(current);
			bootstrap.theme = reviewer._themeClassForWindow(reviewer._primaryWindow?.()) == "theme-dark" ? "dark" : "light";
			bootstrap.preview_page_theme = reviewer._previewEditorPageTheme(globalSettings);
			if (payload?.include_render_state || payload?.includeRenderState) {
			bootstrap.render_state = await automationRenderedState(current, {
				markdown: bootstrap?.workspace_document?.markdown || "",
				editor_settings: settings?.editor || {},
				surface: String(payload?.surface || payload?.mode || "preview").trim().toLowerCase() || "preview",
			});
		}
		return Object.assign({ ok: true }, bootstrap);
	}

		async function automationLogRead(current) {
			let logPath = automationOptionalString(current?.context?.logPath || "");
			if (!logPath) {
				throw new Error("Project log path is unavailable.");
			}
		if (!(await reviewer._pathExists(logPath))) {
			let seedMarkdown = typeof reviewer._defaultWorkflowLogMarkdown == "function"
				? reviewer._defaultWorkflowLogMarkdown(current?.collection, current?.projectType || "")
				: "# Workflow Log\n\n";
			await reviewer._writeTextFile(logPath, seedMarkdown);
		}
		let markdown = await reviewer._readFileText(logPath);
		return {
			ok: true,
			path: logPath,
			markdown,
			size: markdown.length,
			content_hash: reviewer._simpleContentHash(markdown),
				headings: SystematicReviewerTextFileTools.extractMarkdownHeadings(markdown),
			};
		}

		async function automationMemoryRead(current) {
			let projectRoot = automationOptionalString(current?.context?.projectRoot || "");
			if (!projectRoot) {
				throw new Error("Project root is unavailable.");
			}
			let activePath = typeof reviewer._activeMemoryPath == "function"
				? reviewer._activeMemoryPath(current.context)
				: reviewer._joinPath(projectRoot, "active-memory.txt");
			let memoryPath = typeof reviewer._memoryPath == "function"
				? reviewer._memoryPath(current.context)
				: reviewer._joinPath(projectRoot, "memory.txt");
			if (!(await reviewer._pathExists(activePath))) {
				await reviewer._writeTextFile(activePath, "");
			}
				if (!(await reviewer._pathExists(memoryPath))) {
					await reviewer._writeTextFile(memoryPath, [
						"# Systematic Reviewer Turn Memory",
						"",
						"Append-only chronological turn memory for project inspection and active-memory rebuilds.",
						"",
					].join("\n"));
				}
						let activeMarkdown = reviewer._readActiveMemoryText
							? await reviewer._readActiveMemoryText(current.context)
							: await reviewer._readFileText(activePath);
						let fullMarkdown = await reviewer._readFileText(memoryPath);
						let rebuildStatus = null;
					let filePayload = (path, markdown) => ({
					path,
					markdown,
					size: String(markdown || "").length,
					content_hash: reviewer._simpleContentHash(markdown || ""),
				headings: SystematicReviewerTextFileTools.extractMarkdownHeadings(markdown || ""),
			});
			return {
					ok: true,
					active: filePayload(activePath, activeMarkdown),
					full: filePayload(memoryPath, fullMarkdown),
					active_memory_rebuild: rebuildStatus,
				};
			}

		async function automationSaveMarkdown(current, payload = {}) {
			let markdown = await automationMarkdown(current, payload || {});
			let settings = await automationProjectSettings(current);
		let editorSettings = automationEditorSettings(settings, payload || {});
		let persisted = await automationPersistMarkdown(current, markdown, editorSettings, payload || {});
		let surface = String(payload?.surface || payload?.mode || "").trim().toLowerCase();
		if (surface == "continuous") {
			surface = "preview";
		}
		let result = {
			ok: true,
			path: current.context.reportPath,
			markdown,
			settings: persisted.settings,
			base_url: automationDocumentBaseURL(current),
			save_reason: persisted.save_reason,
			snapshot_path: persisted.snapshot_path,
			report_hash: persisted.report_hash,
		};
		if (["preview", "native", "both"].includes(surface)) {
			Object.assign(result, await automationRenderedState(current, {
				markdown,
				editor_settings: editorSettings,
				surface,
			}));
		}
		return result;
	}

	function automationEnsureExportExtension(path = "", extension = "") {
		let nextPath = automationOptionalString(path);
		let nextExtension = automationOptionalString(extension).toLowerCase();
		if (!nextPath || !nextExtension) {
			return nextPath;
		}
		return nextPath.toLowerCase().endsWith(nextExtension) ? nextPath : `${nextPath}${nextExtension}`;
	}

	function automationExportDefaultStem(current) {
		return reviewer._sanitizeFileName(current?.context?.collectionName || "REPORT");
	}

	function automationExportDisplayDirectory(current) {
		return automationOptionalString(
			reviewer?._parentPath?.(automationOptionalString(current?.context?.reportPath || ""))
		) || automationOptionalString(current?.context?.projectRoot || "");
	}

	function automationNormalizeExportFormat(value = "") {
		let normalized = automationOptionalString(value).toLowerCase();
		if (normalized == "md" || normalized == "plain_markdown" || normalized == "markdown") {
			return "md";
		}
		if (normalized == "docx") {
			return "docx";
		}
		return "pdf";
	}

	function automationNormalizeDocxCitationMode(value = "") {
		return automationOptionalString(value).toLowerCase() == "unlinked" ? "unlinked" : "linked";
	}

	function automationExportOptionsForFormat(current, format = "pdf", citationMode = "linked") {
		let normalizedFormat = automationNormalizeExportFormat(format);
		let normalizedCitationMode = automationNormalizeDocxCitationMode(citationMode);
		switch (normalizedFormat) {
			case "docx":
				return {
					prefix: "automation-export-docx",
					kind: "manual_automation_export_docx",
					mode: "docx",
					jobTitle: `Save DOCX: ${current?.context?.collectionName || "REPORT"}`,
					title: "Export REPORT.md as DOCX",
					extension: ".docx",
					defaultString: `${automationExportDefaultStem(current)}.docx`,
					filterLabel: "DOCX",
					filterPattern: "*.docx",
					message: `DOCX export queued (${normalizedCitationMode == "linked" ? "linked" : "unlinked"} citations). Track progress in Jobs.`,
				};
			case "md":
				return {
					prefix: "automation-export-markdown",
					kind: "manual_automation_export_markdown",
					mode: "plain_markdown",
					jobTitle: `Save Markdown: ${current?.context?.collectionName || "REPORT"}`,
					title: "Save REPORT.md as plain rendered Markdown",
					extension: ".md",
					defaultString: `${automationExportDefaultStem(current)}-plain.md`,
					filterLabel: "Markdown",
					filterPattern: "*.md",
					message: "Markdown export queued. Track progress in Jobs.",
				};
			case "pdf":
			default:
				return {
					prefix: "automation-export-pdf",
					kind: "manual_automation_export_pdf",
					mode: "pdf",
					jobTitle: `Save PDF: ${current?.context?.collectionName || "REPORT"}`,
					title: "Save REPORT.md as PDF",
					extension: ".pdf",
					defaultString: `${automationExportDefaultStem(current)}.pdf`,
					filterLabel: "PDF",
					filterPattern: "*.pdf",
					message: "PDF export queued. Track progress in Jobs.",
				};
		}
	}

	async function automationChooseSavePath(current, options = {}) {
		let win = reviewer._primaryWindow?.();
		if (!win?.document) {
			throw new Error("A Zotero window is required to choose where to save the Automation export.");
		}
		let fakeController = { doc: win.document };
		let fp = Components.classes["@mozilla.org/filepicker;1"]
			.createInstance(Components.interfaces.nsIFilePicker);
		reviewer._initFilePicker(
			fp,
			fakeController,
			automationOptionalString(options.title) || "Save Automation export",
			Components.interfaces.nsIFilePicker.modeSave
		);
		fp.defaultExtension = automationOptionalString(options.extension).replace(/^\./, "");
		fp.defaultString = automationOptionalString(options.defaultString);
		fp.appendFilter(
			automationOptionalString(options.filterLabel) || "Files",
			automationOptionalString(options.filterPattern) || "*.*"
		);
		let displayDirectory = automationExportDisplayDirectory(current);
		if (displayDirectory && await reviewer._pathExists(displayDirectory)) {
			try {
				fp.displayDirectory = reviewer._nsIFile(displayDirectory);
			}
			catch (_error) {}
		}
		let result = await new Promise((resolve) => fp.open(resolve));
		if ((result != Components.interfaces.nsIFilePicker.returnOK && result != Components.interfaces.nsIFilePicker.returnReplace) || !fp.file) {
			return "";
		}
		return automationEnsureExportExtension(fp.file.path, automationOptionalString(options.extension));
	}

	async function automationQueueExportJob(current, payload = {}, options = {}) {
		let outputPath = automationEnsureExportExtension(
			payload?.output_path || payload?.outputPath || "",
			automationOptionalString(options.extension)
		);
		if (!outputPath) {
			outputPath = await automationChooseSavePath(current, options);
		}
		if (!outputPath) {
			return { ok: true, canceled: true };
		}
		let storedPayload = Object.assign({}, payload || {}, {
			detach: true,
		});
		delete storedPayload.output_path;
		delete storedPayload.outputPath;
		return await reviewer._launchWorkflowJob(current, {
			prefix: automationOptionalString(options.prefix) || "automation-export",
			kind: automationOptionalString(options.kind) || "manual_automation_export",
			title: automationOptionalString(options.jobTitle) || `Export ${current?.context?.collectionName || "REPORT"}`,
			requested_mode: automationOptionalString(options.mode) || "export",
			used_mode: automationOptionalString(options.mode) || "export",
			source_title: automationOptionalString(current?.context?.collectionName || "REPORT"),
			source_path: automationOptionalString(current?.context?.reportPath || current?.context?.projectRoot || ""),
			output_path: outputPath,
			metadata: {
				payload: storedPayload,
				output_path: outputPath,
				export_kind: automationOptionalString(options.mode) || "export",
			},
			waitForCompletion: automationWaitForJobCompletion(payload, false),
			refreshControllers: false,
			message: automationOptionalString(options.message) || "Export queued. Track progress in Jobs.",
		});
	}

	async function automationExportSaveAs(current, payload = {}) {
		let format = automationNormalizeExportFormat(payload?.format);
		let citationMode = format == "docx"
			? automationNormalizeDocxCitationMode(payload?.citation_mode || payload?.citationMode)
			: "";
		return await automationQueueExportJob(current, Object.assign({}, payload || {}, {
			format,
			...(format == "docx" ? { citation_mode: citationMode } : {}),
		}), automationExportOptionsForFormat(current, format, citationMode));
	}

	async function automationExportPDFSaveAs(current, payload = {}) {
		return await automationExportSaveAs(current, Object.assign({}, payload || {}, { format: "pdf" }));
	}

	async function automationExportPlainMarkdownSaveAs(current, payload = {}) {
		return await automationExportSaveAs(current, Object.assign({}, payload || {}, { format: "md" }));
	}

	async function automationExportDOCXSaveAs(current, payload = {}) {
		return await automationExportSaveAs(current, Object.assign({}, payload || {}, { format: "docx" }));
	}

	async function automationExportPlainMarkdown(current, payload = {}) {
		let jobID = automationExistingJobID(payload);
		let win = reviewer._primaryWindow?.();
		if (!win) {
			throw new Error("No Zotero window is available.");
		}
		let settings = await automationProjectSettings(current);
		let editorSettings = automationEditorSettings(settings, payload || {});
		let markdown = await automationMarkdown(current, payload || {});
		let controller = automationRenderController(current, editorSettings, win.document);
		let outputPath = automationEnsureExportExtension(payload?.output_path || payload?.outputPath || "", ".md");
		if (!outputPath && jobID) {
			throw new Error("Markdown export requires an output path.");
		}
		if (!outputPath) {
			let pickedPath = await automationChooseSavePath(current, {
				title: "Save REPORT.md as plain rendered Markdown",
				extension: ".md",
				defaultString: `${automationExportDefaultStem(current)}-plain.md`,
				filterLabel: "Markdown",
				filterPattern: "*.md",
			});
			if (!pickedPath) {
				return { ok: true, canceled: true };
			}
			outputPath = pickedPath;
		}
		try {
			let rendered = reviewer._renderPlainCitationMarkdown(controller, markdown);
			await reviewer._ensureDirectory(reviewer._parentPath(outputPath));
			await reviewer._writeTextFile(outputPath, rendered);
			let result = {
				ok: true,
				job_id: jobID,
				path: outputPath,
				file_name: reviewer._basename(outputPath),
			};
			if (jobID) {
				await SystematicReviewerWorkflowJobs.succeed(reviewer, current, jobID, {
					used_mode: "plain_markdown",
					output_path: outputPath,
					progress_current: 1,
					progress_total: 1,
					message: `Saved Markdown ${result.file_name}`.trim(),
					metadata: {
						path: outputPath,
						file_name: result.file_name,
					},
				});
			}
			return result;
		}
		catch (error) {
			if (jobID) {
				await SystematicReviewerWorkflowJobs.fail(reviewer, current, jobID, error);
			}
			throw error;
		}
	}

	async function automationExportPDF(current, payload = {}) {
		let jobID = automationExistingJobID(payload);
		let win = reviewer._primaryWindow?.();
		if (!win) {
			throw new Error("No Zotero window is available.");
		}
		let settings = await automationProjectSettings(current);
		let editorSettings = automationEditorSettings(settings, payload || {});
		let markdown = await automationMarkdown(current, payload || {});
		let controller = automationRenderController(current, editorSettings, win.document);
		let outputPath = automationEnsureExportExtension(payload?.output_path || payload?.outputPath || "", ".pdf");
		if (!outputPath && jobID) {
			throw new Error("PDF export requires an output path.");
		}
		if (!outputPath) {
			let pickedPath = await automationChooseSavePath(current, {
				title: "Save REPORT.md as PDF",
				extension: ".pdf",
				defaultString: `${automationExportDefaultStem(current)}.pdf`,
				filterLabel: "PDF",
				filterPattern: "*.pdf",
			});
			if (!pickedPath) {
				return { ok: true, canceled: true };
			}
			outputPath = pickedPath;
		}
		try {
			await reviewer._ensureDirectory(reviewer._parentPath(outputPath));
			let prismaExportHTML = await automationPrismaExportHTML(current, win, markdown, editorSettings);
			let paginatedBodyHTML = SystematicReviewerNativeMarkdown.renderPaginatedPrintDocumentHTML(markdown, {
					settings: editorSettings,
					explicitPageFooters: true,
					strict: true,
					strictTables: true,
					wrapPrintSections: true,
					document: win.document,
					theme: reviewer._themeClassForWindow(win) == "theme-dark" ? "dark" : "light",
				renderCitation: (citation, label) => {
					let markdownToken = SystematicReviewerNativeMarkdown.makeCitationMarkdown(citation);
					let formatted = reviewer._formatCitationHTML(controller, citation, label);
					return `<span class="sr-citation-chip" data-sr-markdown="${reviewer._escapeHTML(markdownToken)}">${formatted}</span>`;
				},
				renderBibliography: (source) => reviewer._renderBibliographyHTML(controller, source),
				renderPrisma: () => prismaExportHTML || automationPrismaFallbackHTML(),
				resolveAssetURL: (assetPath) => reviewer._resolveWorkspaceAssetURL(controller, assetPath),
			});
			let html = SystematicReviewerNativeMarkdown.createPrintHTML({
				title: current.context.collectionName,
				bodyHTML: paginatedBodyHTML,
				settings: editorSettings,
				baseURL: automationDocumentBaseURL(current),
				theme: reviewer._themeClassForWindow(win) == "theme-dark" ? "dark" : "light",
				nativeMode: false,
			});
			await reviewer._printHTMLToPDF(win, html, outputPath, editorSettings);
			let result = {
				ok: true,
				job_id: jobID,
				path: outputPath,
				file_name: reviewer._basename(outputPath),
			};
			if (jobID) {
				await SystematicReviewerWorkflowJobs.succeed(reviewer, current, jobID, {
					used_mode: "pdf",
					output_path: outputPath,
					progress_current: 1,
					progress_total: 1,
					message: `Saved PDF ${result.file_name}`.trim(),
					metadata: {
						path: outputPath,
						file_name: result.file_name,
					},
				});
			}
			return result;
		}
		catch (error) {
			if (jobID) {
				await SystematicReviewerWorkflowJobs.fail(reviewer, current, jobID, error);
			}
			throw error;
		}
	}

	async function automationExportDOCX(current, payload = {}) {
		let jobID = automationExistingJobID(payload);
		let win = reviewer._primaryWindow?.();
		if (!win) {
			throw new Error("No Zotero window is available.");
		}
		let settings = await automationProjectSettings(current);
		let editorSettings = automationEditorSettings(settings, payload || {});
		let markdown = await automationMarkdown(current, payload || {});
		let controller = automationRenderController(current, editorSettings, win.document);
		let citationMode = automationNormalizeDocxCitationMode(payload?.citation_mode || payload?.citationMode);
		let outputPath = automationEnsureExportExtension(payload?.output_path || payload?.outputPath || "", ".docx");
		if (!outputPath && jobID) {
			throw new Error("DOCX export requires an output path.");
		}
		if (!outputPath) {
			let pickedPath = await automationChooseSavePath(current, {
				title: "Export REPORT.md as DOCX",
				extension: ".docx",
				defaultString: `${automationExportDefaultStem(current)}.docx`,
				filterLabel: "DOCX",
				filterPattern: "*.docx",
			});
			if (!pickedPath) {
				return { ok: true, canceled: true };
			}
			outputPath = pickedPath;
		}
		try {
			await reviewer._ensureDirectory(reviewer._parentPath(outputPath));
			await SystematicReviewerSaveDOCX.saveAutomationDOCX({
				reviewer,
				current,
				win,
				markdown,
				outputPath,
				settings: editorSettings,
				controller,
				citationMode,
				title: current?.context?.collectionName || "REPORT",
			});
			let result = {
				ok: true,
				job_id: jobID,
				path: outputPath,
				file_name: reviewer._basename(outputPath),
				citation_mode: citationMode,
			};
			if (jobID) {
				await SystematicReviewerWorkflowJobs.succeed(reviewer, current, jobID, {
					used_mode: "docx",
					output_path: outputPath,
					progress_current: 1,
					progress_total: 1,
					message: `Saved DOCX ${result.file_name}`.trim(),
					metadata: {
						path: outputPath,
						file_name: result.file_name,
						citation_mode: citationMode,
					},
				});
			}
			return result;
		}
		catch (error) {
			if (jobID) {
				await SystematicReviewerWorkflowJobs.fail(reviewer, current, jobID, error);
			}
			throw error;
		}
	}

	async function automationExport(current, payload = {}) {
		let format = automationNormalizeExportFormat(payload?.format);
		if (format == "docx") {
			return await automationExportDOCX(current, payload || {});
		}
		if (format == "md") {
			return await automationExportPlainMarkdown(current, payload || {});
		}
		return await automationExportPDF(current, payload || {});
	}

	async function automationImportImage(current, payload = {}) {
		let win = reviewer._primaryWindow?.();
		if (!win) {
			throw new Error("No Zotero window is available.");
		}
		let sourcePath = String(payload?.source_path || payload?.sourcePath || "").trim();
		let picked = null;
		if (sourcePath) {
			if (!(await reviewer._pathExists(sourcePath))) {
				throw new Error(`Image file does not exist: ${sourcePath}`);
			}
			picked = reviewer._nsIFile(sourcePath);
		}
		else {
			let fakeController = { doc: win.document };
			let fp = Components.classes["@mozilla.org/filepicker;1"]
				.createInstance(Components.interfaces.nsIFilePicker);
			reviewer._initFilePicker(fp, fakeController, "Choose image", Components.interfaces.nsIFilePicker.modeOpen);
			fp.appendFilter("Images", "*.png; *.jpg; *.jpeg; *.gif; *.webp; *.svg");
			let result = await new Promise((resolve) => fp.open(resolve));
			if (result != Components.interfaces.nsIFilePicker.returnOK || !fp.file) {
				return { ok: true, canceled: true };
			}
			picked = fp.file;
		}
		let targetName = reviewer._sanitizeFileName(picked.leafName);
		let destination = reviewer._joinPath(reviewer._parentPath(current.context.reportPath), targetName);
		let counter = 1;
		while (await reviewer._pathExists(destination)) {
			let ext = targetName.includes(".") ? targetName.slice(targetName.lastIndexOf(".")) : "";
			let stem = ext ? targetName.slice(0, -ext.length) : targetName;
			destination = reviewer._joinPath(reviewer._parentPath(current.context.reportPath), `${stem}-${counter}${ext}`);
			counter += 1;
		}
		reviewer._copyFileToPath(picked.path, destination);
		let relativePath = reviewer._basename(destination);
		return {
			ok: true,
			relative_path: relativePath,
			asset_path: destination,
			markdown: `![${reviewer._basename(destination)}](${relativePath})`,
		};
	}

	async function automationCitationPreview(current, payload = {}) {
		let win = reviewer._primaryWindow?.();
		if (!win?.document) {
			throw new Error("No Zotero window is available.");
		}
		let settings = await automationProjectSettings(current);
		let editorSettings = automationEditorSettings(settings, payload || {});
		let controller = automationRenderController(current, editorSettings, win.document, "preview");
		let cacheEntry = automationWorkspaceRenderCacheEntry(controller);
		let markdown = await automationMarkdown(current, payload || {});
		let includeLabels = !!(payload?.include_citation_labels || payload?.includeCitationLabels || payload?.include_labels || payload?.includeLabels);
		let labelsByKey = null;
		if (includeLabels) {
			let catalog = await automationCitationCatalog(current);
			labelsByKey = new Map(catalog.map((entry) => [String(entry.item_key || ""), entry]));
		}
		let singleCitation = payload?.citation && typeof payload.citation == "object"
			? payload.citation
			: (payload?.citation_data && typeof payload.citation_data == "object" ? payload.citation_data : null);
		let includeAllCitations = !singleCitation
			|| !!(payload?.include_all_citations || payload?.includeAllCitations);
		let seen = new Set();
		let citations = [];
		if (includeAllCitations) {
			for (let citation of SystematicReviewerNativeMarkdown.extractCitations(markdown || "")) {
				let token = String(SystematicReviewerNativeMarkdown.makeCitationMarkdown(citation) || citation.markdown || "").trim();
				if (!token || seen.has(token)) {
					continue;
				}
				seen.add(token);
				let entry = {
					token,
					keys: Array.isArray(citation.keys) ? citation.keys.slice() : [],
					html: reviewer._formatCitationHTML(controller, citation, token),
					text: reviewer._formatCitationText(controller, citation, token),
				};
				if (labelsByKey) {
					entry.labels = (citation.keys || []).map((key) => labelsByKey.get(String(key || "")) || {
						item_key: String(key || ""),
						citation_text: String(key || ""),
						authors: "",
						year: "",
						title: "",
						publication_title: "",
					});
				}
				citations.push(entry);
			}
		}
		syncAutomationWorkspaceRenderCache(controller, cacheEntry);
		let single = null;
		if (singleCitation) {
			let normalized = {
				keys: Array.isArray(singleCitation.keys) ? singleCitation.keys.map((key) => String(key || "").trim()).filter(Boolean) : [],
				prefix: String(singleCitation.prefix || "").trim(),
				locator: String(singleCitation.locator || "").trim(),
				suffix: String(singleCitation.suffix || "").trim(),
			};
			if (normalized.keys.length) {
				let token = SystematicReviewerNativeMarkdown.makeCitationMarkdown(normalized);
				single = {
					token,
					html: reviewer._formatCitationHTML(controller, normalized, token),
					text: reviewer._formatCitationText(controller, normalized, token),
				};
			}
		}
		syncAutomationWorkspaceRenderCache(controller, cacheEntry);
		let includeBibliography = includeAllCitations
			|| !!(payload?.include_bibliography || payload?.includeBibliography);
		return {
			ok: true,
			citations,
			citation: single,
			bibliography_html: includeBibliography ? reviewer._renderBibliographyHTML(controller, markdown) : "",
			bibliography_text: includeBibliography ? reviewer._renderBibliographyText(controller, markdown) : "",
		};
	}

	function buildRegistry() {
		let next = new Map();
		let define = (entry) => {
			next.set(entry.id, entry);
		};

		define({
			id: "workflow.getBootstrap",
			description: "Get workflow tab metadata, current project, and theme state.",
			tab: "workflow",
			execute: async (payload = {}) => workflowBootstrap(payload || {}),
		});

		define({
			id: "workflow.getUIAppearance",
			description: "Get the current workflow UI appearance settings derived from Zotero chrome state.",
			tab: "workflow",
			execute: async () => ({
				ok: true,
				ui_appearance: reviewer?._workflowUIAppearance?.() || { font_scale: 1 },
			}),
		});

		define({
			id: "attachmentViewer.load",
			description: "Load one exact Zotero text, code, CSV, or Markdown attachment for an isolated attachment viewer tab.",
			execute: async (payload = {}) => attachmentViewerLoad(payload || {}),
		});

		define({
			id: "attachmentViewer.save",
			description: "Save one exact Zotero text, code, CSV, or Markdown attachment from an isolated attachment viewer tab.",
			execute: async (payload = {}) => attachmentViewerSave(payload || {}),
		});

		define({
			id: "workflow.scopes.list",
			description: "List lightweight workflow scopes without counts for the current project.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return {
					ok: true,
					scopes: SystematicReviewerWorkflowEmbeddings.lightweightScopes
						? SystematicReviewerWorkflowEmbeddings.lightweightScopes(reviewer, current, payload || {})
						: [],
				};
			},
		});

		define({
			id: "workflow.scopes.hydrate",
			description: "Hydrate workflow scope labels with counts for the current project.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return {
					ok: true,
					scopes: SystematicReviewerWorkflowEmbeddings.hydrateScopes
						? await SystematicReviewerWorkflowEmbeddings.hydrateScopes(reviewer, current, payload || {})
						: [],
				};
			},
		});

		define({
			id: "workflow.options.embeddingsSources.list",
			description: "List lightweight embeddings source options for the current project or one scope.",
			tab: "workflow",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowEmbeddings.listSourceOptions(reviewer, current, payload || {});
			},
		});

		define({
			id: "workflow.options.embeddingsSources.hydrate",
			description: "Hydrate embeddings source options with counts for the current project or one scope.",
			tab: "workflow",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowEmbeddings.hydrateSourceOptions(reviewer, current, payload || {});
			},
		});

		define({
			id: "workflow.options.embeddingsStored.list",
			description: "List stored embeddings metadata for the current project.",
			tab: "workflow",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowEmbeddings.listStoredOptions(reviewer, current.context);
			},
		});

		define({
			id: "workflow.options.semanticSources.list",
			description: "List lightweight stored semantic-search sources for the current embeddings model.",
			tab: "workflow",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowSemanticSearch.listSourceOptions({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "workflow.options.extractionSources.list",
			description: "List lightweight extraction source options for the current project or one scope.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowExtraction.listSourceOptions(reviewer, current, payload || {});
			},
		});

		define({
			id: "workflow.options.extractionColumns.list",
			description: "List lightweight extraction column placeholder options for the current project.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowExtraction.listColumnOptions(reviewer, current);
			},
		});

		define({
			id: "workflow.options.extractionRuntimes.list",
			description: "List lightweight extraction runtime preset options.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowExtraction.listRuntimeSelectorOptions(reviewer, current);
			},
		});

		define({
			id: "workflow.options.exploreColumns.list",
			description: "List lightweight Explore column catalog entries for the current project.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowExplore.listColumnCatalog({
					reviewer,
					current,
				});
			},
		});

		define({
			id: "workflow.options.exploreRuntimes.list",
			description: "List lightweight Explore runtime choices.",
			tab: "workflow",
			execute: async (payload = {}) => {
				await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowExplore.listRuntimeChoiceOptions({
					reviewer,
				});
			},
		});

		define({
			id: "workflow.options.screeningColumns.list",
			description: "List screening columns without loading screening rows.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return {
					ok: true,
					columns: await SystematicReviewerWorkflowScreening.listAllColumnDefinitions(reviewer, current.context),
				};
			},
		});

		define({
			id: "workflow.options.screeningTargets.list",
			description: "List screening move targets without loading screening rows.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return {
					ok: true,
					targets: SystematicReviewerWorkflowScreening.availableDecisionTargets(reviewer, current),
				};
			},
		});

		define({
			id: "workflow.openExternalURL",
			description: "Open one external documentation link in the system browser.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let rawURL = String(payload?.url || "").trim();
				if (!rawURL) {
					throw new Error("No URL provided.");
				}
				let target = null;
				try {
					target = new URL(rawURL);
				}
				catch (_error) {
					throw new Error("Invalid external URL.");
				}
				if (!["http:", "https:"].includes(target.protocol)) {
					throw new Error("Only http and https links are supported.");
				}
				if (typeof Zotero?.launchURL != "function") {
					throw new Error("External URL opening is not available in this Zotero build.");
				}
				Zotero.launchURL(target.href);
				return {
					ok: true,
					url: target.href,
				};
			},
		});

		define({
			id: "settings.getBootstrap",
			description: "Load the full global settings payload for the native Settings tab.",
			tab: "workflow",
			execute: async () => await reviewer.getPreferencePanePayload(),
		});

		define({
			id: "settings.save",
			description: "Save global Systematic Reviewer settings using the existing preference backend.",
			tab: "workflow",
			execute: async (payload = {}) => await reviewer.savePreferencePaneSettings(payload || {}),
		});

		define({
			id: "settings.restartZotero",
			description: "Restart Zotero after restart-gated Systematic Reviewer settings are saved.",
			tab: "workflow",
			execute: async () => await restartZoteroApplication(),
		});

		define({
			id: "settings.scan",
			description: "Scan local runtimes and endpoints using the existing preference backend.",
			tab: "workflow",
			execute: async (payload = {}) => await reviewer.scanPreferencePaneEndpoints(payload || {}),
		});

		define({
			id: "settings.runtimeRole.test",
			description: "Test one runtime role using the existing preference backend.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let roleID = String(payload?.role_id || payload?.roleID || "").trim();
				return await reviewer.testPreferencePaneRuntimeRole(roleID, payload || {});
			},
		});

		define({
			id: "settings.mcpClient.test",
			description: "Test one external MCP connector using the native MCP client runtime.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let server = payload?.server && typeof payload.server == "object" ? payload.server : payload;
				return await reviewer.testPreferencePaneMCPClient(server || {}, payload || {});
			},
		});

		define({
			id: "settings.project.reveal",
			description: "Reveal one stored project folder using the existing preference backend.",
			tab: "workflow",
			execute: async (payload = {}) =>
				await reviewer.revealPreferencePaneProject(String(payload?.project_id || payload?.projectID || "").trim()),
		});

		define({
			id: "settings.project.delete",
			description: "Delete one stored project using the existing preference backend.",
			tab: "workflow",
			execute: async (payload = {}) => await reviewer.deletePreferencePaneProject(payload || {}),
		});

		define({
			id: "settings.project.reconcile",
			description: "Queue a batched project reconcile job for one stored project.",
			tab: "settings",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await queueProjectReconcileJob(current, payload || {}, "settings");
			},
		});

		define({
			id: "workflow.uiState.save",
			description: "Save per-project workflow UI state such as the active tab and last selected scope.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let tabs = SystematicReviewerWorkflowManifest.listTabs(
					current?.projectType || "",
					await workflowCapabilities(current).catch(() => ({ embeddings_available: false }))
				);
				return {
					ok: true,
					ui_state: await saveWorkflowUIState(current.context, tabs, payload || {}),
				};
			},
		});

		define({
			id: "workflow.uiState.get",
			description: "Read per-project workflow UI state such as the active tab and last selected scope.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let tabs = SystematicReviewerWorkflowManifest.listTabs(
					current?.projectType || "",
					await workflowCapabilities(current).catch(() => ({ embeddings_available: false }))
				);
				return {
					ok: true,
					ui_state: await readWorkflowUIState(current.context, tabs),
				};
			},
		});

		define({
			id: "workflow.tabTitle.set",
			description: "Set the current workflow Zotero tab title using the project name and active subtab label.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let tabID = String(payload?.tab_id || payload?.tabID || "").trim();
				let activeTab = String(payload?.active_tab || payload?.activeTab || "").trim();
				let current = null;
				let requestedProjectID = String(payload?.project_id || payload?.projectID || "").trim();
				if (!(activeTab == "settings" && !requestedProjectID)) {
					try {
						current = await requireCurrentProject(payload || {});
					}
					catch (_err) {
						current = null;
					}
				}
				let title = reviewer._workflowTabTitle(current?.context || null, activeTab);
				await reviewer._renameSystematicTabByID(tabID, title);
				return {
					ok: true,
					tab_id: tabID,
					title,
				};
			},
		});

		define({
			id: "workflow.settings.open",
			description: "Open the global Settings tab in a Zotero tab.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let tab = await reviewer._openSettingsTab(null, {
					new_tab: !!(payload?.new_tab || payload?.newTab || payload?.force_new || payload?.forceNew),
				});
				return {
					ok: true,
					tab_id: tab?.id || "",
				};
			},
		});

		define({
			id: "workflow.openTab",
			description: "Open one workflow subtab in a new Zotero tab for the current project.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let activeTab = String(payload?.tab_id || payload?.tabID || "").trim();
				let forceNew = !!(payload?.new_tab || payload?.newTab || payload?.force_new || payload?.forceNew);
				await reviewer._openWorkflowTab(
					null,
					current,
					{
						activeTab,
						forceNew,
					}
				);
				return {
					ok: true,
					tab_id: activeTab,
					new_tab: forceNew,
				};
			},
		});

		define({
			id: "workflow.jobs.open",
			description: "Open the global SR Jobs tab in a Zotero tab.",
			tab: "workflow",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let tab = await reviewer._openJobsTab(null, current, {
					new_tab: !!(payload?.new_tab || payload?.newTab || payload?.force_new || payload?.forceNew),
				});
				return {
					ok: true,
					tab_id: tab?.id || "",
				};
			},
		});

		define({
			id: "automation.getBootstrap",
			description: "Load the Automation workspace state for the current project, including REPORT.md, sessions, chat history, and editor metadata.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationBootstrap(current, payload || {});
			},
		});

		define({
			id: "automation.session.ensure_context",
			description: "Ensure the current Automation session has its backend collection inspection and tool context entries.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationEnsureSessionContext(current, payload || {});
			},
		});

		define({
			id: "automation.project.switch",
			description: "Switch the Automation workspace to another stored project and return the updated workspace bootstrap payload.",
			tab: "automation",
			execute: async (payload = {}) => {
				let projectID = String(payload?.project_id || payload?.projectID || "").trim();
				if (!projectID) {
					throw new Error("project_id is required.");
				}
				let current = await reviewer._openStoredProject(projectID, payload || {});
				return await automationBootstrap(current, payload || {});
			},
		});

		define({
			id: "automation.session.new",
			description: "Create and activate a new Automation workspace session for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let sessionID = await reviewer._createSession(current.context, {
					title: String(payload?.title || "").trim(),
					activate: true,
				});
				current.sessionID = sessionID;
				await reviewer._activateSessionContext(current, sessionID);
				return await automationBootstrap(current, payload || {});
			},
		});

		define({
			id: "automation.session.switch",
			description: "Switch the active Automation workspace session for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let sessionID = String(payload?.session_id || payload?.sessionID || "").trim();
				if (!sessionID) {
					throw new Error("session_id is required.");
				}
				await reviewer._activateSessionContext(current, sessionID);
				current.sessionID = sessionID;
				return await automationBootstrap(current, payload || {});
			},
		});

			define({
				id: "automation.chat.runtime.set",
				description: "Set the chat model preset for the active Automation session.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				let presetID = String(payload?.preset_id || payload?.presetID || "default").trim() || "default";
				let config = await reviewer._conversionConfig();
				let available = reviewer._listRuntimePresetOptions
					? reviewer._listRuntimePresetOptions("session_chat", config)
					: [];
				if (!available.some((entry) => String(entry?.preset_id || "").trim() == presetID)) {
					throw new Error("Selected chat model preset was not found.");
				}
				let currentState = await reviewer._loadSessionRuntimeState(current.context, sessionID);
				let currentPreset = available.find((entry) => String(entry?.preset_id || "").trim() == String(currentState?.chat_preset_id || "default").trim()) || null;
				let nextPreset = available.find((entry) => String(entry?.preset_id || "").trim() == presetID) || null;
				let requestedModel = Object.prototype.hasOwnProperty.call(payload || {}, "model")
					|| Object.prototype.hasOwnProperty.call(payload || {}, "model_override")
					|| Object.prototype.hasOwnProperty.call(payload || {}, "chat_model_override")
					? String(payload?.model ?? payload?.model_override ?? payload?.chat_model_override ?? "").trim()
					: null;
				let requestedReasoningEffort = Object.prototype.hasOwnProperty.call(payload || {}, "reasoning_effort")
					? (
						typeof reviewer._normalizeReasoningEffort == "function"
							? reviewer._normalizeReasoningEffort(payload?.reasoning_effort || payload?.reasoningEffort || "", { allowCustom: true })
							: String(payload?.reasoning_effort || payload?.reasoningEffort || "").trim().toLowerCase()
					)
					: null;
				let isOpenCodePreset =
					String(nextPreset?.runtime_type || "").trim() == "local_exec" &&
					String(nextPreset?.executor_id || "").trim() == "opencode";
				let samePreset = presetID == String(currentState?.chat_preset_id || "default").trim();
				let nextModelOverride = isOpenCodePreset
					? (requestedModel === null ? (samePreset ? String(currentState?.chat_model_override || "").trim() : "") : requestedModel)
					: "";
				let openCodeModelOptions = Array.isArray(nextPreset?.model_options) ? nextPreset.model_options : [];
				let effectiveOpenCodeModelID = nextModelOverride || String(nextPreset?.model || "").trim();
				let selectedOpenCodeModel = isOpenCodePreset && effectiveOpenCodeModelID
					? openCodeModelOptions.find((entry) => String(entry?.id || "").trim() == effectiveOpenCodeModelID) || null
					: null;
				if (isOpenCodePreset && effectiveOpenCodeModelID && !selectedOpenCodeModel) {
					throw new Error(`OpenCode model is not available from the scanned catalog: ${effectiveOpenCodeModelID}. Run Scan local runtimes first.`);
				}
				let openCodeReasoningOptions = selectedOpenCodeModel && Array.isArray(selectedOpenCodeModel?.reasoning_options)
					? selectedOpenCodeModel.reasoning_options.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
					: [];
				let currentOpenCodeReasoning = String(currentState?.chat_reasoning_effort || "").trim().toLowerCase();
				let presetOpenCodeReasoning = String(nextPreset?.reasoning_effort || "").trim().toLowerCase();
				if (isOpenCodePreset && requestedReasoningEffort) {
					requestedReasoningEffort = String(requestedReasoningEffort || "").trim().toLowerCase();
					if (!openCodeReasoningOptions.includes(requestedReasoningEffort)) {
						requestedReasoningEffort = "";
					}
				}
				let supportsReasoning = isOpenCodePreset ? openCodeReasoningOptions.length > 0 : !!nextPreset?.supports_reasoning;
				let nextReasoningEffort = "";
				if (isOpenCodePreset) {
					if (supportsReasoning) {
						nextReasoningEffort = requestedReasoningEffort === null
							? (requestedModel !== null
								? ""
								: (samePreset && String(currentState?.chat_model_override || "").trim() == nextModelOverride && openCodeReasoningOptions.includes(currentOpenCodeReasoning)
									? currentOpenCodeReasoning
									: (openCodeReasoningOptions.includes(presetOpenCodeReasoning) ? presetOpenCodeReasoning : "")))
							: requestedReasoningEffort;
					}
				}
				else if (supportsReasoning) {
					nextReasoningEffort = requestedReasoningEffort === null
						? (typeof reviewer._normalizeReasoningEffort == "function"
							? reviewer._normalizeReasoningEffort(currentState?.chat_reasoning_effort || "", { allowCustom: true })
							: String(currentState?.chat_reasoning_effort || "").trim().toLowerCase())
						: requestedReasoningEffort;
				}
					await reviewer._updateSessionRuntimeState(current.context, sessionID, {
						chat_preset_id: presetID,
						chat_previous_response_id: samePreset && String(currentState?.chat_model_override || "").trim() == nextModelOverride
							? currentState?.chat_previous_response_id || ""
							: "",
						chat_reasoning_effort: nextReasoningEffort,
						chat_model_override: nextModelOverride,
					});
					if (
						/-autodrive-reviewer$/.test(String(sessionID || ""))
						&& !payload?.inherit_autodrive_reviewer_runtime
					) {
						await reviewer._updateSessionState(current.context, sessionID, {
							summaryPatch: {
								autodrive_reviewer_runtime: {
									explicit: true,
									updated_at: new Date().toISOString(),
								},
							},
						});
					}
					return {
					ok: true,
					session_id: sessionID,
					runtime_state: await reviewer._loadSessionRuntimeState(current.context, sessionID),
					changed: presetID != String(currentState?.chat_preset_id || "default").trim(),
					previous_preset: currentPreset,
					selected_preset: nextPreset,
					runtime_options: await automationRuntimeOptions(current),
				};
				},
			});

			define({
				id: "automation.memory.rebuild",
				description: "Rebuild active-memory.txt from the project's chronological memory.txt.",
				tab: "automation",
				execute: async (payload = {}) => {
					let current = await requireCurrentProject(payload || {});
					let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
						|| await reviewer._ensureActiveSession(current.context);
					await reviewer._activateSessionContext(current, sessionID);
					current.sessionID = sessionID;
					return await reviewer._rebuildActiveMemory(current, sessionID, {});
				},
			});

			define({
				id: "automation.chat.queue.add",
			description: "Add one pending queued or steer message for the active Automation session.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let message = String(payload?.message || "").trim();
				if (!message) {
					throw new Error("message is required.");
				}
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				await reviewer._activateSessionContext(current, sessionID);
				current.sessionID = sessionID;
				let queuedMessage = await reviewer._queueSessionPendingMessage(current.context, sessionID, message, {
					mode: String(payload?.mode || "queued").trim() || "queued",
					payload: payload?.payload && typeof payload.payload == "object" ? payload.payload : null,
				});
				return Object.assign({
					ok: true,
					queue_message: queuedMessage,
				}, await automationChatState(current, sessionID, null, {
					historyLimit: payload?.history_limit || payload?.historyLimit,
				}));
			},
		});

		define({
			id: "automation.chat.queue.update",
			description: "Update one pending queued or steer message for the active Automation session.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				let queueID = String(payload?.queue_id || payload?.queueID || "").trim();
				if (!queueID) {
					throw new Error("queue_id is required.");
				}
				await reviewer._activateSessionContext(current, sessionID);
				current.sessionID = sessionID;
				let patch = {};
				if (Object.prototype.hasOwnProperty.call(payload || {}, "mode")) {
					patch.mode = payload.mode;
				}
				if (Object.prototype.hasOwnProperty.call(payload || {}, "message") || Object.prototype.hasOwnProperty.call(payload || {}, "content")) {
					patch.content = Object.prototype.hasOwnProperty.call(payload || {}, "message")
						? payload.message
						: payload.content;
				}
				if (Object.prototype.hasOwnProperty.call(payload || {}, "payload")) {
					patch.payload = payload.payload && typeof payload.payload == "object"
						? payload.payload
						: null;
				}
				let queuedMessage = await reviewer._updateSessionPendingMessage(current.context, sessionID, queueID, patch);
				return Object.assign({
					ok: true,
					queue_message: queuedMessage,
				}, await automationChatState(current, sessionID, null, {
					historyLimit: payload?.history_limit || payload?.historyLimit,
				}));
			},
		});

		define({
			id: "automation.chat.queue.remove",
			description: "Remove one pending queued or steer message from the active Automation session.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				let queueID = String(payload?.queue_id || payload?.queueID || "").trim();
				if (!queueID) {
					throw new Error("queue_id is required.");
				}
				await reviewer._activateSessionContext(current, sessionID);
				current.sessionID = sessionID;
				let removedMessage = await reviewer._removeSessionPendingMessage(current.context, sessionID, queueID);
				return Object.assign({
					ok: true,
					removed_message: removedMessage,
				}, await automationChatState(current, sessionID, null, {
					historyLimit: payload?.history_limit || payload?.historyLimit,
				}));
			},
		});

		define({
			id: "automation.chat.queue.consume_next",
			description: "Consume the next pending queued or steer message for the active Automation session.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				await reviewer._activateSessionContext(current, sessionID);
				current.sessionID = sessionID;
				let queueMessage = await reviewer._consumeSessionPendingMessage(current.context, sessionID, {
					mode: String(payload?.mode || "").trim(),
				});
				return Object.assign({
					ok: true,
					queue_message: queueMessage || null,
				}, await automationChatState(current, sessionID, null, {
					historyLimit: payload?.history_limit || payload?.historyLimit,
				}));
			},
		});

		define({
			id: "automation.chat.send",
			description: "Send one user message through the current Automation workspace session and return the refreshed workspace bootstrap payload.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let message = String(payload?.message || "").trim();
				if (!message) {
					throw new Error("message is required.");
				}
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				await reviewer._sessionMessage(current, sessionID, message, {
					origin: "ui",
					emitProgress: false,
				});
				current.sessionID = sessionID;
				return await automationBootstrap(current, payload || {});
			},
		});

		define({
			id: "automation.chat.begin",
			description: "Begin one Automation workspace chat run and return the initial live session state.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationBeginChatRun(current, payload || {});
			},
		});

		define({
			id: "automation.chat.poll",
			description: "Poll the current Automation workspace chat session for live timeline updates.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let runID = String(payload?.run_id || payload?.runID || "").trim();
				let run = runID ? (automationChatRuns.get(runID) || null) : null;
				let sessionID = String(payload?.session_id || payload?.sessionID || run?.sessionID || current?.sessionID || "").trim();
				return await automationChatState(current, sessionID, run, {
					historyLimit: payload?.history_limit || payload?.historyLimit,
				});
			},
		});

		define({
			id: "automation.chat.stop",
			description: "Stop the currently running Automation chat run for the active session.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let runID = String(payload?.run_id || payload?.runID || "").trim();
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				let run = runID
					? (automationChatRuns.get(runID) || activeAutomationChatRun(current, sessionID))
					: activeAutomationChatRun(current, sessionID);
				if (!run) {
					return Object.assign({
						ok: true,
						stopped: false,
					}, await automationChatState(current, sessionID, null, {
						historyLimit: payload?.history_limit || payload?.historyLimit,
					}));
				}
				run.cancel("Session run stopped by user.");
				return Object.assign({
					ok: true,
					stopped: true,
				}, await automationChatState(current, sessionID, run, {
					historyLimit: payload?.history_limit || payload?.historyLimit,
				}));
			},
		});

		define({
			id: "automation.autodrive.prompt_defaults",
			description: "Render the project-aware default Auto Drive prompt and available reviewer modes.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationAutoDrivePromptDefaults(current, payload || {});
			},
		});

		define({
			id: "automation.autodrive.begin",
			description: "Begin a managed Auto Drive run for the active Automation session.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationBeginAutoDriveRun(current, payload || {});
			},
		});

		define({
			id: "automation.autodrive.stop",
			description: "Stop the running Auto Drive session if one is active.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let runID = String(payload?.run_id || payload?.runID || "").trim();
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				let run = runID
					? (automationChatRuns.get(runID) || activeAutomationChatRun(current, sessionID))
					: activeAutomationChatRun(current, sessionID);
				if (!run || String(run?.kind || "").trim() != "autodrive") {
					return Object.assign({
						ok: true,
						stopped: false,
					}, await automationChatState(current, sessionID, run || null, {
						historyLimit: payload?.history_limit || payload?.historyLimit,
					}));
				}
				run.cancel("Auto Drive stopped by user.");
				return Object.assign({
					ok: true,
					stopped: true,
				}, await automationChatState(current, sessionID, run, {
					historyLimit: payload?.history_limit || payload?.historyLimit,
				}));
			},
		});

		define({
			id: "automation.autodrive.status",
			description: "Return the active Auto Drive run state for the current Automation session.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				let run = activeAutomationChatRun(current, sessionID);
				return Object.assign({
					ok: true,
					autodrive_active: !!(run && String(run?.kind || "").trim() == "autodrive"),
				}, await automationChatState(current, sessionID, run, {
					historyLimit: payload?.history_limit || payload?.historyLimit,
				}));
			},
		});

		define({
			id: "automation.scope.list",
			description: "List valid project scopes for backend automation in the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return {
					ok: true,
					project_id: current.context.projectID,
					scopes: SystematicReviewerWorkflowScreening.availableScopes(reviewer, current) || [],
				};
			},
		});

		define({
			id: "automation.explore.run",
			description: "Run one scope-driven Explore analysis using the active Automation session runtime and save batch/final artifacts.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let message = String(payload?.prompt || payload?.message || "").trim();
				if (!message) {
					throw new Error("prompt is required.");
				}
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				await reviewer._activateSessionContext(current, sessionID);
				current.sessionID = sessionID;
				let result = await runAutomationExploreSession(current, sessionID, message, payload || {}, null);
				return {
					ok: true,
					chat: result?.chat
						? {
							id: String(result.chat.id || "").trim(),
							name: String(result.chat.name || "").trim(),
							path: String(result.chat.path || "").trim(),
							markdown_path: String(result.chat.markdown_path || result.markdown_path || "").trim(),
						}
						: null,
					completion_status: String(result?.completion_status || "").trim(),
					scope: result?.scope || null,
					selection: result?.selection || null,
					runtime: result?.runtime || null,
					reply: String(result?.reply || "").trim(),
					reply_source: String(result?.reply_source || "").trim(),
					summary_path: String(result?.summary_path || "").trim(),
					retry_summary: result?.retry_summary || null,
					batches: Array.isArray(result?.batches) ? result.batches : [],
				};
			},
		});

		define({
			id: "automation.explore.listRuns",
			description: "List saved Automation-native Explore runs for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowExplore.listAutomationRuns({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "automation.explore.listBatches",
			description: "List saved batches for one Automation-native Explore run.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowExplore.listAutomationBatches({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "automation.explore.loadBatch",
			description: "Load one saved Automation-native Explore batch by chat id and batch index.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await SystematicReviewerWorkflowExplore.loadAutomationBatch({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "automation.explore.publishAppendix",
			description: "Publish one Automation-native Explore batch or final synthesis into the report appendices.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let chat = await SystematicReviewerWorkflowExplore.loadChat({
					reviewer,
					current,
					payload: payload || {},
				});
				let chatRecord = chat?.chat || null;
				if (!chatRecord) {
					throw new Error("Explore run was not found.");
				}
				let mode = String(payload?.mode || payload?.target || "").trim().toLowerCase();
				let markdown = "";
				if (mode == "summary" || payload?.batch_index === undefined && payload?.batchIndex === undefined) {
					markdown = [
						markdownHeadingBlock(
							`${new Date().toISOString()} ${String(chatRecord?.name || "Explore Output").trim()}`,
							[
								`- Scope: ${String(chatRecord?.scope_name || "").trim() || "(not recorded)"}`,
								`- Rows: ${Number(chatRecord?.row_count || 0) || 0}`,
								`- Batches: ${Number(chatRecord?.batch_count || 0) || 0}`,
							]
						),
						"",
						String(chatRecord?.final_reply || "").trim(),
					].join("\n");
				}
				else {
					let batch = await SystematicReviewerWorkflowExplore.loadAutomationBatch({
						reviewer,
						current,
						payload: payload || {},
					});
					markdown = [
						markdownHeadingBlock(
							`${new Date().toISOString()} ${String(chatRecord?.name || "Explore Batch").trim()} Batch ${Number(batch?.batch_index || 0) + 1}`,
							[
								`- Scope: ${String(batch?.scope_name || chatRecord?.scope_name || "").trim() || "(not recorded)"}`,
								`- Rows: ${Number(batch?.row_count || 0) || 0}`,
							]
						),
						"",
						String(batch?.content || "").trim(),
					].join("\n");
				}
				let artifact = await recordExploreAppendixArtifact(current, markdown);
				return {
					ok: true,
					artifact_path: artifact?.path || "",
				};
			},
		});

		define({
			id: "automation.jobs.open",
			description: "Open or focus the SR Jobs tab for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let tab = await reviewer._openJobsTab(null, current);
				return {
					ok: true,
					tab_id: tab?.id || "",
				};
			},
		});

		define({
			id: "automation.document.render",
			description: "Render one Automation workspace markdown document using the current project citation scope and editor settings.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationRenderedState(current, payload || {});
			},
		});

		define({
			id: "automation.document.save",
			description: "Save REPORT.md for the current project from the Automation workspace and return refreshed rendered output.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationSaveMarkdown(current, payload || {});
			},
		});

			define({
				id: "automation.document.log.read",
				description: "Load the project workflow log markdown from log.txt for the Automation workspace.",
				tab: "automation",
				execute: async (payload = {}) => {
					let current = await requireCurrentProject(payload || {});
					return await automationLogRead(current);
				},
			});

			define({
				id: "automation.document.memory.read",
				description: "Load active-memory.txt and memory.txt for the Automation workspace.",
				tab: "automation",
				execute: async (payload = {}) => {
					let current = await requireCurrentProject(payload || {});
					return await automationMemoryRead(current);
				},
			});

			define({
				id: "automation.document.rollback.list",
				description: "List REPORT.md rollback snapshots for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return {
					ok: true,
					snapshots: await automationRollbackSnapshots(current, payload || {}),
				};
			},
		});

		define({
			id: "automation.document.rollback.diff",
			description: "Diff the current saved REPORT.md against one rollback snapshot.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationRollbackDiff(current, payload || {});
			},
		});

		define({
			id: "automation.document.rollback.restore",
			description: "Restore REPORT.md from one rollback snapshot, saving the overwritten current report back into rollback history first.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationRollbackRestore(current, payload || {});
			},
		});

		define({
			id: "automation.document.editorSettings.save",
			description: "Save Automation workspace editor settings for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let settings = await automationProjectSettings(current);
				let editorSettings = automationEditorSettings(settings, payload || {});
				let nextSettings = Object.assign({}, settings, { editor: editorSettings });
				await reviewer._writeJSONFile(current.context.settingsPath, nextSettings);
				let result = {
					ok: true,
					settings: editorSettings,
				};
				let surface = String(payload?.surface || payload?.mode || "").trim().toLowerCase();
				if (surface == "continuous") {
					surface = "preview";
				}
				if (["preview", "native", "both"].includes(surface)) {
					Object.assign(result, await automationRenderedState(current, {
						markdown: await automationMarkdown(current, payload || {}),
						editor_settings: editorSettings,
						surface,
					}));
				}
				return result;
			},
		});

		define({
			id: "automation.document.export",
			description: "Export the current Automation workspace document in the selected format using the current project citation scope and editor settings.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationExport(current, payload || {});
			},
		});

		define({
			id: "automation.document.export.saveAs",
			description: "Choose an export path, queue an Automation export job, and track it in Jobs.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationExportSaveAs(current, payload || {});
			},
		});

		define({
			id: "automation.document.exportPdf",
			description: "Export the current Automation workspace document to PDF using the current project citation scope and editor settings.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationExportPDF(current, payload || {});
			},
		});

		define({
			id: "automation.document.exportPdf.saveAs",
			description: "Choose a PDF path, queue an Automation PDF export job, and track it in Jobs.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationExportPDFSaveAs(current, payload || {});
			},
		});

		define({
			id: "automation.document.exportDocx",
			description: "Export the current Automation workspace document to DOCX using the current project citation scope and editor settings.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationExportDOCX(current, payload || {});
			},
		});

		define({
			id: "automation.document.exportDocx.saveAs",
			description: "Choose a DOCX path, queue an Automation DOCX export job, and track it in Jobs.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationExportDOCXSaveAs(current, payload || {});
			},
		});

		define({
			id: "automation.document.exportPlainMarkdown",
			description: "Export the current Automation workspace document to plain rendered markdown using the current project citation scope and editor settings.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationExportPlainMarkdown(current, payload || {});
			},
		});

		define({
			id: "automation.document.exportPlainMarkdown.saveAs",
			description: "Choose a Markdown path, queue an Automation plain Markdown export job, and track it in Jobs.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationExportPlainMarkdownSaveAs(current, payload || {});
			},
		});

		define({
			id: "automation.document.importImage",
			description: "Open a native image picker and copy the chosen image next to REPORT.md for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationImportImage(current, payload || {});
			},
		});

		define({
			id: "automation.citation.catalog",
			description: "List citable project items for the Automation workspace citation picker.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return {
					ok: true,
					items: await automationCitationCatalog(current),
				};
			},
		});

		define({
			id: "automation.citation.preview",
			description: "Resolve Automation workspace citation tokens and bibliography output for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				return await automationCitationPreview(current, payload || {});
			},
		});

		define({
			id: "manual.read",
			description: "Read packaged systematic-review workflow manuals for the current project, including stage guidance, action examples, and reporting expectations.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let normalizeID = (value = "") => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
				let defaultStageForNamespace = (namespace = "") => {
					let clean = normalizeID(namespace);
					if (!clean) {
						return "";
					}
					if (["embeddings", "semantic"].includes(clean)) {
						return "evidence_search";
					}
					if (clean == "full_text") {
						return "full_text_retrieval";
					}
					if (clean == "explore") {
						return "explore_synthesis";
					}
					if (["workspace", "automation_document"].includes(clean)) {
						return "report_writing";
					}
					return clean;
				};
				let actionIDs = [];
				if (Array.isArray(payload.action_ids || payload.actionIds || payload.actions)) {
					actionIDs = (payload.action_ids || payload.actionIds || payload.actions).map((entry) => normalizeID(entry)).filter(Boolean);
				}
				else if (payload.action || payload.action_id || payload.actionId) {
					actionIDs = [normalizeID(payload.action || payload.action_id || payload.actionId)].filter(Boolean);
				}
				let namespace = normalizeID(payload.namespace || "");
				let stageID = normalizeID(payload.stage || payload.stage_id || payload.stageId || defaultStageForNamespace(namespace));
				let workflowID = normalizeID(payload.workflow || payload.workflow_id || payload.workflowId)
					|| (isSystematicReviewProject(current) ? "systematic_review_full" : "custom_analysis");
				let bundle = await SystematicReviewerAutomationDocs.bundle(reviewer, {
					workflow_id: workflowID,
					stage_id: stageID,
					action_ids: actionIDs,
				});
				let sections = [];
				for (let entry of Array.isArray(bundle?.shared) ? bundle.shared : []) {
					sections.push(`## ${entry.title}\n\n${String(entry.markdown || "").trim()}`);
				}
				if (bundle?.workflow?.markdown) {
					sections.push(`## ${bundle.workflow.title}\n\n${String(bundle.workflow.markdown || "").trim()}`);
				}
				if (bundle?.stage?.markdown) {
					sections.push(`## ${bundle.stage.title}\n\n${String(bundle.stage.markdown || "").trim()}`);
				}
				for (let action of Array.isArray(bundle?.actions) ? bundle.actions : []) {
					sections.push(`## ${action.title}\n\n${String(action.markdown || "").trim()}`);
				}
				return {
					ok: true,
					workflow_id: workflowID,
					stage_id: stageID,
					action_ids: actionIDs,
					question: String(payload.question || "").trim(),
					guidance_markdown: sections.join("\n\n").trim(),
					bundle,
				};
			},
		});

		define({
			id: "harvest.getConfig",
			description: "Load Harvest form options, OpenAlex filter metadata, and current API credit status.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let settings = await reviewer._globalSettings();
				return await SystematicReviewerWorkflowHarvest.getHarvestConfig({
					reviewer,
					current,
					settings,
					payload: payload || {},
				});
			},
		});

		define({
			id: "harvest.getRateLimit",
			description: "Refresh OpenAlex API credit status for the saved plugin key.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload || {});
				let settings = await reviewer._globalSettings();
				return await SystematicReviewerWorkflowHarvest.getHarvestConfig({
					reviewer,
					current,
					settings,
					payload: Object.assign({}, payload || {}, { refresh_rate_limit: true }),
				});
			},
		});

		define({
			id: "harvest.run",
			description: "Run an OpenAlex harvest, save raw NDJSON plus summary JSON, and import supported identifiers into the current Zotero project's Harvest/OpenAlex subcollection.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let settings = await reviewer._globalSettings();
				let capabilities = await workflowCapabilities(current).catch(() => ({ embeddings_available: false }));
				let postImportAction = SystematicReviewerWorkflowHarvest?.normalizePostImportAction
					? SystematicReviewerWorkflowHarvest.normalizePostImportAction(
						payload?.post_import_action ?? payload?.postImportAction ?? "",
						!!capabilities?.embeddings_available,
						{ context: "openalex" }
					)
					: normalizeHarvestPostImportAction(
						payload?.post_import_action ?? payload?.postImportAction ?? "",
						!!capabilities?.embeddings_available
					);
				let result = await SystematicReviewerWorkflowHarvest.runHarvest({
					reviewer,
					current,
					context: current.context,
					settings,
					payload,
				});
				result.post_import_action = postImportAction;
				await recordWorkflowMarkdownArtifact(current, "harvest", String(result?.mode || "run") == "estimate" ? "harvest-estimate" : "harvest-run", markdownHeadingBlock(
					`${new Date().toISOString()} Harvest ${String(result?.mode || "run").trim() == "estimate" ? "Estimate" : "Run"}`,
					harvestLogLines(result, payload, postImportAction).concat([
						result?.auto_followup?.merge_queue ? `- Merge jobs queued: ${Number(result.auto_followup.merge_queue.merged_sources || 0) || 0} Harvest source collection merge(s).` : "",
						String(result?.auto_followup?.merge_queue_error || "").trim() ? `- Merge queue error: ${String(result.auto_followup.merge_queue_error).trim()}` : "",
						result?.auto_followup?.embeddings_job ? `- Embeddings queued: job ${String(result.auto_followup.embeddings_job.job_id || "").trim()}.` : "",
						String(result?.auto_followup?.embeddings_skipped_reason || "").trim() ? `- Embeddings skipped: ${String(result.auto_followup.embeddings_skipped_reason).trim()}` : "",
						String(result?.auto_followup?.embeddings_error || "").trim() ? `- Embeddings error: ${String(result.auto_followup.embeddings_error).trim()}` : "",
					].filter(Boolean))
				));
				return result;
			},
		});

		define({
			id: "harvest.runQueued",
			description: "Queue an OpenAlex harvest in the background using the durable resumable harvest run engine.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let settings = await reviewer._globalSettings();
				return await SystematicReviewerWorkflowHarvest.runHarvest({
					reviewer,
					current,
					context: current.context,
					settings,
					payload: Object.assign({}, payload || {}, {
						detach: true,
					}),
				});
			},
		});

		define({
			id: "harvest.estimate",
			description: "Estimate OpenAlex result counts for a harvest query before writing NDJSON and importing into Zotero.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let settings = await reviewer._globalSettings();
				let defaults = {
					openalexApiKey: settings?.openalex_api_key || "",
				};
				let options = SystematicReviewerWorkflowSearchOptions.normalizeRequest(
					Object.assign({}, payload, { searchMode: "estimate" }),
					defaults
				);
				let result = await SystematicReviewerWorkflowHarvest.estimateHarvest({
					reviewer,
					current,
					context: current.context,
					options,
					attachmentFetchMode: "included_only",
				});
				await recordWorkflowMarkdownArtifact(current, "harvest", "harvest-estimate", markdownHeadingBlock(
					`${new Date().toISOString()} Harvest Estimate`,
					harvestLogLines(result, payload, "")
				));
				return result;
			},
		});

		define({
			id: "harvest.listOutputs",
			description: "List saved harvest summary reports for the current project, including linked NDJSON output paths.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					outputs: await SystematicReviewerWorkflowHarvest.listOutputs(reviewer, current.context),
				};
			},
		});

		define({
			id: "harvest.listRuns",
			description: "List persisted OpenAlex harvest runs and their durable checkpoints for the current project.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowHarvest.listRuns(reviewer, current, payload || {});
			},
		});

		define({
			id: "harvest.run.stop",
			description: "Stop one queued or running durable OpenAlex harvest run.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowHarvest.stopHarvestRun({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "harvest.run.continue",
			description: "Continue one interrupted, failed, or canceled durable OpenAlex harvest run.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowHarvest.continueHarvestRun({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "harvest.run.restart",
			description: "Restart one durable OpenAlex harvest run from page 1 with fresh artifacts.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowHarvest.restartHarvestRun({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "harvest.listSources",
			description: "List Harvest source subcollections plus the standard review target collections for the current project.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowHarvest.listSources(reviewer, current);
			},
		});

		define({
			id: "harvest.import",
			description: "Launch the project import flow for the currently open project from the Harvest tab.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let win = reviewer._primaryWindow?.() || null;
				return await reviewer._openProjectImportDialog(win, current, {
					source: "harvest_tab",
					post_import_action: payload?.post_import_action ?? payload?.postImportAction ?? "",
				});
			},
		});

		define({
			id: "harvest.mergeSource",
			description: "Queue one backend Harvest source merge into Pending with exact-ID deduplication into Duplicates, with optional follow-up Pending title+abstract embeddings.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let showMergeNotice = !!String(payload?.tab_id || payload?.tabID || "").trim();
				return await SystematicReviewerWorkflowHarvest.mergeSourceIntoPending({
					reviewer,
					current,
					payload: payload || {},
					options: {
						targetWin: showMergeNotice ? (reviewer._primaryWindow?.() || null) : null,
						openJobsTab: false,
						refreshControllers: false,
						showMergeNotice,
						queue_origin: "harvest.mergeSource",
					},
				});
			},
		});

		define({
			id: "harvest.mergeAllSources",
			description: "Queue backend merge jobs for every direct Harvest source subcollection, with optional follow-up Pending title+abstract embeddings.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let showMergeNotice = !!String(payload?.tab_id || payload?.tabID || "").trim();
				return await SystematicReviewerWorkflowHarvest.mergeAllSourcesIntoPending({
					reviewer,
					current,
					payload: payload || {},
					options: {
						targetWin: showMergeNotice ? (reviewer._primaryWindow?.() || null) : null,
						openJobsTab: false,
						refreshControllers: false,
						showMergeNotice,
						queue_origin: "harvest.mergeAllSources",
					},
				});
			},
		});

		define({
			id: "harvest.readOutput",
			description: "Read one saved harvest summary report for the current project.",
			tab: "harvest",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowHarvest.readOutput(reviewer, current.context, payload || {});
			},
		});

		define({
			id: "embeddings.listSources",
			description: "List available embedding text sources for the current project or one scoped subcollection.",
			tab: "embeddings",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					sources: await SystematicReviewerWorkflowEmbeddings.listSources(reviewer, current, payload || {}),
				};
			},
		});

		define({
			id: "embeddings.listStored",
			description: "List stored embedding vectors for the current project.",
			tab: "embeddings",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					stored: await SystematicReviewerWorkflowEmbeddings.listStored(reviewer, current.context),
				};
			},
		});

		define({
			id: "embeddings.refresh",
			description: "Refresh embedding sources and stored vectors for the current project or one scoped subcollection.",
			tab: "embeddings",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowEmbeddings.refreshState(reviewer, current, payload || {});
			},
		});

		define({
			id: "embeddings.run",
			description: "Create embeddings for the current project or one scoped subcollection and store them in project SQLite blobs, including chunked Full Text vectors.",
			tab: "embeddings",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowEmbeddings.runEmbeddings({
					reviewer,
					current,
					payload: payload || {},
				});
				return result;
			},
		});

		define({
			id: "semantic.getConfig",
			description: "Load semantic-search scopes, current embeddings-model-compatible sources, and existing semantic score columns.",
			tab: "semantic",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowSemanticSearch.getConfig({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "semantic.search",
			description: "Run brute-force cosine semantic search over the current project or one scoped subcollection using stored embeddings, including Full Text chunk search.",
			tab: "semantic",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowSemanticSearch.search({
					reviewer,
					current,
					payload: payload || {},
				});
				return result;
			},
		});

		define({
			id: "semantic.scoreColumns.list",
			description: "List semantic score columns already written into Screening for the current project.",
			tab: "semantic",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					score_columns: await SystematicReviewerWorkflowSemanticSearch.listScoreColumns(reviewer, current.context),
				};
			},
		});

		define({
			id: "semantic.inspectScores",
			description: "Inspect one semantic score column with score bands, counts, and sampled titles/abstracts from the current project or one scoped subcollection.",
			tab: "semantic",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowSemanticSearch.inspectScores({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "semantic.previewItem",
			description: "Load one semantic-search result item from the current project or one scoped subcollection.",
			tab: "semantic",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowSemanticSearch.previewItem({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "semantic.hit.open",
			description: "Open one stored semantic full-text hit in the markdown side-by-side viewer.",
			tab: "semantic",
			execute: async (payload = {}) => {
				requireEmbeddingsCapability(await workflowCapabilities(null));
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowRAG.openSearchHit({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "documents.getConfig",
			description: "Load Find Arguments availability for the current project, including keyword backend and full-text vector readiness.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerDocumentSearch.getConfig({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "documents.find",
			description: "Find relevant project full-text documents and chunks using keyword or semantic retrieval, returning concise chat-ready markdown and openable hit metadata.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerDocumentSearch.find({
					reviewer,
					current,
					payload: payload || {},
				});
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim();
				let entry = await appendDocumentFindResultToSession(current, sessionID, result, null);
				return Object.assign(compactDocumentFindResult(result), {
					session_entry: compactSessionEntry(entry),
				});
			},
		});

		define({
			id: "documents.find_next",
			description: "Return the next page of ranked documents for a previous Find Arguments search.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerDocumentSearch.findNext({
					reviewer,
					current,
					payload: payload || {},
				});
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim();
				let entry = await appendDocumentFindResultToSession(current, sessionID, result, null);
				return Object.assign(compactDocumentFindResult(result), {
					session_entry: compactSessionEntry(entry),
				});
			},
		});

		define({
			id: "documents.hit.open",
			description: "Open one Find Arguments hit in the markdown/PDF viewer with the chunk text highlighted.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerDocumentSearch.hitOpen({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.list",
			description: "List screening records and current decisions for the active collection project or one scoped subcollection.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.listRecords({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.columns.list",
			description: "List available built-in, manual, and extraction-backed screening columns for the active collection project.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					columns: await SystematicReviewerWorkflowScreening.listAllColumnDefinitions(reviewer, current.context),
				};
			},
		});

		define({
			id: "screening.update",
			description: "Save one screening move or note update for a project item, preserving the Zotero item key.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.updateDecision({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.search",
			description: "Search screening records with paging, custom columns, and saved rules for the active project or one scoped subcollection.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.searchRecords({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.tableFromDatabase",
			description: "Build one static markdown table from scoped screening/database rows using ordered project columns and optional citation-token output.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.tableFromDatabase({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "descriptives.run",
			description: "Calculate descriptive screening statistics for one scope using optional rule-based matching, numeric stats columns, and optional item-key/citation-token details appended after the result content. Item keys default off for broad large-scope overviews and can be enabled for small or specific filtered subsets needing traceability.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowDescriptives.run({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "descriptives.runs.list",
			description: "List saved descriptives markdown artifacts from the current project workflow outputs folder.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					runs: await SystematicReviewerWorkflowDescriptives.listSavedRuns(reviewer, current.context, payload || {}),
				};
			},
		});

		define({
			id: "descriptives.run.load",
			description: "Load one saved descriptives markdown artifact by absolute path or file name from the current project workflow outputs folder.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowDescriptives.loadSavedRun({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.exportCsv",
			description: "Export Screening rows to CSV for one Screening scope or all Screening scopes, using the same Jobs-backed export engine as the UI.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.exportCSV({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.exportCsv.saveAs",
			description: "Open the native save-as picker for a Screening CSV export in the active Zotero window, then queue the same export job.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.exportCSVSaveAs({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

			define({
				id: "screening.completeTitleAbstract",
				description: "Summarize title/abstract screening completion for the current project and formalize the handoff to full-text retrieval.",
				tab: "screening",
				execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowScreening.completeTitleAbstractStage({
						reviewer,
						current,
						payload: payload || {},
					});
					await recordWorkflowMarkdownArtifact(current, "screening", "title-abstract-complete", markdownHeadingBlock(
						`${new Date().toISOString()} Title/Abstract Screening Complete`,
						[
							`- Pending survivors: ${Number(result?.summary?.pending || 0) || 0}`,
							`- Excluded at title/abstract stage: ${Number(result?.summary?.excluded || 0) || 0}`,
							`- Next stage: ${String(result?.next_recommended_stage || "full_text_retrieval").trim()}`,
					]
				));
				return result;
			},
		});

		define({
			id: "screening.item.open",
			description: "Select one screening item in the Zotero library pane.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.openItem({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.pdf.open",
			description: "Open the first PDF attached to one screening item in Zotero.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.openPdf({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.item.fulltext.open",
			description: "Open one screening item in the best available full-text surface: markdown side-by-side viewer when available, otherwise the standard PDF reader.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.openFullText({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.item.fulltext.find",
			description: "Attempt to find full text for one screening item using Zotero retrieval, then queue markdown conversion for any found PDF.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.findItemFullText({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.item.fulltext.upload",
			description: "Upload one stored-copy PDF as full text for one screening item, then queue markdown conversion.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.uploadFullTextPdf({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.scope.fulltext.status",
			description: "Inspect markdown-ready, PDF-only, and missing-full-text counts for one Screening scope, plus retrieval/conversion activity.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.inspectScopeFullText({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.scope.fulltext.excludeMissingMarkdown",
			description: "Move items without markdown full text in one Screening scope to Excluded with the PRISMA-ready full_text_not_retrieved reason.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.excludeMissingMarkdownInScope({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.fulltext.open",
			description: "Open one stored semantic full-text hit from Screening in the markdown side-by-side viewer.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowRAG.openSearchHit({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.runs.list",
			description: "List saved screening-search payloads from the current project outputs folder.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					runs: await SystematicReviewerWorkflowScreening.listSavedRuns(reviewer, current.context),
				};
			},
		});

		define({
			id: "screening.runs.load",
			description: "Load one saved screening-search payload from the current project outputs folder.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.loadSavedRun({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.runs.compare",
			description: "Compare multiple saved screening-search payloads from the current project outputs folder.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.compareSavedRuns({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.filters.list",
			description: "List saved materialized screening filters and their Zotero subcollections for the active project.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					filters: await SystematicReviewerWorkflowScreening.listMaterializedFilters(reviewer, current),
				};
			},
		});

		define({
			id: "screening.filters.materialize",
			description: "Create or resync one screening filter as a Zotero subcollection under the active project collection.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.materializeFilter({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.filters.delete",
			description: "Delete one materialized screening filter definition and optionally delete its Zotero subcollection.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.deleteMaterializedFilter({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.bulkRun",
			description: "Apply one scope-wide screening move or filter-copy action to matching records and record the action as a job.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.bulkRun({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.saveEdits",
			description: "Save queued screening edits in batches, including move targets, notes, reasons, and custom column values.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.saveEdits({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.columns.create",
			description: "Create or update one custom screening column for the active project.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.createColumn({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.columns.delete",
			description: "Delete one custom screening column and its stored values from the active project.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.deleteColumn({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.comments.update",
			description: "Save screening notes or reason text for one project item.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.updateComment({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.rules.recompute",
			description: "Apply saved screening rules to matching records and record the run as a job.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.recomputeRules({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.rules.update",
			description: "Create, update, enable, disable, or delete one saved screening rule with a target subcollection.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowScreening.updateRules({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "screening.valueTemplates.list",
			description: "List saved screening value-template snippets for the active project.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return Object.assign({ ok: true }, await SystematicReviewerWorkflowScreening.listValueTemplates(reviewer, current.context));
			},
		});

		define({
			id: "screening.valueTemplates.save",
			description: "Save screening value-template snippets for the active project.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let values = Array.isArray(payload.values) ? payload.values : [];
				return Object.assign({ ok: true }, await SystematicReviewerWorkflowScreening.saveValueTemplates(reviewer, current.context, values));
			},
		});

		define({
			id: "screening.valueTemplates.add",
			description: "Add one screening value-template snippet for the active project.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return Object.assign({ ok: true }, await SystematicReviewerWorkflowScreening.addValueTemplateValue(reviewer, current.context, payload.value || ""));
			},
		});

		define({
			id: "screening.preferences.save",
			description: "Save screening UI preferences such as visible columns for the active project.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let key = String(payload.key || "").trim();
				if (!key) {
					throw new Error("Preference key is required.");
				}
				return {
					ok: true,
					key,
					value: await SystematicReviewerWorkflowScreening.setPreference(reviewer, current.context, key, payload.value),
				};
			},
		});

		define({
			id: "prisma.getState",
			description: "Load saved PRISMA state merged with current automatic counts for the active project.",
			tab: "prisma",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowPrisma.getState({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "prisma.saveState",
			description: "Save PRISMA labels, hidden nodes, options, and manual value overrides for the active project.",
			tab: "prisma",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowPrisma.saveState({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

			define({
				id: "prisma.compute",
				description: "Compute PRISMA-style counts from the current collection project and screening decisions.",
				tab: "prisma",
				execute: async (payload = {}) => {
					let current = await requireCurrentProject(payload);
					let result = await SystematicReviewerWorkflowPrisma.compute({
						reviewer,
						current,
						payload: payload || {},
					});
					await recordWorkflowMarkdownArtifact(current, "prisma", "prisma-compute", markdownHeadingBlock(
						`${new Date().toISOString()} PRISMA Compute`,
						[
							`- Records identified: ${Number(result?.records_identified || 0) || 0}`,
							`- Full text not retrieved: ${Number(result?.records_full_text_not_retrieved || 0) || 0}`,
							`- Records included: ${Number(result?.records_included || 0) || 0}`,
						]
					));
					return result;
				},
			});

		define({
			id: "prisma.render",
			description: "Build the current visible PRISMA node groups for the active project.",
			tab: "prisma",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowPrisma.render({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "prisma.savePng",
			description: "Save one rendered PRISMA diagram PNG into the current project outputs folder.",
			tab: "prisma",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowPrisma.savePNG({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

			define({
				id: "prisma.export",
				description: "Export PRISMA state and a markdown summary into the current project outputs folder.",
				tab: "prisma",
				execute: async (payload = {}) => {
					let current = await requireCurrentProject(payload);
					let result = await SystematicReviewerWorkflowPrisma.exportState({
						reviewer,
						current,
					});
					await recordWorkflowMarkdownArtifact(current, "prisma", "prisma-export", markdownHeadingBlock(
						`${new Date().toISOString()} PRISMA Export`,
						[
							`- Export path: \`${String(result?.path || "").trim()}\``,
						]
					));
					return result;
				},
			});

		define({
			id: "extraction.sources.list",
			description: "List available extraction text sources for the current project or one scoped subcollection.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					sources: await SystematicReviewerWorkflowExtraction.listSources(reviewer, current, payload || {}),
					runtime_options: await SystematicReviewerWorkflowExtraction.listRuntimeOptions(reviewer, current),
					scope: SystematicReviewerWorkflowEmbeddings.scopeDescriptor
						? SystematicReviewerWorkflowEmbeddings.scopeDescriptor(reviewer, current, payload || {})
						: null,
					available_scopes: SystematicReviewerWorkflowEmbeddings.availableScopes
						&& payload?.include_available_scopes !== false
						? SystematicReviewerWorkflowEmbeddings.availableScopes(reviewer, current, {
							purpose: "extraction",
						})
						: [],
				};
			},
		});

		define({
			id: "extraction.results.list",
			description: "List saved extraction results and recent extraction runs for the current project or one scoped subcollection.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExtraction.listResults({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "extraction.run",
			description: "Run extraction over the current project or one scoped subcollection using one saved template and the data extraction role.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowExtraction.runExtraction({
					reviewer,
					current,
					payload: payload || {},
					single: false,
				});
				return result;
			},
		});

		define({
			id: "extraction.runSingle",
			description: "Run extraction for one project item inside the current project or one scoped subcollection using one saved template and the data extraction role.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowExtraction.runExtraction({
					reviewer,
					current,
					payload: payload || {},
					single: true,
				});
				return result;
			},
		});

		define({
			id: "extraction.updateFields",
			description: "Save manual extraction field values for one record and template in the current project.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExtraction.updateFields({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "fullText.startRetrieval",
			description: "Start Zotero full-text/PDF retrieval for the current Pending scope and record retrieval watch state.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowFullText.startRetrieval({
					reviewer,
					current,
					payload: payload || {},
				});
				await recordWorkflowMarkdownArtifact(current, "full-text", "full-text-retrieval-start", markdownHeadingBlock(
					`${new Date().toISOString()} Full-Text Retrieval Started`,
					[
						`- Requested records: ${Number(result?.requested_count || 0) || 0}`,
						`- Already with PDFs: ${Number(result?.with_pdf_count || 0) || 0}`,
						`- Missing PDFs: ${Number(result?.missing_pdf_count || 0) || 0}`,
					]
				));
				return result;
			},
		});

			define({
				id: "fullText.status",
				description: "Inspect current full-text retrieval state, newly found PDFs, and quiet-window readiness for finalizing unretrieved items.",
				tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowFullText.status({
					reviewer,
					current,
					payload: payload || {},
				});
				},
			});

			define({
				id: "fullText.listItems",
				description: "List retrieved and unretrieved full-text records for the current scope with citation tokens and titles.",
				tab: "screening",
				execute: async (payload = {}) => {
					let current = await requireCurrentProject(payload);
					return await SystematicReviewerWorkflowFullText.listItems({
						reviewer,
						current,
						payload: payload || {},
					});
				},
			});

			define({
				id: "fullText.queueConversions",
				description: "Queue markdown conversions for all newly available PDFs in the current full-text scope using the configured PDF mode.",
				tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowFullText.queueConversions({
					reviewer,
					current,
					payload: payload || {},
				});
				await recordWorkflowMarkdownArtifact(current, "full-text", "full-text-conversions", markdownHeadingBlock(
					`${new Date().toISOString()} Full-Text Markdown Conversion Queue`,
					[
						`- Requested mode: ${String(result?.requested_mode || "").trim() || "(not recorded)"}`,
						`- Jobs queued: ${Number(result?.queued_count || 0) || 0}`,
					]
				));
					return result;
				},
			});

			define({
				id: "fullText.conversionStatus",
				description: "Inspect queued, running, succeeded, and failed markdown conversion jobs for the current full-text scope.",
				tab: "screening",
				execute: async (payload = {}) => {
					let current = await requireCurrentProject(payload);
					return await SystematicReviewerWorkflowFullText.conversionStatus({
						reviewer,
						current,
						payload: payload || {},
					});
				},
			});

		define({
			id: "fullText.finalizeUnretrieved",
			description: "Move unretrieved full-text records from Pending into Excluded with the PRISMA-ready full_text_not_retrieved reason.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowFullText.finalizeUnretrieved({
					reviewer,
					current,
					payload: payload || {},
				});
				await recordWorkflowMarkdownArtifact(current, "full-text", "full-text-unretrieved", markdownHeadingBlock(
					`${new Date().toISOString()} Full-Text Retrieval Finalized`,
					[
						`- Moved to Excluded: ${Number(result?.moved_count || 0) || 0}`,
						`- Reason code: ${String(result?.reason_code || "").trim() || SystematicReviewerWorkflowFullText.NOT_RETRIEVED_REASON}`,
					]
				));
				return result;
			},
		});

		define({
			id: "fullText.completeInclusion",
			description: "After full-text eligibility exclusions are complete, move the remaining Pending items into Included and switch downstream scope to Included.",
			tab: "screening",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowFullText.completeInclusion({
					reviewer,
					current,
					payload: payload || {},
				});
				let nextScopeKey = String(result?.default_results_scope?.collection_key || "").trim();
				if (nextScopeKey) {
					result.workflow_ui = await saveWorkflowUIState(
						current.context,
						SystematicReviewerWorkflowManifest.listTabs(current?.projectType || ""),
						{ last_scope_key: nextScopeKey }
					);
				}
				await recordWorkflowMarkdownArtifact(current, "full-text", "full-text-inclusion-complete", markdownHeadingBlock(
					`${new Date().toISOString()} Full-Text Inclusion Complete`,
					[
						`- Moved to Included: ${Number(result?.moved_count || 0) || 0}`,
						`- Default downstream scope: ${String(result?.default_results_scope?.collection_name || "Included").trim()}`,
					]
				));
				return result;
			},
		});

		define({
			id: "jobs.list",
			description: "List recent plugin jobs for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					jobs: await SystematicReviewerWorkflowJobs.listJobs(reviewer, current, payload || {}),
				};
			},
		});

		define({
			id: "jobs.load",
			description: "Load one plugin job and its logs for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowJobs.loadJob(reviewer, current, payload || {});
			},
		});

		define({
			id: "jobs.global.list",
			description: "List recent plugin jobs across all stored projects.",
			tab: "workflow",
			execute: async (payload = {}) => {
				return await SystematicReviewerWorkflowJobs.listGlobalJobs(reviewer, payload || {});
			},
		});

		define({
			id: "jobs.global.load",
			description: "Load one plugin job and its logs from the global jobs hub.",
			tab: "workflow",
			execute: async (payload = {}) => {
				return await SystematicReviewerWorkflowJobs.loadGlobalJob(reviewer, payload || {});
			},
		});

		define({
			id: "jobs.global.control",
			description: "Stop, continue, or restart one plugin job from the global jobs hub.",
			tab: "workflow",
			execute: async (payload = {}) => {
				return await SystematicReviewerWorkflowJobs.controlGlobalJob(reviewer, payload || {});
			},
		});

		define({
			id: "project_data.schema",
			description: "Safely list project data scopes, row counts, and available columns before any paged row inspection.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.projectDataSchema({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "project_data.rows",
			description: "Inspect one safe paged window of project data rows with limit capped at 25 and explicit column selection.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.projectDataRows({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "project_data.row",
			description: "Inspect one project data row by Zotero item key with optional explicit columns.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.projectDataRow({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "items.create",
			description: "Create one manual Zotero item in an explicit in-project collection target.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await itemsCreate(current, payload || {});
			},
		});

		define({
			id: "items.create_many",
			description: "Create up to 50 manual Zotero items in an explicit in-project collection target.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await itemsCreateMany(current, payload || {});
			},
		});

		define({
			id: "items.read_metadata",
			description: "Read one existing Zotero item as native Zotero item JSON plus supported native field names. Use only when allowed and asked by the user to inspect item metadata, or when working on imports of custom data into projects yourself and better metadata support is needed.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await itemsReadMetadata(current, payload || {});
			},
		});

		define({
			id: "items.write_metadata",
			description: "Write native Zotero metadata fields on one existing Zotero item by item key. Use only when allowed and asked by the user to edit metadata of items, or when working on imports of custom data into projects yourself and better metadata support is needed. Item keys cannot be changed.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await itemsUpdateMetadata(current, payload || {});
			},
		});

		define({
			id: "items.update_metadata",
			description: "Alias for items.write_metadata.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await itemsUpdateMetadata(current, payload || {});
			},
		});

		define({
			id: "items.update_metadata_many",
			description: "Alias for items.write_metadata_many.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await itemsUpdateMetadataMany(current, payload || {});
			},
		});

		define({
			id: "items.write_metadata_many",
			description: "Write native Zotero metadata fields on up to 50 existing Zotero items by item key. Use only when allowed and asked by the user to edit metadata of items, or when working on imports of custom data into projects yourself and better metadata support is needed. Item keys cannot be changed.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await itemsUpdateMetadataMany(current, payload || {});
			},
		});

		define({
			id: "items.import_identifiers",
			description: "Import DOI/PMID/PMCID/arXiv/ISBN identifiers through Zotero translators into an explicit in-project collection target.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await itemsImportIdentifiers(current, payload || {});
			},
		});

		define({
			id: "explore.getConfig",
			description: "Load Explore scopes, columns, chats, prompt defaults, and settings-driven runtime choices for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.getConfig({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.snapshot",
			description: "Inspect report, sessions, jobs, and artifact files for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.snapshot({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.columns.list",
			description: "List project data columns available to the native Explore query surface for the current project or one scoped subcollection.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.listColumns({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.citations.suggest",
			description: "Suggest scoped Explore citation tokens in @[ITEMKEY] format for the current project or one scoped subcollection.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.suggestCitations({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.query",
			description: "Run a native Explore query over project records in the current project or one scoped subcollection, with optional filters and saved output.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowExplore.query({
					reviewer,
					current,
					payload: payload || {},
				});
				if (result?.path) {
					await recordWorkflowMarkdownArtifact(current, "explore", "explore-query", markdownHeadingBlock(
						`${new Date().toISOString()} Explore Query`,
						[
							`- Query: ${String(result?.result?.query || payload?.query || "").trim() || "(not recorded)"}`,
							`- Saved run: \`${String(result?.path || "").trim()}\``,
							`- Total results: ${Number(result?.result?.total_results || 0) || 0}`,
						]
					));
				}
				return result;
			},
		});

		define({
			id: "explore.tables.saveCsv",
			description: "Save one Explore Markdown table into a CSV file inside the current project outputs folder.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.saveTableCSV({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.exportCsv",
			description: "Export the current Explore query selection into a CSV file in the project outputs folder for the current project or one scoped subcollection.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.exportCSV({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.chats.list",
			description: "List saved Explore chats for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					chats: await SystematicReviewerWorkflowExplore.listChats(reviewer, current.context),
				};
			},
		});

		define({
			id: "explore.chats.create",
			description: "Create a new saved Explore chat for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.createChat({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.chats.load",
			description: "Load one saved Explore chat for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.loadChat({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.chats.update",
			description: "Update saved Explore chat settings for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.updateChat({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.chats.run",
			description: "Run one Explore chat request over rows from the current project or one scoped subcollection using the selected settings-driven runtime role and save the reply.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let sessionID = String(payload?.session_id || payload?.sessionID || current?.sessionID || "").trim()
					|| await reviewer._ensureActiveSession(current.context);
				await reviewer._activateSessionContext(current, sessionID);
				current.sessionID = sessionID;
				let result = await SystematicReviewerWorkflowExplore.runChat({
					reviewer,
					current,
					payload: Object.assign({}, payload || {}, {
						session_id: sessionID,
					}),
				});
				if (String(result?.reply || "").trim()) {
					await appendExploreResultToSession(current, sessionID, result, result?.selection?.scope || result?.scope || null, null);
				}
				await recordWorkflowMarkdownArtifact(current, "explore", "explore-chat", markdownHeadingBlock(
					`${new Date().toISOString()} Explore Synthesis`,
					[
						`- Prompt: ${String(payload?.prompt || "").trim() || "(not recorded)"}`,
						`- Reply saved: \`${String(result?.chat?.path || "").trim()}\``,
						`- Selection rows: ${Number(result?.selection?.row_count || 0) || 0}`,
						`- Final reply: ${String(result?.reply || "").trim() || "(empty)"}`,
					]
				));
				return result;
			},
		});

		define({
			id: "explore.runs.list",
			description: "List saved Explore query outputs for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					runs: await SystematicReviewerWorkflowExplore.listSavedRuns(reviewer, current.context),
				};
			},
		});

		define({
			id: "explore.runs.load",
			description: "Load one saved Explore query output for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.loadSavedRun({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.session.load",
			description: "Load one saved session transcript and timeline for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.loadSessionDetail({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "explore.job.load",
			description: "Load one saved job and its logs for the current project.",
			tab: "automation",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExplore.loadJobDetail({
					reviewer,
					current,
					payload: payload || {},
				});
			},
		});

		define({
			id: "extraction.templates.list",
			description: "List extraction templates stored for the current project.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return {
					ok: true,
					templates: await SystematicReviewerWorkflowExtractionTemplates.listTemplates(reviewer, current.context),
				};
			},
		});

		define({
			id: "extraction.templates.load",
			description: "Load one extraction template for the current project.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExtractionTemplates.loadTemplate(reviewer, current.context, payload || {});
			},
		});

		define({
			id: "extraction.templates.save",
			description: "Save an extraction template to the current project.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowExtractionTemplates.saveTemplate(reviewer, current.context, payload || {}, { createNew: false });
				await syncExtractionTemplateAppendix(current);
				return result;
			},
		});

		define({
			id: "extraction.templates.create",
			description: "Create a new extraction template in the current project.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowExtractionTemplates.saveTemplate(reviewer, current.context, payload || {}, { createNew: true });
				await syncExtractionTemplateAppendix(current);
				return result;
			},
		});

		define({
			id: "extraction.templates.bootstrapDefault",
			description: "Return the primary extraction template for the current project, or the first available project-local template.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowExtractionTemplates.loadBootstrapTemplate(
					reviewer,
					current.context,
					current.projectType || ""
				);
				await syncExtractionTemplateAppendix(current);
				return Object.assign({ ok: true, template: result || null }, result || {});
			},
		});

		define({
			id: "extraction.templates.export",
			description: "Export one saved extraction template from the current project as YAML content.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				return await SystematicReviewerWorkflowExtractionTemplates.exportTemplate(reviewer, current.context, payload || {});
			},
		});

		define({
			id: "extraction.templates.import",
			description: "Import one extraction template YAML file into the current project.",
			tab: "extraction",
			execute: async (payload = {}) => {
				let current = await requireCurrentProject(payload);
				let result = await SystematicReviewerWorkflowExtractionTemplates.importTemplate(reviewer, current.context, payload || {});
				await syncExtractionTemplateAppendix(current);
				return result;
			},
		});

		return next;
	}

	return {
		register,
		unregister,
		list,
		call,
		streamAutomationChat,
	};
})();
