/*
 ***** BEGIN LICENSE BLOCK *****
 
 Copyright © 2009 Center for History and New Media
 George Mason University, Fairfax, Virginia, USA
 http://zotero.org
 
 This file is part of Zotero.
 
 Zotero is free software: you can redistribute it and/or modify
 it under the terms of the GNU Affero General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.
 
 Zotero is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 GNU Affero General Public License for more details.
 
 You should have received a copy of the GNU Affero General Public License
 along with Zotero. If not, see <http://www.gnu.org/licenses/>.
 
 ***** END LICENSE BLOCK *****
*/


// BashKitten 2026-10-28: exact native resolver/queue methods, runtime interfaces injected.
module.exports = function(Zotero, host) {
const { Services, OS, _enforceFileType, _getTitleFromVersion }=host;
const nativeRequire=require; const requireResolver=p=>p==='resource://zotero/jspath.js'?nativeRequire('jspath'):nativeRequire(p);
let _findFileQueue=[],_findFileQueuePromise=null;
// BashKitten: one owner serves all libraries; preserve native not-before times between batches.
const _domainPacing=new Map();
const urlToDomain=url=>new URL(url).hostname;
const self=this;
	this.canFindFileForItem = function (item) {
		return item.isRegularItem()
			&& !item.isFeedItem
			&& (!!item.getField('DOI') || !!item.getField('url') || !!item.getExtraField('DOI') || !!item.getField('PMCID'))
			&& this.FIND_AVAILABLE_FILE_TYPES.every(type => item.numFileAttachmentsWithContentType(type) == 0);
	};
this.getFileResolvers = function (item, methods, automatic) {
		if (!methods) {
			methods = ['doi', 'url', 'oa', 'custom'];
		}
		
		var useDOI = methods.includes('doi');
		var useURL = methods.includes('url');
		var useOA = methods.includes('oa');
		var useCustom = methods.includes('custom');
		
		var resolvers = [];
		var doi = item.getField('DOI') || item.getExtraField('DOI');
		doi = Zotero.Utilities.cleanDOI(doi);
		var pmcid = item.getField('PMCID');
		if (pmcid) {
			let matches = pmcid.match(/\bPMC\d+\b/i);
			pmcid = matches && matches[0].toUpperCase();
		}
		
		if (useDOI && doi) {
			doi = Zotero.Utilities.cleanDOI(doi);
			if (doi) {
				resolvers.push({
					pageURL: 'https://doi.org/' + doi,
					accessMethod: 'doi'
				});
			}
		}
		
		if (useURL) {
			let url = item.getField('url');
			if (url) {
				url = Zotero.Utilities.cleanURL(url);
				if (url) {
					resolvers.push({
						pageURL: url,
						accessMethod: 'url'
					});
				}
			}
		}
		
		if (useOA && doi) {
			resolvers.push(async function () {
				let urls = await Zotero.Utilities.Internal.getOpenAccessPDFURLs(doi);
				return urls.map((o) => {
					return {
						url: o.url,
						pageURL: o.pageURL,
						articleVersion: o.version,
						accessMethod: 'oa'
					};
				});
			});
		}

		// The open-access lookup often supplies a PMC URL of its own, in which
		// case this one is skipped as an already-tried redirect target
		if (useOA && pmcid) {
			resolvers.push({
				pageURL: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
				accessMethod: 'oa'
			});
		}

		if (useCustom && doi) {
			let customResolvers;
			try {
				customResolvers = Zotero.Prefs.get('findPDFs.resolvers');
				if (customResolvers) {
					customResolvers = JSON.parse(customResolvers);
				}
			}
			catch (e) {
				Zotero.debug("Error parsing custom file resolvers", 2);
				Zotero.debug(e, 2);
			}
			if (customResolvers) {
				// Handle single object instead of array
				if (!Array.isArray(customResolvers) && customResolvers.method) {
					customResolvers = [customResolvers];
				}
				if (Array.isArray(customResolvers)) {
					// Only include resolvers that have opted into automatic processing
					if (automatic) {
						customResolvers = customResolvers.filter(r => r.automatic);
					}
					
					for (let resolver of customResolvers) {
						try {
							let {
								name,
								method,
								url,
								mode,
								selector,
								
								// HTML
								attribute,
								index,
								
								// JSON
								mappings
							} = resolver;
							if (!name) {
								throw new Error("'name' not provided");
							}
							if (!['GET', 'POST'].includes(method.toUpperCase())) {
								throw new Error("'method' must be 'GET' or 'POST'");
							}
							if (!url) {
								throw new Error("'url' not provided");
							}
							if (!url.includes('{doi}')) {
								throw new Error("'url' must include '{doi}'");
							}
							if (!['html', 'json'].includes(mode.toLowerCase())) {
								throw new Error("'mode' must be 'html' or 'json'");
							}
							if (!selector) {
								throw new Error("'selector' not provided");
							}
							
							url = url.replace(/\{doi}/, doi);
							
							resolvers.push(async function () {
								Zotero.debug(`Looking for files for ${doi} via ${name}`);
								
								var req = await Zotero.HTTP.request(
									method.toUpperCase(),
									url,
									{
										responseType: mode == 'json' ? 'json' : 'document',
										timeout: 5000,
										// Move on to the next resolver instead of waiting on a
										// failing third-party server, which blocks the rest of
										// the queue
										errorDelayMax: 0,
										noRetryOnThrottle: true
									}
								);
								
								if (mode == 'html') {
									let doc = req.response;
									let elem = index
										? doc.querySelectorAll(selector).item(index)
										: doc.querySelector(selector);
									if (!elem) return [];
									let val = attribute
										? elem.getAttribute(attribute)
										: elem.textContent;
									if (!val) return [];
									
									// Handle relative paths
									val = Services.io.newURI(
										val, null, Services.io.newURI(url)
									).spec;
									
									return [{
										accessMethod: name,
										url: val,
										referrer: url,
									}];
								}
								else if (mode == 'json') {
									let jspath = requireResolver('resource://zotero/jspath.js');
									let json = req.response;
									let results = jspath.apply(selector, json);
									// If mappings for 'url' and 'pageURL' are supplied,
									// extract properties from each object in the array
									if (mappings) {
										let mappedResults = [];
										for (let result of results) {
											if (typeof result != 'object') continue;
											let mappedResult = {};
											for (let field in mappings) {
												if (!['url', 'pageURL'].includes(field)) continue;
												
												if (result[mappings[field]]) {
													mappedResult[field] = result[mappings[field]];
												}
											}
											mappedResults.push(mappedResult);
										}
										results = mappedResults;
									}
									// Otherwise just treat each array entry as the URL
									else {
										results = results
											.filter(url => typeof url == 'string')
											.map(url => ({ url }));
									}
									return results.map((o) => {
										return Object.assign(
											o,
											{
												accessMethod: name,
												referrer: url
											}
										);
									});
								}
							});
						}
						catch (e) {
							Zotero.debug("Error parsing file resolver", 2);
							Zotero.debug(e, 2);
							Zotero.debug(resolver, 2);
						}
					}
				}
			}
		}
		
		return resolvers;
	};
this.addAvailableFiles = async function (items, options = {}) {
		const MAX_CONSECUTIVE_DOMAIN_FAILURES = 5;
		const SAME_DOMAIN_REQUEST_DELAY = options.sameDomainRequestDelay || 1000;
		var queue;
		
		var domains = _domainPacing;
        for (const [domain, info] of domains) {
            if (info.nextRequestTime <= Date.now() && !info.consecutiveFailures) domains.delete(domain);
        }
		function getDomainInfo(domain) {
			var domainInfo = domains.get(domain);
			if (!domainInfo) {
				domainInfo = {
					nextRequestTime: 0,
					consecutiveFailures: 0
				};
				domains.set(domain, domainInfo);
			}
			return domainInfo;
		}
		
		var progressQueue = Zotero.ProgressQueues.get('findFile');
		if (!progressQueue) {
			progressQueue = Zotero.ProgressQueues.create({
				id: 'findFile',
				title: 'pane.items.menu.findAvailableFile',
				columns: [
					'general.item',
					'attachment.fullText'
				]
			});
			progressQueue.addListener('cancel', () => queue = []);
		}

		queue = _findFileQueue;
		
		for (let item of items) {
			// Skip items that aren't eligible. This is sort of weird, because it means some
			// selected items just don't appear in the list, but there are several different reasons
			// why items might not be eligible (non-regular items, no URL or DOI, already has a
			// full-text attachment) and listing each one seems a little unnecessary.
			if (!this.canFindFileForItem(item)) {
				continue;
			}
			
			let entry = {
				item,
				urlResolvers: this.getFileResolvers(item, options.methods, item.automatic),
				domain: null,
				continuation: null,
				processing: false,
				result: null
			};
			
			let pos = queue.findIndex(x => x.item == item);
			if (pos != -1) {
				let current = queue[pos];
				// Skip items that are already processing or that returned a result
				if (current.processing || current.result) {
					continue;
				}
				// Replace current queue entry
				queue[pos] = entry;
			}
			else {
				// Add new items to queue
				queue.push(entry);
			}
			
			progressQueue.addRow(item);
		}
		
		// If no eligible items, just show a popup saying no files were found
		if (!queue.length) {
			let progressWin = new Zotero.ProgressWindow();
			let title = Zotero.getString('pane.items.menu.findAvailableFile');
			progressWin.changeHeadline(title);
			let itemProgress = new progressWin.ItemProgress(
				'attachmentPDF',
				Zotero.getString('findPDF.noFilesFound')
			);
			progressWin.show();
			itemProgress.setProgress(100);
			progressWin.startCloseTimer(4000);
			return;
		}
		
		var dialog = progressQueue.getDialog();
		dialog.showMinimizeButton(false);
		dialog.open();
		
		// If queue was already in progress, just wait for it to finish
		if (_findFileQueuePromise) {
			return _findFileQueuePromise;
		}
		
		var queueResolve;
		_findFileQueuePromise = new Zotero.Promise((resolve) => {
			queueResolve = resolve;
		});
		
		//
		// Process items in the queue
		//
		var i = 0;
		await new Zotero.Promise((resolve) => {
			var processNextItem = function () {
				var current = queue[i++];
                if (current?.item.signal?.aborted) { current.result=false; processNextItem(); return; }
				
				// We reached the end of the queue
				if (!current) {
					// If all entries are resolved, we're done
					if (queue.every(x => x.result instanceof Zotero.Item || x.result === false)) {
						resolve();
						return;
					}
					
					// Otherwise, wait until the next time a pending request is ready to process
					// and restart. If no pending requests, they're all in progress.
					let nextStart = queue
						.map(x => x.result === null && getDomainInfo(x.domain).nextRequestTime)
						.filter(x => x)
						.reduce((accumulator, currentValue) => {
							return currentValue < accumulator ? currentValue : accumulator;
						});
					i = 0;
					setTimeout(processNextItem, Math.min(1000, Math.max(0, nextStart - Date.now())));
					return;
				}
				
				// If item was already processed, skip
				if (current.result !== null) {
					processNextItem();
					return;
				}
				
				// If processing for a domain was paused and not enough time has passed, skip ahead
				if (current.domain && getDomainInfo(current.domain).nextRequestTime > Date.now()) {
					processNextItem();
					return;
				}
				
				// Resume paused item
				if (current.continuation) {
					current.continuation();
					return;
				}
				
				// Currently filtered out above
				/*if (!this.canFindFileForItem(current.item)) {
					current.result = false;
					progressQueue.updateRow(
						current.item.id,
						Zotero.ProgressQueue.ROW_FAILED,
						""
					);
					processNextItem();
					return;
				}*/
				
				current.processing = true;
				
				// Process item
				this.addFileFromURLs(
					current.item,
					current.urlResolvers,
					{
						onBeforeRequest: async function (url, noDelay) {
							var domain = urlToDomain(url);
							
							// Don't delay between subsequent requests to the DOI resolver or
							// to localhost in tests
							if (['doi.org', 'localhost'].includes(domain)) {
								return;
							}
							
							var domainInfo = getDomainInfo(domain);
							
							// If too many requests have failed, stop trying
							if (domainInfo.consecutiveFailures > MAX_CONSECUTIVE_DOMAIN_FAILURES) {
								throw new Error(`Too many failed requests for ${urlToDomain(url)}`);
							}
							
							// If enough time hasn't passed since the last attempt for this domain,
							// skip for now and process more items
							let nextRequestTime = domainInfo.nextRequestTime;
							if (!noDelay && nextRequestTime > Date.now()) {
								return new Promise((resolve, reject) => {
									Zotero.debug(`Delaying request to ${domain} for ${nextRequestTime - Date.now()} ms`);
									current.domain = domain;
									current.continuation = () => {
										if (domainInfo.consecutiveFailures < MAX_CONSECUTIVE_DOMAIN_FAILURES) {
                                            // A resumed request consumes the same native pacing slot.
                                            domainInfo.nextRequestTime = Date.now() + SAME_DOMAIN_REQUEST_DELAY;
											resolve();
										}
										else {
											reject(new Error(`Too many failed requests for ${urlToDomain(url)}`));
										}
									};
									processNextItem();
								});
							}
							
							domainInfo.nextRequestTime = Date.now() + SAME_DOMAIN_REQUEST_DELAY;
						},
						
						// Reset consecutive failures on successful request
						onAfterRequest: function (url) {
							var domain = urlToDomain(url);
							
							// Ignore localhost in tests
							if (domain == 'localhost') {
								return;
							}
							
							var domainInfo = getDomainInfo(domain);
							domainInfo.consecutiveFailures = 0;
						},
						
						// Return true to retry request or false to skip
						onRequestError: function (e) {
							const maxDelay = 3600;
							
							if (e instanceof Zotero.HTTP.UnexpectedStatusException) {
								let domain = urlToDomain(e.url);
								let domainInfo = getDomainInfo(domain);
								domainInfo.consecutiveFailures++;
								
								let status = e.status;
								
								// Retry-After
								if (status == 429 || status == 503) {
									// xmlhttp is a fetch Response for downloads
									let retryAfter = e.xmlhttp.headers?.get
										? e.xmlhttp.headers.get('Retry-After')
										: e.xmlhttp.getResponseHeader('Retry-After');
									if (retryAfter) {
										Zotero.debug("Got Retry-After: " + retryAfter);
										if (parseInt(retryAfter) == retryAfter) {
											if (retryAfter > maxDelay) {
												Zotero.debug("Retry-After is too long -- skipping request");
												return false;
											}
											domainInfo.nextRequestTime = Date.now() + retryAfter * 1000;
											return true;
										}
										else if (Zotero.Date.isHTTPDate(retryAfter)) {
											let d = new Date(retryAfter);
											if (d > Date.now() + maxDelay * 1000) {
												Zotero.debug("Retry-After is too long -- skipping request");
												return false;
											}
											domainInfo.nextRequestTime = d.getTime();
											return true;
										}
										Zotero.debug("Invalid Retry-After value -- skipping request");
										return false;
									}
								}
								
								// If not specified, wait 10 seconds before next request to domain
								if (e.status == 429 || e.is5xx()) {
									domainInfo.nextRequestTime = Date.now() + 10000;
									return true;
								}
							}
							
							return false;
						}
					}
				)
				.then((attachment) => {
					current.result = attachment;
					progressQueue.updateRow(
						current.item.id,
						attachment
							? Zotero.ProgressQueue.ROW_SUCCEEDED
							: Zotero.ProgressQueue.ROW_FAILED,
						attachment
							? attachment.getField('title')
							: Zotero.getString('findPDF.noFileFound')
					);
				})
				.catch((e) => {
					Zotero.logError(e);
					current.result = false;
					progressQueue.updateRow(
						current.item.id,
						Zotero.ProgressQueue.ROW_FAILED,
						Zotero.getString('general.failed')
					);
				})
				// finally() isn't implemented until Firefox 58, but then() is the same here
				//.finally(() => {
				.then(function () {
					current.processing = false;
					processNextItem();
				});
			}.bind(this);
			
			processNextItem();
		});
		
		var numFiles = queue.reduce((accumulator, currentValue) => {
			return accumulator + (currentValue.result ? 1 : 0);
		}, 0);
		dialog.setStatus(
			numFiles
				? { l10nId: 'find-pdf-files-added', l10nArgs: { count: numFiles } }
				: Zotero.getString('findPDF.noFilesFound')
		);
		_findFileQueue = [];
        for (const info of domains.values()) info.consecutiveFailures=0;
		queueResolve();
		_findFileQueuePromise = null;
	};
this.addFileFromURLs = async function (item, urlResolvers, options = {}) {
		var tmpDir;
		var tmpFile;
		var attachmentItem = false;
		try {
			tmpDir = (await this.createTemporaryStorageDirectory()).path;
			tmpFile = OS.Path.join(tmpDir, 'file.tmp');
			let { title, mimeType, url, props } = await this.downloadFirstAvailableFile(
				urlResolvers,
				tmpFile,
				{
					enforceFileType: true,
					shouldDisplayCaptcha: true,
					onAccessMethodStart: options.onAccessMethodStart,
					onBeforeRequest: options.onBeforeRequest,
					onRequestError: options.onRequestError
				}
			);
			if (url) {
				if (!mimeType) {
					mimeType = await Zotero.MIME.getMIMETypeFromFile(tmpFile);
				}
				if (!this.FIND_AVAILABLE_FILE_TYPES.includes(mimeType)) {
					throw new Error(`Resolved file is unsupported type ${mimeType}`);
				}
				title = title || _getTitleFromVersion(props.articleVersion);
				let fileBaseName = this.getFileBaseNameFromItem(item, { attachmentTitle: title });
				let ext = Zotero.MIME.getPrimaryExtension(mimeType) || 'dat';
				let filename = await Zotero.File.rename(tmpFile, `${fileBaseName}.${ext}`);
				attachmentItem = await this.createURLAttachmentFromTemporaryStorageDirectory({
					directory: tmpDir,
					libraryID: item.libraryID,
					filename,
					title,
					url,
					contentType: mimeType,
					parentItemID: item.id
				});
			}
			else {
				await OS.File.removeDir(tmpDir);
			}
		}
		catch (e) {
			if (tmpDir) {
				await OS.File.removeDir(tmpDir, { ignoreAbsent: true });
			}
			throw e;
		}
		
		return attachmentItem;
	};
this.downloadFirstAvailableFile = async function (urlResolvers, path, options) {
		const maxURLs = 6;
		const schemeRE = /^(http:)?\/\//;
		
		// Operate on copy, since we might change things
		urlResolvers = [...urlResolvers];
		
		// Don't try the same normalized URL more than once
		var triedURLs = new Set();
		function normalizeURL(url) {
			url = new URL(url);
			for (let param of Array.from(url.searchParams.keys())) {
				// Keep 'download' param for Atypon
				if (param !== 'download') {
					url.searchParams.delete(param);
				}
			}
			url.searchParams.sort();
			return url.toString();
		}
		function isTriedURL(url) {
			return triedURLs.has(normalizeURL(url));
		}
		function addTriedURL(url) {
			triedURLs.add(normalizeURL(url));
		}
		
		// Check a URL against options.onBeforeRequest(), which can delay or cancel the request
		async function beforeRequest(url, noDelay) {
			if (options.onBeforeRequest) {
				await options.onBeforeRequest(url, noDelay);
			}
		}
		
		function afterRequest(url) {
			if (options.onAfterRequest) {
				options.onAfterRequest(url);
			}
		}
		
		function handleRequestError(e) {
			if (options.onRequestError) {
				return options.onRequestError(e);
			}
		}
		
		for (let i = 0; i < urlResolvers.length; i++) {
			let urlResolver = urlResolvers[i];
			
			// If resolver is a function, run it and then replace it in the resolvers list with
			// the results
			if (typeof urlResolver == 'function') {
				try {
					urlResolver = await urlResolver();
				}
				catch (e) {
					Zotero.logError(e);
					urlResolver = [];
				}
				
				// Don't allow more than 6 URLs from a given resolver
				// Among other things, this ignores Unpaywall rows that have a huge number of
				// URLs by mistake (as of August 2018).
				if (urlResolver.length > maxURLs) {
					Zotero.debug(`Keeping ${maxURLs} URLs`);
					urlResolver = urlResolver.slice(0, maxURLs);
				}
				
				// Splice any URLs from resolver into the array
				urlResolvers.splice(i, 1, ...urlResolver);
				i--;
				continue;
			}
			
			// Accept URL strings in addition to objects
			if (typeof urlResolver == 'string') {
				urlResolver = { url: urlResolver };
			}
			
			let url = urlResolver.url;
			let pageURL = urlResolver.pageURL;
			
			// Force URLs to HTTPS. If a request fails because of that, too bad.
			if (!Zotero.test) {
				if (url) url = url.replace(schemeRE, 'https://');
				if (pageURL) pageURL = pageURL.replace(schemeRE, 'https://');
			}
			
			// Ignore URLs we've already tried
			if (url && isTriedURL(url)) {
				Zotero.debug(`File at ${url} was already tried -- skipping`);
				url = null;
			}
			if (pageURL && isTriedURL(pageURL)) {
				Zotero.debug(`Page at ${pageURL} was already tried -- skipping`);
				pageURL = null;
			}
			
			if (!url && !pageURL) {
				continue;
			}

			if (urlResolver.referrer) {
				options.referrer = urlResolver.referrer;
			}
			if (options.onAccessMethodStart) {
				options.onAccessMethodStart(urlResolver.accessMethod);
				delete options.onAccessMethod;
			}
			
			// Try URL first if available
			if (url) {
				addTriedURL(url);
				// Backoff loop
				let tries = 3;
				while (tries-- > 0) {
					try {
						await beforeRequest(url);
						// Waiting here blocks every other item in the queue, so
						// keep it short and leave longer backoff and Retry-After
						// to the loop below
						await this.downloadFile(
							url,
							path,
							{ ...options, errorDelayMax: 7500, noRetryOnThrottle: true }
						);
						afterRequest(url);
						return { url, props: urlResolver };
					}
					catch (e) {
						Zotero.debug(`Error downloading ${url}: ${e}\n\n${e.stack}`);
						if (handleRequestError(e)) {
							continue;
						}
					}
					break;
				}
			}
			
			// If URL wasn't available or failed, try to get a URL from a page
			if (pageURL) {
				url = null;
				let title = null;
				let mimeType = null;
				let responseURL;
				try {
					Zotero.debug(`Looking for file on ${pageURL}`);
					
					let nextURL = pageURL;
					let req;
					let blob;
					let doc;
					let contentType;
					let skip = false;
					let domains = new Set();
					let redirectLimit = 10;
					let redirectURLTries = new Map();
					let clearedChallenges = new Set();
					while (true) {
						if (redirectLimit == 0) {
							Zotero.debug("Too many redirects -- stopping");
							skip = true;
							break;
						}
						
						let domain = urlToDomain(nextURL);
						let noDelay = domains.has(domain);
						domains.add(domain);
						
						// Backoff loop
						let tries = 3;
						while (tries-- > 0) {
							try {
								await beforeRequest(nextURL, noDelay);
								req = await Zotero.HTTP.request(
									'GET',
									nextURL,
									{
										responseType: 'blob',
										followRedirects: false,
										// Use our own error handling
										errorDelayMax: 0,
									}
								);
							}
							catch (e) {
								if (handleRequestError(e)) {
									// Even if this was initially a same-domain redirect, we should
									// now obey delays, since we just set one
									noDelay = false;
									continue;
								}
							}
							break;
						}
						afterRequest(nextURL);
						if (!req) {
							break;
						}
						if ([301, 302, 303, 307].includes(req.status)) {
							let location = req.getResponseHeader('Location');
							if (!location) {
								throw new Error("Location header not provided");
							}
							
							let currentURL = nextURL;
							
							nextURL = Services.io.newURI(nextURL, null, null).resolve(location);
							if (isTriedURL(nextURL)) {
								Zotero.debug("Redirect URL has already been tried -- skipping");
								skip = true;
								break;
							}
							
							// Keep track of tries for each redirect URL, and stop if too many
							let maxTriesPerRedirectURL = 2;
							let tries = (redirectURLTries.get(currentURL) || 0) + 1;
							if (tries > maxTriesPerRedirectURL) {
								Zotero.debug(`Too many redirects to ${currentURL} -- stopping`);
								skip = true;
								break;
							}
							redirectURLTries.set(currentURL, tries);
							// And keep track of total redirects for this chain
							redirectLimit--;
							continue;
						}
						
						blob = req.response;
						responseURL = req.responseURL;
						if (pageURL != responseURL) {
							Zotero.debug("Redirected to " + responseURL);
						}
						
						contentType = req.getResponseHeader('Content-Type');
						if (contentType.startsWith('text/html')) {
							doc = await Zotero.Utilities.Internal.blobToHTMLDocument(blob, responseURL);
							
							// Check for a meta redirect on HTML pages
							let refreshURL = Zotero.HTTP.getHTMLMetaRefreshURL(doc, responseURL);
							if (refreshURL) {
								// If the refresh points at a known bot-challenge host, the
								// interstitial runs JS that a plain request can't satisfy. Run
								// it once in a hidden browser to bank the resulting cookies,
								// then retry the page over the normal path.
								let challengeEntry = Zotero.BrowserRequest.getEntryForURL(refreshURL);
								if (challengeEntry && !clearedChallenges.has(responseURL)) {
									clearedChallenges.add(responseURL);
									try {
										await Zotero.BrowserRequest.clearChallenge(
											responseURL,
											{ entry: challengeEntry }
										);
										doc = null;
										nextURL = responseURL;
										redirectLimit--;
										continue;
									}
									catch (e) {
										Zotero.debug(`Failed to clear challenge at ${responseURL}: ${e}`);
										skip = true;
										break;
									}
								}
								if (isTriedURL(refreshURL)) {
									Zotero.debug("Meta refresh URL has already been tried -- skipping");
									skip = true;
									break;
								}
								doc = null;
								nextURL = refreshURL;
								redirectLimit--;
								continue;
							}
							// ProQuest does a JS redirect back to the original page after authenticating
							// Simulate that ourselves
							else if (responseURL === 'https://www.proquest.com/intermediateredirectforezproxy') {
								doc = null;
								nextURL = pageURL;
								continue;
							}
						}
						
						// Don't try this page URL again
						//
						// We only do this for URLs that don't redirect, since some sites seem to
						// use redirects plus cookies for IP-based authentication [1]. The downside
						// is that we might follow the same set of redirects more than once, but we
						// won't process the final page multiple times, and if a publisher URL does
						// redirect that's hopefully a decent indication that a file will be found
						// the first time around.
						//
						// [1] https://forums.zotero.org/discussion/81182
						addTriedURL(responseURL);
						
						break;
					}
					if (skip) {
						continue;
					}
					
					// If DOI resolves directly to a file, save it to disk
					if (contentType && this.FIND_AVAILABLE_FILE_TYPES.some(type => contentType.startsWith(type))) {
						Zotero.debug("URL resolves directly to file");
						await Zotero.File.putContentsAsync(path, blob);
						await _enforceFileType(path);
						return { url: responseURL, props: urlResolver };
					}
					// Otherwise translate the Document we parsed above
					else if (doc) {
						({ title, mimeType, url } = await Zotero.Utilities.Internal.getFileFromDocument(doc));
					}
				}
				catch (e) {
					Zotero.debug(`Error getting file from ${pageURL}: ${e}\n\n${e.stack}`);
					continue;
				}
				if (!url) {
					Zotero.debug(`No file found on ${responseURL || pageURL}`);
					continue;
				}
				if (isTriedURL(url)) {
					Zotero.debug(`File at ${url} was already tried -- skipping`);
					continue;
				}
				// Don't try this file URL again
				addTriedURL(url);
				
				// Use the page we loaded as the referrer
				let downloadOptions = Object.assign({}, options, { referrer: responseURL });
				// Backoff loop
				let tries = 3;
				while (tries-- >= 0) {
					try {
						await beforeRequest(url);
						await this.downloadFile(url, path, downloadOptions);
						afterRequest(url);
						return { title, mimeType, url, props: urlResolver };
					}
					catch (e) {
						Zotero.debug(`Error downloading ${url}: ${e}\n\n${e.stack}`);
						if (handleRequestError(e)) {
							continue;
						}
					}
					break;
				}
			}
		}
		return false;
	};
};
