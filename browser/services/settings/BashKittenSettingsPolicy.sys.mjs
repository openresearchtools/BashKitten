/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tracking protection needs current signed classifier lists. Other collections
// retain the bundled records used by BashKitten's offline features.

// Packaged dump-only collections that active desktop features read at runtime.
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
    return bucket === "main" && collection === "tracking-protection-lists";
  },

  canDownloadAttachments(bucket, collection) {
    return this.canSync(bucket, collection);
  },
};
