// SPDX-License-Identifier: AGPL-3.0-only
package org.mozilla.fenix.bashkitten

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import mozilla.components.browser.state.selector.selectedTab
import mozilla.components.browser.state.state.BrowserState
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.concept.engine.webextension.Action
import mozilla.components.lib.state.ext.observeAsComposableState
import mozilla.components.ui.icons.R as iconsR

private const val REFERENCES_ID = "references@bashkitten.org"

private fun BrowserState.referencesAction(): Action? {
    val tab = selectedTab ?: return null
    if (tab.contextId == com.bashkitten.display.DisplayTabs.CONTEXT) return null
    val extension = extensions[REFERENCES_ID] ?: return null
    if (!extension.enabled || (tab.content.private && !extension.allowedInPrivateBrowsing)) return null
    return extension.browserAction?.copyWithOverride(tab.extensionState[REFERENCES_ID]?.browserAction)
}

/** Fenix's native action state owns capture, popups, permissions and tab identity. */
@Composable
fun ReferencesButton(store: BrowserStore) {
    val action by store.observeAsComposableState { it.referencesAction() }
    val current = action ?: return
    val iconSize = with(LocalDensity.current) { 24.dp.roundToPx() }
    val icon by produceState<ImageBitmap?>(null, current.loadIcon, iconSize) {
        value = runCatching { current.loadIcon?.invoke(iconSize)?.asImageBitmap() }.getOrNull()
    }
    IconButton(
        modifier = Modifier.size(48.dp),
        enabled = current.enabled != false,
        onClick = {
            store.state.referencesAction()?.takeIf { it.enabled != false }?.onClick?.invoke()
        },
    ) {
        val image = icon
        if (image != null) {
            Image(image, contentDescription = "References Add", modifier = Modifier.size(24.dp))
        } else {
            Icon(painterResource(iconsR.drawable.mozac_ic_plus_24), contentDescription = "References Add")
        }
    }
}
