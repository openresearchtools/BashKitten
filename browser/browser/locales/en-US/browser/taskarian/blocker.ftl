# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
# Derived from BrowserWorks/l10n commit cc8b91caafb0022b5874358c9a90a155ab74bc79.

## Ad blocking

taskarian-blocker-header = Ad Blocking

taskarian-blocker-intro-description = Blocks ads, tracking scripts, and other unwanted requests for faster page loads and fewer distractions.

taskarian-blocker-setting-on =
    .label = On

taskarian-blocker-setting-on-summary = Blocks ads and trackers with minimal impact on page loading.

taskarian-blocker-setting-on-description = Taskarian blocks the following:

taskarian-blocker-blocks-ads = Ads and ad network requests

taskarian-blocker-blocks-tracking = Tracking scripts and pixels

taskarian-blocker-blocks-annoyances = Nuisance popups and overlays (with annoyance lists enabled)

taskarian-blocker-setting-off =
    .label = Off

taskarian-blocker-setting-off-description = No ads or trackers are blocked by Taskarian. Third-party extensions can still block content independently.

taskarian-blocker-manage-filter-lists =
    .label = Manage Filter Lists…

taskarian-blocker-custom-filter-lists =
    .label = Custom Filter Lists…

taskarian-blocker-filter-lists-window =
    .title = Ad blocking filter lists

taskarian-blocker-filter-lists-dialog =
    .buttonlabelaccept = Save Changes
    .buttonaccesskeyaccept = S

taskarian-blocker-filter-lists-description =
    .value = Choose which filter lists are active.

# Variables:
#   $activeCount (Number) - Number of enabled filter lists.
#   $totalCount (Number) - Total number of available filter lists.
taskarian-blocker-filter-lists-active-count =
    .value = { $activeCount } active of { $totalCount }

taskarian-blocker-filter-lists-column-enabled =
    .label = Enabled

taskarian-blocker-filter-lists-column-name =
    .label = Filter List

taskarian-blocker-filter-lists-column-category =
    .label = Category

taskarian-blocker-filter-lists-enable =
    .label = Enable

taskarian-blocker-filter-lists-disable =
    .label = Disable

taskarian-blocker-extension-detected = Taskarian now has built-in ad blocking. You can review your setup in settings.

taskarian-blocker-extension-detected-learn-more =
    .label = Learn more

taskarian-blocker-extension-detected-dismiss =
    .label = Don’t show again

taskarian-blocker-extension-install-warning = Taskarian already has a built-in ad blocker. Running two ad blockers can cause pages to break or load slowly.

taskarian-blocker-extension-install-got-it =
    .label = Got it

taskarian-blocker-extension-install-learn-more =
    .label = Learn more

# Variables:
#   $extensionName (String) - Name of the third-party extension controlling ad blocking.
taskarian-blocker-third-party-notice-description = { $extensionName } is also blocking ads. Running two ad blockers can cause issues.

permissions-exceptions-taskarian-blocker-window2 =
    .title = Exceptions for Ad Blocking
    .style = { permissions-window2.style }

permissions-exceptions-manage-taskarian-blocker-desc = You can specify which websites have ad blocking turned off. Type the exact address of the site you want to manage and then click Add Exception.

taskarian-blocker-toolbar-button =
    .label = Ad blocking
    .tooltiptext = Ad blocking

taskarian-blocker-panel-not-available = Not available on this page

taskarian-blocker-panel-toggle =
    .label = Ad blocking on this site
    .description = Block ads and trackers on this site.

taskarian-blocker-panel-disabled = Ad blocking is off

taskarian-blocker-panel-site-excepted = Ads allowed on this site

# Variables:
#   $count (Number) - Number of ads blocked on this site.
taskarian-blocker-panel-settings-button = Ad blocking settings

taskarian-blocker-filter-lists-category-core = Default

taskarian-blocker-filter-lists-category-privacy = Privacy

taskarian-blocker-filter-lists-category-annoyances = Annoyances

taskarian-blocker-filter-lists-category-optional = Optional

taskarian-blocker-filter-lists-category-regional = Regional

taskarian-blocker-filter-lists-search =
    .placeholder = Search filter lists…

taskarian-blocker-filter-lists-empty-state = No filter lists available.

taskarian-blocker-filter-lists-refresh-now =
    .label = Refresh Now

# Variables:
#   $date (String) - Human-readable date/time of the last successful list update.
taskarian-blocker-filter-lists-last-updated = Updated { $date }

taskarian-blocker-filter-lists-never-updated =
    .value = Not yet updated

# Variables:
#   $date (String) - Human-readable date/time of the next scheduled list update.
taskarian-blocker-filter-lists-next-refresh =
    .value = Next refresh: { $date }

taskarian-blocker-filter-lists-next-refresh-unknown =
    .value = Next refresh: unknown

taskarian-blocker-custom-filter-lists-window =
    .title = Custom Filter Lists

taskarian-blocker-custom-filter-lists-dialog =
    .buttonlabelaccept = Save Changes
    .buttonaccesskeyaccept = S

taskarian-blocker-custom-filter-lists-description = Add URLs of custom filter lists. Lists will be fetched and applied alongside built-in filters.

taskarian-blocker-filter-lists-custom-heading =
    .value = Custom Filter Lists

taskarian-blocker-filter-lists-custom-input =
    .placeholder = Enter filter list URL…

taskarian-blocker-filter-lists-custom-url-label =
    .value = Filter list URL

taskarian-blocker-filter-lists-custom-col =
    .label = URL

taskarian-blocker-filter-lists-custom-add =
    .label = Add

taskarian-blocker-filter-lists-custom-remove =
    .label = Remove

taskarian-blocker-filter-lists-custom-remove-all =
    .label = Remove All

taskarian-blocker-filter-lists-custom-empty =
    .value = No custom filter lists added.

taskarian-blocker-custom-filters =
    .label = My Filters…

taskarian-blocker-custom-filters-window =
    .title = My Filters

taskarian-blocker-custom-filters-dialog =
    .buttonlabelaccept = Save Changes
    .buttonaccesskeyaccept = S

taskarian-blocker-custom-filters-description = Add your own ad blocking rules. These use standard uBlock Origin filter syntax and are applied alongside your enabled filter lists.

taskarian-blocker-custom-filters-empty =
    .value = No custom filters.

# Variables:
#   $count (Number) - Number of custom filters currently configured.
taskarian-blocker-custom-filters-status =
    { $count ->
        [0] No custom filters.
        [one] 1 custom filter.
       *[other] { $count } custom filters.
    }

taskarian-blocker-custom-filters-status-unsaved = Unsaved changes.

taskarian-blocker-custom-filters-import =
    .label = Import…

taskarian-blocker-custom-filters-export =
    .label = Export…

taskarian-blocker-custom-filters-load-error-title = Load failed

taskarian-blocker-custom-filters-load-error = Custom filters could not be loaded.

taskarian-blocker-custom-filters-save-error-title = Save failed

taskarian-blocker-custom-filters-save-error = Custom filters could not be saved.

taskarian-blocker-custom-filters-import-error-title = Import failed

taskarian-blocker-custom-filters-import-error = The selected file could not be imported.

taskarian-blocker-custom-filters-export-error-title = Export failed

taskarian-blocker-custom-filters-export-error = Custom filters could not be exported.

taskarian-blocker-custom-filters-import-picker-title = Import custom filters

taskarian-blocker-custom-filters-export-picker-title = Export custom filters

taskarian-blocker-custom-filters-import-replace-title = Replace current filters?

taskarian-blocker-custom-filters-import-replace-message = Importing will replace everything currently in the editor.

taskarian-blocker-extension-fallback-name-this = this extension

taskarian-blocker-extension-fallback-name-your = your extension

taskarian-blocker-spotlight-title = Taskarian now includes ad blocking

# Variables:
#   $extensionName (String) - Name of the user’s existing ad-blocking extension.
taskarian-blocker-spotlight-subtitle = We noticed you have { $extensionName } installed. Taskarian also includes a built-in blocker. Choose the setup you prefer.

taskarian-blocker-spotlight-primary-button = Keep my current setup

taskarian-blocker-spotlight-secondary-button = Review settings

taskarian-blocker-prompt-title = Taskarian ad blocking

# Variables:
#   $extensionName (String) - Name of the extension that conflicts with built-in ad blocking.
taskarian-blocker-reenable-conflict-message = Running both Taskarian ad blocking and “{ $extensionName }” can cause pages to break. Which would you like to keep?

taskarian-blocker-reenable-use-built-in = Use built-in blocker

taskarian-blocker-reenable-keep-extension = Keep extension blocker

taskarian-blocker-extension-install-manage-settings = You can manage ad blocking in Settings > Ad Blocking.

taskarian-blocker-extension-install-anyway = Install anyway

taskarian-blocker-extension-install-keep-built-in = Keep using built-in blocker

pane-taskarian-blocker-title = Ad Blocking
    .title = { pane-taskarian-blocker-title }

taskarian-blocker-pane-header =
    .heading = Ad Blocking

taskarian-blocker-group =
    .label = Ad blocking
    .description = Blocks ads, tracking scripts, and other unwanted requests for faster page loads and fewer distractions.

taskarian-blocker-enabled-toggle =
    .label = Block ads and trackers
    .description = Blocks ads and trackers with minimal impact on page loading.

taskarian-cookie-banners-enabled-toggle =
    .label = Automatically dismiss cookie banners
    .description = Reject optional cookies on supported sites and hide cookie banners. Turn off to handle banners yourself. Reload open pages after changing this setting.

# Variables:
#   $extensionName (String) - Name of the third-party extension that also blocks ads.
taskarian-blocker-extension-notice =
    .message = { $extensionName } is also blocking ads. Running two ad blockers can cause issues.

taskarian-blocker-lists-group =
    .label = Filter lists
    .description = Cookie-banner lists apply only when Automatically dismiss cookie banners is on.

taskarian-blocker-manage-lists-button =
    .label = Manage filter lists

taskarian-blocker-custom-lists-button =
    .label = Custom filter lists

taskarian-blocker-my-filters-button =
    .label = My filters

taskarian-blocker-exceptions-group =
    .label = Exceptions

taskarian-blocker-exceptions-button =
    .label = Manage exceptions

taskarian-blocked-page-title = Taskarian blocked this page

taskarian-blocked-page-heading = Taskarian blocked this page

taskarian-blocked-page-description = This page was blocked by an ad blocking filter rule.

taskarian-blocked-page-details =
    .aria-label = Blocked page details

taskarian-blocked-page-blocked-url-label = Blocked URL

taskarian-blocked-page-matched-rule-label = Matched rule

taskarian-blocked-page-unavailable = Unavailable

taskarian-blocked-page-hint = “Load anyway” will temporarily allow this site for the rest of your session.

taskarian-blocked-page-go-back = Go back

taskarian-blocked-page-load-anyway = Load anyway
