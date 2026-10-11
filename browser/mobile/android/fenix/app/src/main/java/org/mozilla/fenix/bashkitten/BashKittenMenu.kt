// SPDX-License-Identifier: AGPL-3.0-only
package org.mozilla.fenix.bashkitten

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.bashkitten.AgentControls.Control
import com.bashkitten.BrowserApp
import org.mozilla.fenix.components.menu.compose.MenuGroup
import org.mozilla.fenix.components.menu.compose.MenuItem
import org.mozilla.fenix.components.menu.compose.MenuItemState
import mozilla.components.ui.icons.R as iconsR
import com.bashkitten.R as agentR

/** Uses Fenix's existing menu rows, scrolling, colors and click handling. */
@Composable
internal fun BashKittenMenu(onSelect: (Control) -> Unit) {
    val local = BrowserApp.get(LocalContext.current).agent.selected == "local"
    HorizontalDivider()
    Text(
        text = "BashKitten controls",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
    MenuGroup {
        MenuItem(
            label = "Local AI",
            beforeIconPainter = painterResource(iconsR.drawable.mozac_ic_sparkle_24),
            state = if (local) MenuItemState.ENABLED else MenuItemState.DISABLED,
            onClick = { onSelect(Control.LOCAL_AI) },
        )
        MenuItem(
            label = "Notifications",
            beforeIconPainter = painterResource(iconsR.drawable.mozac_ic_notification_24),
            onClick = { onSelect(Control.NOTIFICATIONS) },
        )
        MenuItem(
            label = "Phone/Computer Use",
            beforeIconPainter = painterResource(iconsR.drawable.mozac_ic_device_mobile_24),
            onClick = { onSelect(Control.PHONE_USE) },
        )
        MenuItem(
            label = "Remote Connections",
            beforeIconPainter = painterResource(iconsR.drawable.mozac_ic_link_24),
            onClick = { onSelect(Control.REMOTES) },
        )
        MenuItem(
            label = "Telephone",
            beforeIconPainter = painterResource(agentR.drawable.ic_agent_phone),
            onClick = { onSelect(Control.TELEPHONE) },
        )
        MenuItem(
            label = "Performance",
            beforeIconPainter = painterResource(agentR.drawable.ic_agent_performance),
            onClick = { onSelect(Control.PERFORMANCE) },
        )
    }
}
