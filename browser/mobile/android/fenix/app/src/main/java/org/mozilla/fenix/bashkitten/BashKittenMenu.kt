// SPDX-License-Identifier: AGPL-3.0-only
package org.mozilla.fenix.bashkitten

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.bashkitten.AgentSettingsActivity
import org.mozilla.fenix.components.menu.compose.MenuDialogBottomSheet
import org.mozilla.fenix.components.menu.compose.MenuFrame
import org.mozilla.fenix.components.menu.compose.MenuGroup
import org.mozilla.fenix.components.menu.compose.MenuHandleState
import org.mozilla.fenix.components.menu.compose.MenuItem
import org.mozilla.fenix.theme.FirefoxTheme
import mozilla.components.ui.icons.R as iconsR
import com.bashkitten.R as agentR

/** Separate settings gear, using the same menu primitives as the browser menu. */
class BashKittenMenuDialog : BottomSheetDialogFragment() {
    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View =
        ComposeView(requireContext()).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                FirefoxTheme {
                    MenuDialogBottomSheet(
                        modifier = Modifier.padding(vertical = 16.dp).width(32.dp),
                        onRequestDismiss = ::dismiss,
                        menuHandleState = MenuHandleState(contentDescription = "Close BashKitten settings"),
                        snackbarHostState = remember { SnackbarHostState() },
                    ) {
                        MenuFrame(contentModifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                            MenuGroup {
                                val rows = listOf(
                                    Triple("display", "Display setup", agentR.drawable.ic_agent_display),
                                    Triple("localai", "Local AI", iconsR.drawable.mozac_ic_sparkle_24),
                                    Triple("notifications", "Notifications", iconsR.drawable.mozac_ic_notification_24),
                                    Triple("phone-use", "Phone use", iconsR.drawable.mozac_ic_device_mobile_24),
                                    Triple("remotes", "Remote Connections", iconsR.drawable.mozac_ic_link_24),
                                    Triple("telephone", "Telephone", agentR.drawable.ic_agent_phone),
                                    Triple("performance", "Performance", agentR.drawable.ic_agent_performance),
                                    Triple("providers", "Providers", iconsR.drawable.mozac_ic_extension_24),
                                    Triple("general", "General", iconsR.drawable.mozac_ic_settings_24),
                                )
                                for ((section, title, icon) in rows) {
                                    MenuItem(label = title, beforeIconPainter = painterResource(icon), onClick = {
                                        val host = requireActivity()
                                        dismiss()
                                        host.window.decorView.post {
                                            if (!host.isFinishing && !host.isDestroyed) AgentSettingsActivity.open(host, section)
                                        }
                                    })
                                }
                            }
                        }
                    }
                }
            }
        }
}
