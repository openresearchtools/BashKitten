// SPDX-License-Identifier: AGPL-3.0-only
package org.mozilla.fenix.bashkitten

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import mozilla.components.browser.state.selector.selectedTab
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.lib.state.ext.observeAsComposableState
import org.mozilla.fenix.theme.FirefoxTheme
import com.bashkitten.R as bashKittenR
import mozilla.components.ui.icons.R as iconsR

/** A native notice, separate from the Tor website and its page permissions. */
@Composable
fun TorPrivacyNotice(modifier: Modifier = Modifier, onDismiss: (() -> Unit)? = null) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainer,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row {
            Text(
                text = stringResource(bashKittenR.string.bashkitten_tor_privacy_notice),
                modifier = Modifier.weight(1f).padding(12.dp),
                style = FirefoxTheme.typography.caption,
            )
            if (onDismiss != null) {
                IconButton(onClick = onDismiss) {
                    Icon(
                        painter = painterResource(iconsR.drawable.mozac_ic_cross_24),
                        contentDescription = stringResource(
                            mozilla.components.compose.base.R.string.mozac_compose_base_close_button_content_description,
                        ),
                    )
                }
            }
        }
    }
}

@Composable
fun TorTabPrivacyNotice(store: BrowserStore) {
    val tabId by store.observeAsComposableState { state ->
        state.selectedTab?.takeIf { it.contextId?.startsWith("bashkitten-tor-") == true }?.id
    }
    var dismissed by rememberSaveable { mutableStateOf(emptyList<String>()) }
    val id = tabId ?: return
    if (id !in dismissed) {
        TorPrivacyNotice(Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) {
            dismissed = dismissed + id
        }
    }
}
