// SPDX-License-Identifier: AGPL-3.0-only
package org.mozilla.fenix.bashkitten

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.bashkitten.display.DisplayTabs
import mozilla.components.compose.browser.toolbar.ActionContainer
import mozilla.components.compose.browser.toolbar.concept.Action
import mozilla.components.compose.browser.toolbar.store.BrowserToolbarStore
import mozilla.components.lib.state.ext.observeAsComposableState
import org.mozilla.fenix.HomeActivity
import org.mozilla.fenix.components.toolbar.DisplayActions
import org.mozilla.fenix.components.toolbar.TabCounterInteractions
import com.bashkitten.R as agentR

/** Display has no page origin; Firefox still owns its tab/menu actions and menus. */
@Composable
fun DisplayToolbar(activity: HomeActivity, store: BrowserToolbarStore) {
    val state by store.observeAsComposableState { it.displayState }
    val actions = (state.browserActionsStart + state.browserActionsEnd + state.navigationActions)
        .filter { action ->
            action is Action.TabCounterAction || action is Action.ActionButtonRes &&
                (action.onClick is DisplayActions.MenuClicked ||
                    action.onClick is TabCounterInteractions.AddNewTab ||
                    action.onClick is TabCounterInteractions.AddNewPrivateTab)
        }.distinctBy { action ->
            if (action is Action.ActionButtonRes) action.onClick::class else action::class
        }.sortedBy { action ->
            if (action is Action.ActionButtonRes && action.onClick is DisplayActions.MenuClicked) 1 else 0
        }
    Row(
        modifier = Modifier.fillMaxWidth().height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AgentButton { activity.showBashKittenAgent() }
        Spacer(Modifier.weight(1f))
        IconToggleButton(
            checked = true,
            onCheckedChange = { DisplayTabs.toggle(activity, "local") },
            modifier = Modifier.size(48.dp),
            colors = IconButtonDefaults.iconToggleButtonColors(
                checkedContainerColor = colorResource(agentR.color.bashkitten_button),
                checkedContentColor = MaterialTheme.colorScheme.onSurface,
            ),
        ) {
            Icon(painterResource(agentR.drawable.ic_agent_display), contentDescription = "Display")
        }
        IconButton(
            onClick = { BashKittenMenuDialog().show(activity.supportFragmentManager, "bashkitten-settings-menu") },
            modifier = Modifier.size(48.dp),
        ) {
            Icon(painterResource(agentR.drawable.ic_agent_gear), contentDescription = "Configuration")
        }
        ActionContainer(actions = actions, onInteraction = { store.dispatch(it) })
    }
}
