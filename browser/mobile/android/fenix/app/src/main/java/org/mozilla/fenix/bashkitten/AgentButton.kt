// SPDX-License-Identifier: AGPL-3.0-only
package org.mozilla.fenix.bashkitten

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import mozilla.components.lib.state.ext.observeAsComposableState
import mozilla.components.ui.tabcounter.TabCounter
import org.mozilla.fenix.HomeActivity
import org.mozilla.fenix.R
import org.mozilla.fenix.ext.components

@Composable
fun AgentLogo() {
    Image(
        painter = painterResource(R.drawable.bashkitten_logo),
        contentDescription = null,
        modifier = Modifier.size(28.dp),
    )
}

@Composable
fun AgentButton(onClick: () -> Unit) {
    val label = stringResource(R.string.bashkitten_agent)
    IconButton(onClick = onClick, modifier = Modifier.size(48.dp).semantics { contentDescription = label }) { AgentLogo() }
}

/** The visible Agent pane already owns the logo and its sidebar action. */
@Composable
fun AgentEntryButton(activity: HomeActivity) {
    if (!activity.bashKittenAgentVisible.value) {
        AgentButton { activity.bashKittenAgentPanel?.showAgentBesideBrowser() }
    }
}

/** Keep the same native counter and overview available outside page toolbars. */
@Composable
fun AgentTabsButton(activity: HomeActivity) {
    val privateMode by activity.components.appStore.observeAsComposableState { it.mode.isPrivate }
    val counts by activity.components.core.store.observeAsComposableState { state ->
        state.tabs.count { !it.content.private } to state.tabs.count { it.content.private }
    }
    IconButton(onClick = activity::openBashKittenTabs, modifier = Modifier.size(48.dp)) {
        TabCounter(tabCount = if (privateMode) counts.second else counts.first, showPrivacyBadge = privateMode)
    }
}
