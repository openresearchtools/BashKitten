var SystematicReviewerItemIdentity = {
	_openFileExternally(path) {
		try {
			let file = this._nsIFile(path);
			file.launch();
		}
		catch (error) {
			this.log(`Failed to open file '${path}': ${error}`);
		}
	},

	async _eraseProjectItemAndChildren(projectItem) {
		if (!projectItem || projectItem.deleted) {
			return;
		}
		let childIDs = [];
		try {
			if (projectItem.getAttachments) {
				childIDs.push(...projectItem.getAttachments());
			}
		}
		catch (_err) {}
		try {
			if (projectItem.getNotes) {
				childIDs.push(...projectItem.getNotes());
			}
		}
		catch (_err) {}
		for (let childID of Array.from(new Set(childIDs))) {
			let child = Zotero.Items.get(childID);
			if (!child || child.deleted) {
				continue;
			}
			await child.eraseTx();
		}
		await projectItem.eraseTx();
	},

	async _clearDeletedProjectReferences(projectID) {
		let target = String(projectID || "").trim();
		if (!target) {
			return;
		}
		if (this.currentProject?.projectID == target) {
			this.currentProject = null;
		}
		for (let controller of Array.from(this.paneControllers || [])) {
			if (String(controller?.projectRef?.projectID || "").trim() == target) {
				controller.projectRef = null;
			}
		}
		let path = this._globalSettingsPath();
		let existingRaw = (await this._readJSONFile(path)) || {};
		let settings = this._normalizeGlobalSettings(existingRaw);
		if (String(settings?.last_project?.project_id || "").trim() == target) {
			settings.last_project = null;
			settings.updated_at = new Date().toISOString();
			await this._writeGlobalSettingsRecord(path, settings, existingRaw);
		}
		await this._refreshAllControllers().catch(() => {});
	},

	_shouldDeferWorkspaceRefresh(controller) {
		if (controller?.kind != "workspace") {
			return false;
		}
		if (controller.mode == "raw") {
			return true;
		}
		if (controller.mode != "native") {
			return false;
		}
		let activeElement = controller.doc?.activeElement || null;
		let activeInNativeEditor = !!(activeElement && controller.els?.nativeEditor?.contains(activeElement));
		return !!(controller.nativeDirty || controller.documentDirty || activeInNativeEditor);
	},

	async _refreshAllControllers() {
		for (let controller of Array.from(this.paneControllers)) {
			if (!controller?.body?.isConnected) {
				this.paneControllers.delete(controller);
				continue;
			}
			if (this._shouldDeferWorkspaceRefresh(controller)) {
				continue;
			}
			if (typeof controller.refresh == "function") {
				await controller.refresh();
			}
			else {
				await this._refreshController(controller);
			}
		}
	},

	_destroyController(body) {
		let controller = body?._systematicReviewerController;
		if (!controller) {
			return;
		}
		if (controller.kind == "markdown-viewer") {
			this._cleanupMarkdownViewerPdfHandle(controller);
		}
		this._closeEditorContextMenu(controller);
		if (controller.pollTimer && controller.doc?.defaultView) {
			try {
				controller.doc.defaultView.clearInterval(controller.pollTimer);
			}
			catch (_err) {}
		}
		if (controller.autosaveTimer && controller.doc?.defaultView) {
			try {
				controller.doc.defaultView.clearTimeout(controller.autosaveTimer);
			}
			catch (_err) {}
		}
		this.paneControllers.delete(controller);
		delete body._systematicReviewerController;
	},

	_ensureWorkspaceStyles(doc) {
		if (doc.getElementById("systematic-reviewer-workspace-style")) {
			return;
		}
		let style = doc.createElementNS(HTML_NS, "style");
		style.id = "systematic-reviewer-workspace-style";
		style.textContent = `${SYSTEMATIC_REVIEWER_WORKSPACE_CSS_V2}\n${SYSTEMATIC_REVIEWER_MARKDOWN_VIEWER_CSS}`;
		doc.documentElement.appendChild(style);
	},

	_html(doc, tag, { className = "", text = null, attrs = null, children = null } = {}) {
		let el = doc.createElementNS(HTML_NS, tag);
		if (className) {
			el.setAttribute("class", className);
		}
		if (attrs) {
			for (let [key, value] of Object.entries(attrs)) {
				if (value === undefined || value === null) {
					continue;
				}
				el.setAttribute(key, String(value));
			}
		}
		if (text !== null) {
			el.textContent = text;
		}
		if (children) {
			for (let child of children) {
				if (child) {
					el.appendChild(child);
				}
			}
		}
		return el;
	},

	_renderMarkdownHTMLLegacy(markdown) {
		let source = String(markdown || "").replace(/\r\n?/g, "\n");
		let lines = source.split("\n");
		let html = [];
		let paragraph = [];
		let inCode = false;
		let codeLines = [];
		let listType = null;
		let listItems = [];

		let flushParagraph = () => {
			if (!paragraph.length) {
				return;
			}
			html.push(`<p>${this._renderInlineMarkdownLegacy(paragraph.join(" "))}</p>`);
			paragraph = [];
		};

		let flushList = () => {
			if (!listType || !listItems.length) {
				return;
			}
			html.push(
				`<${listType}>${listItems.map((item) => `<li>${this._renderInlineMarkdownLegacy(item)}</li>`).join("")}</${listType}>`
			);
			listType = null;
			listItems = [];
		};

		let isTableSeparator = (line) =>
			/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*(?:\s*:?-{3,}:?\s*)?\|?\s*$/.test(line);

		let parseTableRow = (line) =>
			line
				.trim()
				.replace(/^\|/, "")
				.replace(/\|$/, "")
				.split("|")
				.map((cell) => cell.trim());

		for (let i = 0; i < lines.length; i += 1) {
			let raw = lines[i];
			let line = raw.trimEnd();

			if (inCode) {
				if (/^```/.test(line.trim())) {
					html.push(`<pre><code>${this._escapeHTML(codeLines.join("\n"))}</code></pre>`);
					inCode = false;
					codeLines = [];
				}
				else {
					codeLines.push(raw);
				}
				continue;
			}

			if (/^```/.test(line.trim())) {
				flushParagraph();
				flushList();
				inCode = true;
				codeLines = [];
				continue;
			}

			let next = i + 1 < lines.length ? lines[i + 1] : "";
			if (line.includes("|") && next && isTableSeparator(next)) {
				flushParagraph();
				flushList();
				let header = parseTableRow(line);
				let rows = [];
				i += 2;
				while (i < lines.length) {
					let rowLine = lines[i];
					if (!rowLine.trim() || !rowLine.includes("|")) {
						i -= 1;
						break;
					}
					rows.push(parseTableRow(rowLine));
					i += 1;
				}
				let thead = `<thead><tr>${header.map((cell) => `<th>${this._renderInlineMarkdownLegacy(cell)}</th>`).join("")}</tr></thead>`;
				let tbody = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${this._renderInlineMarkdownLegacy(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
				html.push(`<table>${thead}${tbody}</table>`);
				continue;
			}

			if (!line.trim()) {
				flushParagraph();
				flushList();
				continue;
			}

			let heading = line.match(/^(#{1,6})\s+(.*)$/);
			if (heading) {
				flushParagraph();
				flushList();
				let level = Math.min(6, heading[1].length);
				html.push(`<h${level}>${this._renderInlineMarkdownLegacy(heading[2])}</h${level}>`);
				continue;
			}

			let unordered = line.match(/^\s*[-*+]\s+(.*)$/);
			if (unordered) {
				flushParagraph();
				if (listType && listType != "ul") {
					flushList();
				}
				listType = "ul";
				listItems.push(unordered[1]);
				continue;
			}

			let ordered = line.match(/^\s*\d+\.\s+(.*)$/);
			if (ordered) {
				flushParagraph();
				if (listType && listType != "ol") {
					flushList();
				}
				listType = "ol";
				listItems.push(ordered[1]);
				continue;
			}

			flushList();
			paragraph.push(line.trim());
		}

		flushParagraph();
		flushList();

		if (inCode) {
			html.push(`<pre><code>${this._escapeHTML(codeLines.join("\n"))}</code></pre>`);
		}

		return html.join("\n");
	},

	_renderInlineMarkdownLegacy(text) {
		let html = this._escapeHTML(text || "");
		html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
			return `<img alt="${this._escapeHTML(alt)}" src="${this._escapeHTML(src)}">`;
		});
		html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
			let safeHref = this._escapeHTML(href);
			return `<a href="${safeHref}">${this._escapeHTML(label)}</a>`;
		});
		html = html.replace(/`([^`]+)`/g, (_match, code) => `<code>${this._escapeHTML(code)}</code>`);
		html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
		return html;
	},

	_itemField(item, field) {
		try {
			return (item.getField ? item.getField(field) : "") || "";
		}
		catch (_err) {
			return "";
		}
	},

	_extraLines(extraText) {
		return String(extraText || "")
			.replace(/\r\n?/g, "\n")
			.split("\n")
			.map((line) => String(line || "").trimEnd());
	},

	_extraLabeledValue(extraText, labels = []) {
		let wanted = new Set((labels || []).map((label) => String(label || "").trim().toLowerCase()).filter(Boolean));
		if (!wanted.size) {
			return "";
		}
		for (let line of this._extraLines(extraText)) {
			let text = String(line || "").trim();
			if (!text) {
				continue;
			}
			let separator = text.indexOf(":");
			if (separator <= 0) {
				continue;
			}
			let label = text.slice(0, separator).trim().toLowerCase();
			if (!wanted.has(label)) {
				continue;
			}
			return text.slice(separator + 1).trim();
		}
		return "";
	},

	_replaceExtraLabeledValue(extraText, canonicalLabel, labels = [], value = "") {
		let wanted = new Set((labels || []).map((label) => String(label || "").trim().toLowerCase()).filter(Boolean));
		let next = [];
		let replaced = false;
		let cleanValue = String(value || "").trim();
		for (let line of this._extraLines(extraText)) {
			let text = String(line || "").trimEnd();
			let normalized = text.trim().toLowerCase();
			let separator = normalized.indexOf(":");
			let label = separator > 0 ? normalized.slice(0, separator).trim() : "";
			if (label && wanted.has(label)) {
				if (cleanValue && !replaced) {
					next.push(`${canonicalLabel}: ${cleanValue}`);
					replaced = true;
				}
				continue;
			}
			next.push(text);
		}
		if (cleanValue && !replaced) {
			next.push(`${canonicalLabel}: ${cleanValue}`);
		}
		return next.join("\n").replace(/\n{3,}/g, "\n\n").trim();
	},

	_normalizeOpenAlexID(value) {
		let text = String(value || "").trim();
		if (!text) {
			return "";
		}
		let match = text.match(/(?:^|\/)([A-Za-z]\d+)(?:\/)?$/);
		if (match?.[1]) {
			return match[1].toUpperCase();
		}
		if (/^[A-Za-z]\d+$/.test(text)) {
			return text.toUpperCase();
		}
		return "";
	},

	_normalizeDOI(value) {
		let text = String(value || "").trim();
		if (!text) {
			return "";
		}
		text = text.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
		text = text.replace(/^doi:\s*/i, "");
		return text.trim().toLowerCase();
	},

	_normalizePMID(value) {
		let digits = String(value || "").replace(/[^0-9]/g, "");
		return digits || "";
	},

	_normalizeArXiv(value) {
		let text = String(value || "").trim();
		if (!text) {
			return "";
		}
		text = text.replace(/^arxiv:/i, "");
		text = text.replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "");
		text = text.replace(/\.pdf$/i, "");
		return text.trim().toLowerCase();
	},

	_normalizeISBN(value) {
		let digits = String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
		return digits || "";
	},

	_paperIDFromExtra(extraText) {
		return String(
			this._extraLabeledValue(extraText, [
				PAPER_ID_EXTRA_LABEL,
				"Paper ID",
			]) || ""
		).trim();
	},

	_openAlexIDFromExtra(extraText) {
		return this._normalizeOpenAlexID(
			this._extraLabeledValue(extraText, [
				OPENALEX_EXTRA_LABEL,
				"OpenAlex ID",
			]) || ""
		);
	},

	_abstractOriginFromExtra(extraText) {
		return String(
			this._extraLabeledValue(extraText, [
				ABSTRACT_ORIGIN_EXTRA_LABEL,
				"Abstract Origin",
			]) || ""
		).trim();
	},

	_abstractOriginExtra(extraText, abstractOrigin = "") {
		return this._replaceExtraLabeledValue(
			String(extraText || ""),
			ABSTRACT_ORIGIN_EXTRA_LABEL,
			[ABSTRACT_ORIGIN_EXTRA_LABEL, "Abstract Origin"],
			String(abstractOrigin || "").trim()
		);
	},

	_identityExtra(extraText, { paperID = "", openalexID = "" } = {}) {
		let next = String(extraText || "");
		next = this._replaceExtraLabeledValue(
			next,
			PAPER_ID_EXTRA_LABEL,
			[PAPER_ID_EXTRA_LABEL, "Paper ID"],
			String(paperID || "").trim()
		);
		next = this._replaceExtraLabeledValue(
			next,
			OPENALEX_EXTRA_LABEL,
			[OPENALEX_EXTRA_LABEL, "OpenAlex ID"],
			this._normalizeOpenAlexID(openalexID)
		);
		return next;
	},

	_generatePaperID() {
		let uuid = String(Services.uuid.generateUUID()).replace(/[{}-]/g, "").toLowerCase();
		return `srp-${uuid}`;
	},

	async _loadIdentityRowsByColumn(db, column, values = []) {
		let cleanValues = Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
		if (!cleanValues.length) {
			return [];
		}
		let out = [];
		for (let start = 0; start < cleanValues.length; start += 200) {
			let chunk = cleanValues.slice(start, start + 200);
			let placeholders = chunk.map(() => "?").join(", ");
			let rows = await db.queryAsync(
				`SELECT
					paper_id,
					item_key,
					COALESCE(openalex_id, '') AS openalex_id,
					COALESCE(doi, '') AS doi,
					COALESCE(pmid, '') AS pmid,
					COALESCE(arxiv_id, '') AS arxiv_id,
					COALESCE(isbn, '') AS isbn,
					COALESCE(citation_text, '') AS citation_text,
					COALESCE(title, '') AS title,
					COALESCE(year, '') AS year,
					COALESCE(abstract_note, '') AS abstract_note,
					COALESCE(abstract_origin, '') AS abstract_origin,
					created_at,
					updated_at
				 FROM item_identities
				 WHERE ${column} IN (${placeholders})`,
				chunk
			);
			out.push(...(rows || []));
		}
		return out;
	},

	_identityComparablePayload(identity = {}) {
		return {
			paper_id: String(identity?.paper_id || "").trim(),
			item_key: String(identity?.item_key || "").trim(),
			openalex_id: String(identity?.openalex_id || "").trim(),
			doi: String(identity?.doi || "").trim(),
			pmid: String(identity?.pmid || "").trim(),
			arxiv_id: String(identity?.arxiv_id || "").trim(),
			isbn: String(identity?.isbn || "").trim(),
			citation_text: String(identity?.citation_text || "").trim(),
			title: String(identity?.title || "").trim(),
			year: String(identity?.year || "").trim(),
			abstract_note: String(identity?.abstract_note || "").trim(),
			abstract_origin: String(identity?.abstract_origin || "").trim(),
		};
	},

	_identityPayloadChanged(existing = null, next = null) {
		let existingPayload = this._identityComparablePayload(existing);
		let nextPayload = this._identityComparablePayload(next);
		for (let field of Object.keys(nextPayload)) {
			if (existingPayload[field] != nextPayload[field]) {
				return true;
			}
		}
		return false;
	},

	async _projectItemIdentityMap(context, itemKeys = []) {
		let activeContext = context?.context || context;
		if (!activeContext) {
			return new Map();
		}
		let db = await this._projectDB(activeContext);
		let rows = await this._loadIdentityRowsByColumn(db, "item_key", itemKeys);
		return new Map((rows || []).map((row) => [String(row.item_key || "").trim(), row]));
	},

	async _loadItemKeyAliasRows(db, values = []) {
		let cleanValues = Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
		if (!cleanValues.length) {
			return [];
		}
		let out = [];
		for (let start = 0; start < cleanValues.length; start += 200) {
			let chunk = cleanValues.slice(start, start + 200);
			let placeholders = chunk.map(() => "?").join(", ");
			let rows = await db.queryAsync(
				`SELECT
					old_item_key,
					current_item_key,
					COALESCE(paper_id, '') AS paper_id,
					COALESCE(reason, '') AS reason,
					created_at,
					updated_at
				 FROM item_key_aliases
				 WHERE old_item_key IN (${placeholders})`,
				chunk
			);
			out.push(...(rows || []));
		}
		return out;
	},

	async _resolveProjectItemKey(context, itemKey, paperID = "") {
		let activeContext = context?.context || context;
		let normalizedKey = String(itemKey || "").trim();
		let normalizedPaperID = String(paperID || "").trim();
		if (!activeContext || (!normalizedKey && !normalizedPaperID)) {
			return "";
		}
		let liveItem = normalizedKey ? this._itemByKey(activeContext.libraryID, normalizedKey) : null;
		if (liveItem && !liveItem.deleted) {
			return normalizedKey;
		}
		let db = await this._projectDB(activeContext);
		let seen = new Set();
		let chain = [];
		let currentKey = normalizedKey;
		for (let depth = 0; currentKey && depth < 12; depth += 1) {
			if (seen.has(currentKey)) {
				break;
			}
			seen.add(currentKey);
			let row = (await this._loadItemKeyAliasRows(db, [currentKey]))[0] || null;
			if (!row?.current_item_key) {
				break;
			}
			chain.push(currentKey);
			currentKey = String(row.current_item_key || "").trim();
			let currentItem = currentKey ? this._itemByKey(activeContext.libraryID, currentKey) : null;
			if (currentItem && !currentItem.deleted) {
				let now = new Date().toISOString();
				if (chain.length > 1 || chain[0] != currentKey) {
					await db.executeTransaction(async () => {
						for (let oldKey of chain) {
							if (!oldKey || oldKey == currentKey) {
								continue;
							}
							await db.queryAsync(
								`INSERT INTO item_key_aliases (
									old_item_key,
									current_item_key,
									paper_id,
									reason,
									created_at,
									updated_at
								) VALUES (?, ?, ?, ?, ?, ?)
								ON CONFLICT(old_item_key) DO UPDATE SET
									current_item_key=excluded.current_item_key,
									paper_id=COALESCE(excluded.paper_id, item_key_aliases.paper_id),
									reason=excluded.reason,
									updated_at=excluded.updated_at`,
								[
									oldKey,
									currentKey,
									normalizedPaperID || null,
									"alias_chain_compress",
									now,
									now,
								]
							);
						}
					});
				}
				return currentKey;
			}
		}
		return "";
	},

	async _queueItemKeyReconcileCandidate(db, paperID, previousItemKey, detectedItemKey, reason = "paper_id_mismatch") {
		let cleanPaperID = String(paperID || "").trim();
		let previousKey = String(previousItemKey || "").trim();
		let detectedKey = String(detectedItemKey || "").trim();
		if (!cleanPaperID || !previousKey || !detectedKey || previousKey == detectedKey) {
			return false;
		}
		let now = new Date().toISOString();
		await db.queryAsync(
			`INSERT INTO item_key_reconcile_candidates (
				paper_id,
				previous_item_key,
				detected_item_key,
				reason,
				detected_at,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(paper_id) DO UPDATE SET
				previous_item_key=excluded.previous_item_key,
				detected_item_key=excluded.detected_item_key,
				reason=excluded.reason,
				updated_at=excluded.updated_at`,
			[
				cleanPaperID,
				previousKey,
				detectedKey,
				String(reason || "paper_id_mismatch"),
				now,
				now,
			]
		);
		return true;
	},

	async _rekeyProjectItemReferences(db, oldItemKey, newItemKey) {
		let oldKey = String(oldItemKey || "").trim();
		let newKey = String(newItemKey || "").trim();
		if (!oldKey || !newKey || oldKey == newKey) {
			return;
		}
		let tables = new Set(
			(await db.queryAsync("SELECT name FROM sqlite_master WHERE type='table'"))?.map((row) => String(row.name || "")) || []
		);
		let targets = [
			["source_links", "item_key"],
			["item_vectors", "item_key"],
			["item_text_sources", "item_key"],
			["document_chunks", "item_key"],
			["jobs", "source_item_key"],
			["jobs", "parent_item_key"],
			["screening_decisions", "item_key"],
			["screening_column_values", "item_key"],
			["extraction_values", "item_key"],
		];
		for (let [tableName, columnName] of targets) {
			if (!tables.has(tableName)) {
				continue;
			}
			await db.queryAsync(
				`UPDATE ${tableName} SET ${columnName}=? WHERE ${columnName}=?`,
				[newKey, oldKey]
			);
		}
	},

	_openAlexAbstractLength(abstractText = "") {
		let clean = String(abstractText || "").trim();
		return clean.length;
	},

	_needsOpenAlexAbstractHydration(abstractText = "") {
		return this._openAlexAbstractLength(abstractText) < MIN_COMPLETE_ABSTRACT_LENGTH;
	},

	_shouldUseOpenAlexAbstract(zoteroAbstract = "", openAlexAbstract = "") {
		let zoteroText = String(zoteroAbstract || "").trim();
		let openAlexText = String(openAlexAbstract || "").trim();
		return !!(
			openAlexText
			&& this._needsOpenAlexAbstractHydration(zoteroText)
			&& openAlexText.length > zoteroText.length
		);
	},

	_deriveAbstractOrigin(extraText, abstractText = "") {
		let cleanAbstract = String(abstractText || "").trim();
		if (!cleanAbstract) {
			return "";
		}
		return String(this._abstractOriginFromExtra(extraText) || "").trim().toLowerCase() == "openalex"
			? "OpenAlex"
			: "Zotero";
	},

	_extractOpenAlexAbstractText(record = {}) {
		if (typeof record.abstract == "string" && record.abstract.trim()) {
			return record.abstract.trim();
		}
		let invertedIndex =
			(record.abstract_inverted_index && typeof record.abstract_inverted_index == "object")
				? record.abstract_inverted_index
				: (record.abstract && typeof record.abstract == "object" ? record.abstract : null);
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
	},

	_extractOpenAlexRecordMetadata(record = {}) {
		if (!record || typeof record != "object") {
			return {
				openalex_id: "",
				doi: "",
				pmid: "",
				abstract: "",
			};
		}
		return {
			openalex_id: this._normalizeOpenAlexID(record.id || record.openalex_id || ""),
			doi: this._normalizeDOI(record.doi || record?.ids?.doi || ""),
			pmid: this._normalizePMID(record.pmid || record?.ids?.pmid || ""),
			abstract: this._extractOpenAlexAbstractText(record),
		};
	},

	async _ensureProjectItemIdentities(context, items = [], overridesByItemKey = null) {
		let activeContext = context?.context || context;
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
					.map((item) => [String(item.key || ""), item])
			).values()
		);
		if (!activeContext || !itemList.length) {
			return new Map();
		}
		let db = await this._projectDB(activeContext);
		let overrideMap = overridesByItemKey instanceof Map
			? overridesByItemKey
			: new Map(
				Object.entries(overridesByItemKey || {}).map(([key, value]) => [String(key || "").trim(), value || {}])
			);
		let existingByItemKey = new Map(
			(await this._loadIdentityRowsByColumn(db, "item_key", itemList.map((item) => item.key)))
				.map((row) => [String(row.item_key || ""), row])
		);
		let extraPaperIDs = itemList
			.map((item) => this._paperIDFromExtra(this._itemField(item, "extra")))
			.filter(Boolean);
		let existingByPaperID = new Map(
			(await this._loadIdentityRowsByColumn(db, "paper_id", extraPaperIDs))
				.map((row) => [String(row.paper_id || ""), row])
		);
		let citationTextByItemKey = this._renderItemCitationTextMap(itemList);
		let preparedItems = itemList.map((item) => {
			let itemKey = String(item.key || "").trim();
			let override = overrideMap.get(itemKey) || {};
			let extra = this._itemField(item, "extra");
			let extraPaperID = this._paperIDFromExtra(extra);
			let existing =
				existingByItemKey.get(itemKey)
				|| (extraPaperID ? existingByPaperID.get(extraPaperID) : null)
				|| null;
			let zoteroAbstract = this._itemField(item, "abstractNote");
			return {
				item,
				item_key: itemKey,
				override,
				extra,
				extra_paper_id: extraPaperID,
				existing,
				doi: this._normalizeDOI(this._itemField(item, "DOI")),
				pmid: this._normalizePMID(this._itemField(item, "PMID")),
				arxiv_id: this._normalizeArXiv(this._itemField(item, "arXiv")),
				isbn: this._normalizeISBN(this._itemField(item, "ISBN")),
				title: this._itemField(item, "title"),
				year: this._extractYear(this._itemField(item, "date")),
				zotero_abstract: zoteroAbstract,
			};
		});
		let now = new Date().toISOString();
		let dirtyItems = [];
		let identities = [];
		let identitiesToWrite = [];
		let reconcileCandidates = [];
		let processedPaperIDs = new Set();
		for (let prepared of preparedItems) {
			let item = prepared.item;
			let itemKey = prepared.item_key;
			let override = prepared.override;
			let extra = prepared.extra;
			let extraPaperID = prepared.extra_paper_id;
			let existing = prepared.existing;
			let paperID = String(
				extraPaperID
				|| override.paper_id
				|| override.paperID
				|| existing?.paper_id
				|| this._generatePaperID()
			).trim();
			let openalexID = this._normalizeOpenAlexID(
				override.openalex_id
				|| override.openalexID
				|| this._openAlexIDFromExtra(extra)
				|| existing?.openalex_id
			);
			let nextExtra = this._identityExtra(extra, { paperID, openalexID });
			if (nextExtra != extra) {
				item.setField("extra", nextExtra);
				dirtyItems.push(item);
			}
			let previousItemKey = String(existing?.item_key || "").trim();
			let previousLiveItem = previousItemKey && previousItemKey != itemKey
				? this._itemByKey(activeContext.libraryID, previousItemKey)
				: null;
			let previousItemMissing = !!(
				previousItemKey
				&& previousItemKey != itemKey
				&& (!previousLiveItem || previousLiveItem.deleted)
			);
			let mismatchedPaperID = !!(
				paperID
				&& previousItemKey
				&& previousItemKey != itemKey
				&& existingByPaperID.has(paperID)
				&& previousItemMissing
			);
			if (mismatchedPaperID) {
				reconcileCandidates.push({
					paper_id: paperID,
					previous_item_key: previousItemKey,
					detected_item_key: itemKey,
					reason: "paper_id_mismatch",
				});
				continue;
			}
			let abstractNote = String(prepared.zotero_abstract || "").trim();
			let abstractOrigin = this._deriveAbstractOrigin(nextExtra, abstractNote);
			let identity = {
				paper_id: paperID,
				item_key: itemKey,
				openalex_id: openalexID,
				doi: prepared.doi,
				pmid: prepared.pmid,
				arxiv_id: prepared.arxiv_id,
				isbn: prepared.isbn,
				citation_text: String(
					citationTextByItemKey.get(itemKey)
					|| existing?.citation_text
					|| ""
				).trim(),
				title: String(prepared.title || "").trim(),
				year: String(prepared.year || "").trim(),
				abstract_note: abstractNote,
				abstract_origin: String(abstractOrigin || "").trim(),
				created_at: String(existing?.created_at || now),
				updated_at: String(existing?.updated_at || now),
			};
			let changed = !existing || this._identityPayloadChanged(existing, identity);
			if (changed) {
				identity.updated_at = now;
				identitiesToWrite.push(identity);
			}
			processedPaperIDs.add(paperID);
			identities.push(identity);
		}
		if (dirtyItems.length) {
			await Zotero.DB.executeTransaction(async () => {
				for (let item of dirtyItems) {
					await item.save({ skipSelect: true });
				}
			});
		}
		if (reconcileCandidates.length || identitiesToWrite.length || processedPaperIDs.size) {
			await db.executeTransaction(async () => {
				for (let candidate of reconcileCandidates) {
					await this._queueItemKeyReconcileCandidate(
						db,
						candidate.paper_id,
						candidate.previous_item_key,
						candidate.detected_item_key,
						candidate.reason
					);
				}
				for (let identity of identitiesToWrite) {
					await db.queryAsync(
						"DELETE FROM item_identities WHERE item_key=? AND paper_id<>?",
						[identity.item_key, identity.paper_id]
					);
					await db.queryAsync(
						`INSERT INTO item_identities (
							paper_id,
							item_key,
							openalex_id,
							doi,
							pmid,
							arxiv_id,
							isbn,
							citation_text,
							title,
							year,
							abstract_note,
							abstract_origin,
							created_at,
							updated_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(paper_id) DO UPDATE SET
							item_key=excluded.item_key,
							openalex_id=excluded.openalex_id,
							doi=excluded.doi,
							pmid=excluded.pmid,
							arxiv_id=excluded.arxiv_id,
							isbn=excluded.isbn,
							citation_text=excluded.citation_text,
							title=excluded.title,
							year=excluded.year,
							abstract_note=excluded.abstract_note,
							abstract_origin=excluded.abstract_origin,
							updated_at=excluded.updated_at`,
						[
							identity.paper_id,
							identity.item_key,
							identity.openalex_id || null,
							identity.doi || null,
							identity.pmid || null,
							identity.arxiv_id || null,
							identity.isbn || null,
							identity.citation_text || "",
							identity.title || "",
							identity.year || "",
							identity.abstract_note || "",
							identity.abstract_origin || "",
							identity.created_at,
							identity.updated_at,
						]
					);
				}
				for (let paperID of processedPaperIDs) {
					await db.queryAsync(
						"DELETE FROM item_key_reconcile_candidates WHERE paper_id=?",
						[paperID]
					);
				}
			});
		}
		return new Map(identities.map((identity) => [identity.item_key, identity]));
	},

	async _ensureProjectItemIdentitiesBatched(context, items = [], overridesByItemKey = null, batchSize = 100) {
		let normalizedBatchSize = Math.max(1, Number(batchSize || 0) || 100);
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
					.map((item) => [String(item.key || ""), item])
			).values()
		);
		if (!itemList.length) {
			return new Map();
		}
		if (itemList.length <= normalizedBatchSize) {
			return await this._ensureProjectItemIdentities(context, itemList, overridesByItemKey);
		}
		let overrideMap = overridesByItemKey instanceof Map
			? overridesByItemKey
			: new Map(
				Object.entries(overridesByItemKey || {}).map(([key, value]) => [String(key || "").trim(), value || {}])
			);
		let combined = new Map();
		for (let offset = 0; offset < itemList.length; offset += normalizedBatchSize) {
			let batch = itemList.slice(offset, offset + normalizedBatchSize);
			let batchOverrides = new Map();
			for (let item of batch) {
				let itemKey = String(item?.key || "").trim();
				if (itemKey && overrideMap.has(itemKey)) {
					batchOverrides.set(itemKey, overrideMap.get(itemKey));
				}
			}
			let identities = await this._ensureProjectItemIdentities(context, batch, batchOverrides);
			for (let [itemKey, identity] of identities.entries()) {
				combined.set(itemKey, identity);
			}
			if (
				offset + normalizedBatchSize < itemList.length
				&& typeof Zotero?.Promise?.delay == "function"
			) {
				await Zotero.Promise.delay(0);
			}
		}
		return combined;
	},

	async _listItemKeyReconcileCandidates(context) {
		let activeContext = context?.context || context;
		if (!activeContext) {
			return [];
		}
		let db = await this._projectDB(activeContext);
		let rows = await db.queryAsync(
			`SELECT
				paper_id,
				previous_item_key,
				detected_item_key,
				COALESCE(reason, '') AS reason,
				detected_at,
				updated_at
			 FROM item_key_reconcile_candidates
			 ORDER BY updated_at ASC, paper_id ASC`
		);
		return (rows || []).map((row) => ({
			paper_id: String(row.paper_id || "").trim(),
			previous_item_key: String(row.previous_item_key || "").trim(),
			detected_item_key: String(row.detected_item_key || "").trim(),
			reason: String(row.reason || "").trim(),
			detected_at: String(row.detected_at || ""),
			updated_at: String(row.updated_at || ""),
		}));
	},

	async _reconcileProjectItemKeys(context, rootCollection, projectItem) {
		let activeContext = context?.context || context;
		if (!activeContext || !rootCollection) {
			return { applied_count: 0, unresolved_count: 0, applied: [], unresolved: [] };
		}
		await this._ensureProjectItemIdentities(
			activeContext,
			this._projectCitableItems(rootCollection, projectItem)
		);
		let db = await this._projectDB(activeContext);
		let candidates = await this._listItemKeyReconcileCandidates(activeContext);
		if (!candidates.length) {
			return { applied_count: 0, unresolved_count: 0, applied: [], unresolved: [] };
		}
		let now = new Date().toISOString();
		let applied = [];
		let unresolved = [];
		await db.executeTransaction(async () => {
			for (let candidate of candidates) {
				let paperID = String(candidate.paper_id || "").trim();
				let previousKey = String(candidate.previous_item_key || "").trim();
				let detectedKey = String(candidate.detected_item_key || "").trim();
				let liveItem = this._itemByKey(activeContext.libraryID, detectedKey);
				if (!paperID || !previousKey || !detectedKey || !liveItem || liveItem.deleted) {
					unresolved.push(candidate);
					continue;
				}
				await this._rekeyProjectItemReferences(db, previousKey, detectedKey);
				await db.queryAsync(
					`INSERT INTO item_key_aliases (
						old_item_key,
						current_item_key,
						paper_id,
						reason,
						created_at,
						updated_at
					) VALUES (?, ?, ?, ?, ?, ?)
					ON CONFLICT(old_item_key) DO UPDATE SET
						current_item_key=excluded.current_item_key,
						paper_id=excluded.paper_id,
						reason=excluded.reason,
						updated_at=excluded.updated_at`,
					[
						previousKey,
						detectedKey,
						paperID,
						candidate.reason || "manual_reconcile",
						now,
						now,
					]
				);
				await db.queryAsync(
					"UPDATE item_key_aliases SET current_item_key=?, updated_at=? WHERE current_item_key=?",
					[detectedKey, now, previousKey]
				);
				await db.queryAsync(
					"DELETE FROM item_identities WHERE item_key=? AND paper_id<>?",
					[detectedKey, paperID]
				);
				await db.queryAsync(
					"UPDATE item_identities SET item_key=?, updated_at=? WHERE paper_id=?",
					[detectedKey, now, paperID]
				);
				await db.queryAsync(
					"DELETE FROM item_key_reconcile_candidates WHERE paper_id=?",
					[paperID]
				);
				applied.push({
					paper_id: paperID,
					previous_item_key: previousKey,
					current_item_key: detectedKey,
				});
			}
		});
		await this._primeProjectItemKeyAliases(activeContext);
		this.reconcileGeneration += 1;
		return {
			applied_count: applied.length,
			unresolved_count: unresolved.length,
			applied,
			unresolved,
		};
	},

	async _projectCitableItemsEnsured(context, rootCollection, projectItem, scopeSpec = null, overridesByItemKey = null) {
		let items = this._projectCitableItems(rootCollection, projectItem, scopeSpec);
		await this._ensureProjectItemIdentities(context, items, overridesByItemKey);
		return items;
	},

	_extractYear(rawDate) {
		let match = String(rawDate || "").match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
		return match ? match[1] : "";
	},
};
