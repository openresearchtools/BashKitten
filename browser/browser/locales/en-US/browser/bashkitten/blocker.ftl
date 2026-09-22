# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
# Derived from BrowserWorks/l10n commit cc8b91caafb0022b5874358c9a90a155ab74bc79.

## Ad blocking

bashkitten-blocker-header = Ad Blocking

bashkitten-blocker-intro-description = Blocks ads, tracking scripts, and other unwanted requests for faster page loads and fewer distractions.

bashkitten-blocker-setting-on =
    .label = On

bashkitten-blocker-setting-on-summary = Blocks ads and trackers with minimal impact on page loading.

bashkitten-blocker-setting-on-description = BashKitten blocks the following:

bashkitten-blocker-blocks-ads = Ads and ad network requests

bashkitten-blocker-blocks-tracking = Tracking scripts and pixels

bashkitten-blocker-blocks-annoyances = Nuisance popups and overlays (with annoyance lists enabled)

bashkitten-blocker-setting-off =
    .label = Off

bashkitten-blocker-setting-off-description = No ads or trackers are blocked by BashKitten. Third-party extensions can still block content independently.

bashkitten-blocker-manage-filter-lists =
    .label = Manage Filter Lists…

bashkitten-blocker-custom-filter-lists =
    .label = Custom Filter Lists…

bashkitten-blocker-filter-lists-window =
    .title = Ad blocking filter lists

bashkitten-blocker-filter-lists-dialog =
    .buttonlabelaccept = Save Changes
    .buttonaccesskeyaccept = S

bashkitten-blocker-filter-lists-description =
    .value = Choose which filter lists are active.

# Variables:
#   $activeCount (Number) - Number of enabled filter lists.
#   $totalCount (Number) - Total number of available filter lists.
bashkitten-blocker-filter-lists-active-count =
    .value = { $activeCount } active of { $totalCount }

bashkitten-blocker-filter-lists-column-enabled =
    .label = Enabled

bashkitten-blocker-filter-lists-column-name =
    .label = Filter List

bashkitten-blocker-filter-lists-column-category =
    .label = Category

bashkitten-blocker-filter-lists-enable =
    .label = Enable

bashkitten-blocker-filter-lists-disable =
    .label = Disable

bashkitten-blocker-extension-detected = BashKitten now has built-in ad blocking. You can review your setup in settings.

bashkitten-blocker-extension-detected-learn-more =
    .label = Learn more

bashkitten-blocker-extension-detected-dismiss =
    .label = Don’t show again

bashkitten-blocker-extension-install-warning = BashKitten already has a built-in ad blocker. Running two ad blockers can cause pages to break or load slowly.

bashkitten-blocker-extension-install-got-it =
    .label = Got it

bashkitten-blocker-extension-install-learn-more =
    .label = Learn more

# Variables:
#   $extensionName (String) - Name of the third-party extension controlling ad blocking.
bashkitten-blocker-third-party-notice-description = { $extensionName } is also blocking ads. Running two ad blockers can cause issues.

permissions-exceptions-bashkitten-blocker-window2 =
    .title = Exceptions for Ad Blocking
    .style = { permissions-window2.style }

permissions-exceptions-manage-bashkitten-blocker-desc = You can specify which websites have ad blocking turned off. Type the exact address of the site you want to manage and then click Add Exception.

bashkitten-blocker-toolbar-button =
    .label = Ad blocking
    .tooltiptext = Ad blocking

bashkitten-blocker-panel-not-available = Not available on this page

bashkitten-blocker-panel-toggle =
    .label = Ad blocking on this site
    .description = Block ads and trackers on this site.

bashkitten-blocker-panel-disabled = Ad blocking is off

bashkitten-blocker-panel-site-excepted = Ads allowed on this site

# Variables:
#   $count (Number) - Number of ads blocked on this site.
bashkitten-blocker-panel-settings-button = Ad blocking settings

bashkitten-blocker-filter-lists-category-core = Default

bashkitten-blocker-filter-lists-category-privacy = Privacy

bashkitten-blocker-filter-lists-category-annoyances = Annoyances

bashkitten-blocker-filter-lists-category-optional = Optional

bashkitten-blocker-filter-lists-category-regional = Regional

bashkitten-blocker-filter-lists-search =
    .placeholder = Search filter lists…

bashkitten-blocker-filter-lists-empty-state = No filter lists available.

bashkitten-blocker-filter-lists-refresh-now =
    .label = Refresh Now

# Variables:
#   $date (String) - Human-readable date/time of the last successful list update.
bashkitten-blocker-filter-lists-last-updated = Updated { $date }

bashkitten-blocker-filter-lists-never-updated =
    .value = Not yet updated

# Variables:
#   $date (String) - Human-readable date/time of the next scheduled list update.
bashkitten-blocker-filter-lists-next-refresh =
    .value = Next refresh: { $date }

bashkitten-blocker-filter-lists-next-refresh-unknown =
    .value = Next refresh: unknown

bashkitten-blocker-custom-filter-lists-window =
    .title = Custom Filter Lists

bashkitten-blocker-custom-filter-lists-dialog =
    .buttonlabelaccept = Save Changes
    .buttonaccesskeyaccept = S

bashkitten-blocker-custom-filter-lists-description = Add URLs of custom filter lists. Lists will be fetched and applied alongside built-in filters.

bashkitten-blocker-filter-lists-custom-heading =
    .value = Custom Filter Lists

bashkitten-blocker-filter-lists-custom-input =
    .placeholder = Enter filter list URL…

bashkitten-blocker-filter-lists-custom-url-label =
    .value = Filter list URL

bashkitten-blocker-filter-lists-custom-col =
    .label = URL

bashkitten-blocker-filter-lists-custom-add =
    .label = Add

bashkitten-blocker-filter-lists-custom-remove =
    .label = Remove

bashkitten-blocker-filter-lists-custom-remove-all =
    .label = Remove All

bashkitten-blocker-filter-lists-custom-empty =
    .value = No custom filter lists added.

bashkitten-blocker-custom-filters =
    .label = My Filters…

bashkitten-blocker-custom-filters-window =
    .title = My Filters

bashkitten-blocker-custom-filters-dialog =
    .buttonlabelaccept = Save Changes
    .buttonaccesskeyaccept = S

bashkitten-blocker-custom-filters-description = Add your own ad blocking rules. These use standard uBlock Origin filter syntax and are applied alongside your enabled filter lists.

bashkitten-blocker-custom-filters-empty =
    .value = No custom filters.

# Variables:
#   $count (Number) - Number of custom filters currently configured.
bashkitten-blocker-custom-filters-status =
    { $count ->
        [0] No custom filters.
        [one] 1 custom filter.
       *[other] { $count } custom filters.
    }

bashkitten-blocker-custom-filters-status-unsaved = Unsaved changes.

bashkitten-blocker-custom-filters-import =
    .label = Import…

bashkitten-blocker-custom-filters-export =
    .label = Export…

bashkitten-blocker-custom-filters-load-error-title = Load failed

bashkitten-blocker-custom-filters-load-error = Custom filters could not be loaded.

bashkitten-blocker-custom-filters-save-error-title = Save failed

bashkitten-blocker-custom-filters-save-error = Custom filters could not be saved.

bashkitten-blocker-custom-filters-import-error-title = Import failed

bashkitten-blocker-custom-filters-import-error = The selected file could not be imported.

bashkitten-blocker-custom-filters-export-error-title = Export failed

bashkitten-blocker-custom-filters-export-error = Custom filters could not be exported.

bashkitten-blocker-custom-filters-import-picker-title = Import custom filters

bashkitten-blocker-custom-filters-export-picker-title = Export custom filters

bashkitten-blocker-custom-filters-import-replace-title = Replace current filters?

bashkitten-blocker-custom-filters-import-replace-message = Importing will replace everything currently in the editor.

bashkitten-blocker-extension-fallback-name-this = this extension

bashkitten-blocker-extension-fallback-name-your = your extension

bashkitten-blocker-spotlight-title = BashKitten now includes ad blocking

# Variables:
#   $extensionName (String) - Name of the user’s existing ad-blocking extension.
bashkitten-blocker-spotlight-subtitle = We noticed you have { $extensionName } installed. BashKitten also includes a built-in blocker. Choose the setup you prefer.

bashkitten-blocker-spotlight-primary-button = Keep my current setup

bashkitten-blocker-spotlight-secondary-button = Review settings

bashkitten-blocker-prompt-title = BashKitten ad blocking

# Variables:
#   $extensionName (String) - Name of the extension that conflicts with built-in ad blocking.
bashkitten-blocker-reenable-conflict-message = Running both BashKitten ad blocking and “{ $extensionName }” can cause pages to break. Which would you like to keep?

bashkitten-blocker-reenable-use-built-in = Use built-in blocker

bashkitten-blocker-reenable-keep-extension = Keep extension blocker

bashkitten-blocker-extension-install-manage-settings = You can manage ad blocking in Settings > Ad Blocking.

bashkitten-blocker-extension-install-anyway = Install anyway

bashkitten-blocker-extension-install-keep-built-in = Keep using built-in blocker

pane-bashkitten-blocker-title = Ad Blocking
    .title = { pane-bashkitten-blocker-title }

bashkitten-blocker-pane-header =
    .heading = Ad Blocking

bashkitten-blocker-group =
    .label = Ad blocking
    .description = Blocks ads, tracking scripts, and other unwanted requests for faster page loads and fewer distractions.

bashkitten-blocker-enabled-toggle =
    .label = Block ads and trackers
    .description = Blocks ads and trackers with minimal impact on page loading.

# Variables:
#   $extensionName (String) - Name of the third-party extension that also blocks ads.
bashkitten-blocker-extension-notice =
    .message = { $extensionName } is also blocking ads. Running two ad blockers can cause issues.

bashkitten-blocker-lists-group =
    .label = Filter lists

bashkitten-blocker-manage-lists-button =
    .label = Manage filter lists

bashkitten-blocker-custom-lists-button =
    .label = Custom filter lists

bashkitten-blocker-my-filters-button =
    .label = My filters

bashkitten-blocker-exceptions-group =
    .label = Exceptions

bashkitten-blocker-exceptions-button =
    .label = Manage exceptions

bashkitten-blocked-page-title = BashKitten blocked this page

bashkitten-blocked-page-heading = BashKitten blocked this page

bashkitten-blocked-page-description = This page was blocked by an ad blocking filter rule.

bashkitten-blocked-page-details =
    .aria-label = Blocked page details

bashkitten-blocked-page-blocked-url-label = Blocked URL

bashkitten-blocked-page-matched-rule-label = Matched rule

bashkitten-blocked-page-unavailable = Unavailable

bashkitten-blocked-page-hint = “Load anyway” will temporarily allow this site for the rest of your session.

bashkitten-blocked-page-go-back = Go back

bashkitten-blocked-page-load-anyway = Load anyway
