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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import android.widget.Toast
import com.bashkitten.AgentSettingsActivity
import com.bashkitten.BrowserApp
import mozilla.components.compose.browser.toolbar.ActionContainer
import mozilla.components.compose.browser.toolbar.concept.Action
import mozilla.components.compose.browser.toolbar.store.BrowserToolbarStore
import mozilla.components.lib.state.ext.observeAsComposableState
import org.mozilla.fenix.HomeActivity
import org.mozilla.fenix.components.toolbar.DisplayActions
import com.bashkitten.R as agentR
import mozilla.components.ui.icons.R as iconsR

/** Display has no page origin; Firefox still owns its tab/menu actions and menus. */
@Composable
fun DisplayToolbar(activity: HomeActivity, store: BrowserToolbarStore) {
    val display = remember(activity) { BrowserApp.get(activity).display }
    var running by remember(display) { mutableStateOf(display.hasSource()) }
    var changing by remember(display) { mutableStateOf(display.isChanging) }
    var interactive by remember(display) { mutableStateOf(display.isInteractive) }
    DisposableEffect(display) {
        val observer = Runnable {
            running = display.hasSource(); changing = display.isChanging; interactive = display.isInteractive
        }
        display.observe(observer)
        onDispose { display.unobserve(observer) }
    }
    val state by store.observeAsComposableState { it.displayState }
    val actions = (state.browserActionsStart + state.browserActionsEnd + state.navigationActions)
        .filter { action ->
            action is Action.ActionButtonRes && action.onClick is DisplayActions.MenuClicked
        }.take(1)
    Row(
        modifier = Modifier.fillMaxWidth().height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AgentEntryButton(activity)
        Spacer(Modifier.weight(1f))
        IconToggleButton(
            checked = running,
            onCheckedChange = { enabled ->
                display.setEnabled(enabled, {}, { Toast.makeText(activity, it, Toast.LENGTH_LONG).show() })
            },
            enabled = !changing,
            modifier = Modifier.size(48.dp).semantics {
                stateDescription = if (changing) "Changing" else if (running) "On" else "Off"
            },
            colors = IconButtonDefaults.iconToggleButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurface,
                checkedContainerColor = colorResource(agentR.color.bashkitten_button),
                checkedContentColor = MaterialTheme.colorScheme.onSurface,
            ),
        ) {
            Icon(painterResource(agentR.drawable.ic_agent_power), contentDescription = "Display service")
        }
        IconButton(
            onClick = { AgentSettingsActivity.open(activity, "display") },
            modifier = Modifier.size(48.dp),
            colors = IconButtonDefaults.iconButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
        ) {
            Icon(painterResource(iconsR.drawable.mozac_ic_edit_24), contentDescription = "Display command")
        }
        IconToggleButton(
            checked = interactive,
            onCheckedChange = { display.interactive(it) },
            modifier = Modifier.size(48.dp).semantics {
                stateDescription = if (interactive) "Interact" else "Observe only"
            },
            colors = IconButtonDefaults.iconToggleButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurface,
                checkedContainerColor = colorResource(agentR.color.bashkitten_button),
                checkedContentColor = MaterialTheme.colorScheme.onSurface,
            ),
        ) {
            Icon(
                painterResource(if (interactive) iconsR.drawable.mozac_ic_cursor_arrow_24 else iconsR.drawable.mozac_ic_eye_24),
                contentDescription = if (interactive) "Interact with desktop" else "Observe desktop",
            )
        }
        IconButton(
            onClick = { BashKittenMenuDialog().show(activity.supportFragmentManager, "bashkitten-settings-menu") },
            modifier = Modifier.size(48.dp),
            colors = IconButtonDefaults.iconButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
        ) {
            Icon(painterResource(agentR.drawable.ic_agent_gear), contentDescription = "Configuration")
        }
        AgentTabsButton(activity)
        ActionContainer(actions = actions, onInteraction = { store.dispatch(it) })
    }
}
