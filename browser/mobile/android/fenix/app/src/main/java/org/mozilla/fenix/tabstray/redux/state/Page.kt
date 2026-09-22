/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.tabstray.redux.state

/**
 * The different pages in the Tab Manager.
 */
enum class Page {

    /**
     * The page that displays normal tabs.
     */
    NormalTabs,

    /**
     * The page that displays private tabs.
     */
    PrivateTabs,

    /**
     * The page that displays Tab Groups.
     */
    TabGroups,

    /** Tabs with a browser-owned Tor route. */
    TorTabs,

    /**
     * The page that displays Synced Tabs.
     */
    SyncedTabs,
    ;

    companion object {
        /**
         * Returns the visible [Page]s in tray order.
         *
         * @param shouldShowTabGroupsPage Whether the tab groups page should be included.
         */
        @Suppress("UNUSED_PARAMETER")
        fun visiblePages(shouldShowTabGroupsPage: Boolean): List<Page> =
            listOf(NormalTabs, PrivateTabs, TorTabs)

        /**
         * Returns the [Page] that corresponds to the [position].
         *
         * @param position The index of the page.
         * @param shouldShowTabGroupsPage Whether the tab groups page should be included.
         */
        fun positionToPage(position: Int, shouldShowTabGroupsPage: Boolean = false): Page {
            return visiblePages(shouldShowTabGroupsPage).getOrElse(position) { NormalTabs }
        }

        /**
         * Returns the visual index that corresponds to the [page].
         *
         * @param page The [Page] whose visual index is being looked-up.
         * @param shouldShowTabGroupsPage Whether the tab groups page should be included.
         */
        fun pageToPosition(page: Page, shouldShowTabGroupsPage: Boolean = false): Int {
            return visiblePages(shouldShowTabGroupsPage).indexOf(page).coerceAtLeast(0)
        }
    }
}
