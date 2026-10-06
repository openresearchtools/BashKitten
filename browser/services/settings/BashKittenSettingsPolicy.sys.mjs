/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Keep certificate, extension and tracking protection data current using Gecko's
// signed Remote Settings clients. All other collections remain offline.
const SECURITY_COLLECTIONS = new Set([
  "security-state/onecrl",
  "security-state/intermediates",
  "security-state/cert-revocations",
  "blocklists/addons",
  "blocklists/addons-bloomfilters",
  "blocklists/gfx",
  "main/tracking-protection-lists",
  "main/anti-tracking-url-decoration",
  "main/query-stripping",
  "main/partitioning-exempt-urls",
  "main/url-classifier-exceptions",
  "main/bounce-tracking-protection-exceptions",
  "main/cookie-banner-rules-list",
]);

// Packaged collections that active desktop features also need offline.
const REQUIRED_OFFLINE_DUMPS = Object.freeze([
  ["main", "ai-window-prompts"],
  ["main", "anti-tracking-url-decoration"],
  ["main", "cookie-banner-rules-list"],
  ["main", "devtools-compatibility-browsers"],
  ["main", "devtools-devices"],
  ["main", "doh-config"],
  ["main", "doh-providers"],
  ["main", "hijack-blocklists"],
  ["main", "language-dictionaries"],
  ["main", "moz-essential-domain-fallbacks"],
  ["main", "newtab-wallpapers-v2"],
  ["main", "password-recipes"],
  ["main", "password-rules"],
  ["main", "remote-permissions"],
  ["main", "search-default-override-allowlist"],
  ["main", "search-telemetry-v2"],
  ["main", "sites-classification"],
  ["main", "top-sites"],
  ["main", "translations-models-v2"],
  ["main", "translations-wasm-v2"],
  ["main", "url-parser-default-unknown-schemes-interventions"],
  ["main", "urlbar-persisted-search-terms"],
  ["main", "websites-with-shared-credential-backends"],
]);

export const BashKittenSettingsPolicy = {
  requiredOfflineDumps: REQUIRED_OFFLINE_DUMPS,

  canSync(bucket, collection) {
    return SECURITY_COLLECTIONS.has(`${bucket}/${collection}`);
  },

  canDownloadAttachments(bucket, collection) {
    return this.canSync(bucket, collection);
  },
};
