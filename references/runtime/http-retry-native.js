/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2011 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

// BashKitten 2026-10-28: native retry methods and delay generator from Zotero 10.0.6.
// Node transport already rejects certificate/network errors; only native UI checks are omitted.
module.exports = function(base, context) {
const Zotero={...base, Promise:class extends Promise {}, Utilities:{...base.Utilities,Internal:{...base.Utilities.Internal}}};
Zotero.Promise.delay=context.delay;
const _checkConnection=()=>{};
const _errorDelayIntervals=[2500,5000,10000,20000,40000,60000,120000,240000,300000];
const _errorDelayMax=60*60*1000;
Zotero.Utilities.Internal.delayGenerator = function* (intervals, maxTime) {
		var delay;
		var totalTime = 0;
		intervals = intervals.slice();
		while (true) {
			let interval = intervals.shift();
			if (interval) {
				delay = interval;
			}
			
			// Be safe
			if (!delay) {
				Zotero.logError(`Incorrect delay ${delay} -- stopping`);
				yield Promise.resolve(false);
			}
			
			if (maxTime && (totalTime + delay) > maxTime) {
				Zotero.debug(`Total delay time exceeds ${maxTime} -- stopping`);
				yield Promise.resolve(false);
			}
			
			totalTime += delay;
			
			Zotero.debug("Delaying " + delay + " ms");
			yield Zotero.Promise.delay(delay).then(() => true);
		}
	};
	function _getRetryAfter(req) {
		// req may be an XMLHttpRequest (from request()) or a fetch Response
		// (from download())
		var retryAfter = req.headers?.get
			? req.headers.get("Retry-After")
			: req.getResponseHeader("Retry-After");
		if (!retryAfter) {
			return null;
		}
		if (parseInt(retryAfter) != retryAfter) {
			Zotero.logError(`Invalid Retry-After delay ${retryAfter}`);
			return null;
		}
		return parseInt(retryAfter);
	}

	async function _checkRetry(req) {
		var retryAfter = _getRetryAfter(req);
		if (retryAfter === null) {
			return false;
		}
		Zotero.debug(`Delaying ${retryAfter} seconds for Retry-After`);
		await Zotero.Promise.delay(retryAfter * 1000);
		return true;
	}


	/**
	 * Call `fn` and automatically retry on 429/5xx errors, honoring Retry-After
	 * for 429 and 503 and falling back to exponential backoff otherwise.
	 *
	 * @param {Function} fn - Async function to call (should throw
	 *     UnexpectedStatusException on failure)
	 * @param {String} url - URL being requested (for _checkConnection)
	 * @param {Object} options - Must contain errorDelayIntervals, errorDelayMax,
	 *     and cancellerReceiver if applicable
	 * @return {Promise} - Result of fn()
	 */
	async function _retryOnServerError(fn, url, options) {
		var errorDelayGenerator;

		while (true) {
			try {
				return await fn();
			}
			catch (e) {
				if (e instanceof Zotero.HTTP.UnexpectedStatusException) {
					_checkConnection(e.xmlhttp, url);

					// Callers that handle server-signaled throttling themselves
					// (e.g., to pause a batch of concurrent requests) opt out of
					// automatic 429 and 503-with-Retry-After retries
					if (options.noRetryOnThrottle
							&& (e.status == 429
								|| (e.status == 503 && _getRetryAfter(e.xmlhttp) !== null))) {
						throw e;
					}

					if (e.status == 429 || e.is5xx()) {
						Zotero.logError(e);
						// Check for Retry-After header on 429 or 503
						if ((e.status == 429 || e.status == 503)
								&& (await _checkRetry(e.xmlhttp))) {
							continue;
						}
						// Don't retry if errorDelayMax is 0
						if (options.errorDelayMax === 0
								|| Zotero.HTTP.disableErrorRetry) {
							throw e;
						}
						// Automatically retry other 429/5xx errors by default
						if (!errorDelayGenerator) {
							// Keep trying for up to an hour
							errorDelayGenerator
								= Zotero.Utilities.Internal.delayGenerator(
									options.errorDelayIntervals
										|| _errorDelayIntervals,
									options.errorDelayMax !== undefined
										? options.errorDelayMax
										: _errorDelayMax
								);
						}
						let delayPromise = errorDelayGenerator.next().value;
						let keepGoing;
						// Provide caller with a callback to cancel
						// while waiting to retry
						if (options.cancellerReceiver) {
							let resolve;
							let reject;
							let cancelPromise = new Zotero.Promise(
								(res, rej) => {
									resolve = res;
									reject = function () {
										rej(new Zotero.HTTP.CancelledException);
									};
								}
							);
							options.cancellerReceiver(reject);
							try {
								keepGoing = await Promise.race(
									[delayPromise, cancelPromise]
								);
							}
							catch (e) {
								Zotero.debug("Request cancelled");
								throw e;
							}
							resolve();
						}
						else {
							keepGoing = await delayPromise;
						}
						if (!keepGoing) {
							Zotero.logError("Failed too many times");
							throw e;
						}
						continue;
					}
				}
				throw e;
			}
		}
	}


return _retryOnServerError;
};
