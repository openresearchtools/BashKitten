// SPDX-License-Identifier: AGPL-3.0-only
package org.mozilla.fenix.tabstray.ui.tabpage

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.mozilla.fenix.tabstray.controller.TabInteractionHandler
import org.mozilla.fenix.tabstray.data.TabsTrayItem
import org.mozilla.fenix.tabstray.redux.state.TabsTrayState

/** The native tab layout over the persisted Files presentation partition. */
@Composable
internal fun FilesTabsPage(
    state: TabsTrayState,
    onTabClose: (TabsTrayItem.Tab) -> Unit,
    onItemClick: (TabsTrayItem) -> Unit,
    onItemLongClick: (TabsTrayItem) -> Unit,
    tabInteractionHandler: TabInteractionHandler,
) {
    if (state.filesTabsState.items.isEmpty()) {
        Text("No Files tabs open", Modifier.padding(24.dp))
    } else {
        TabLayout(
            tabs = state.filesTabsState.items,
            displayTabsInGrid = state.config.displayTabsInGrid,
            tabInteractionHandler = tabInteractionHandler,
            selectedItemIndex = state.filesTabsState.selectedItemIndex,
            selectionMode = state.mode,
            modifier = Modifier.testTag("files_tabs_list"),
            onTabClose = onTabClose,
            onItemClick = onItemClick,
            onItemLongClick = onItemLongClick,
            onDeleteTabGroupClick = {},
            onEditTabGroupClick = {},
            onCloseTabGroupClick = {},
            onTabGroupOnboardingDismiss = {},
            dragAndDropEnabled = false,
            displayTabGroupOnboarding = false,
            focusEnabled = true,
        )
    }
}
