// SPDX-License-Identifier: AGPL-3.0-or-later
package org.mozilla.fenix.tabstray.ui.tabpage

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.mozilla.fenix.tabstray.controller.TabInteractionHandler
import org.mozilla.fenix.tabstray.data.TabsTrayItem
import org.mozilla.fenix.tabstray.redux.state.TabsTrayState
import org.mozilla.fenix.theme.FirefoxTheme
import org.openresearchtools.wildbuzzard.BrowserApp
import org.openresearchtools.wildbuzzard.OnionActivity

/** Tor is a route, not a replacement for private browsing or its lock. */
@Composable
internal fun TorTabsPage(
    state: TabsTrayState,
    onTabClose: (TabsTrayItem.Tab) -> Unit,
    onItemClick: (TabsTrayItem) -> Unit,
    onItemLongClick: (TabsTrayItem) -> Unit,
    tabInteractionHandler: TabInteractionHandler,
) {
    val context = LocalContext.current
    val browser = remember(context) { BrowserApp.get(context) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var sites by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var showNewTab by remember { mutableStateOf(false) }
    var address by remember { mutableStateOf("") }
    val open: (String) -> Unit = { url ->
        Toast.makeText(context, "Connecting through Tor…", Toast.LENGTH_SHORT).show()
        browser.openTorTab(url) { Toast.makeText(context, it, Toast.LENGTH_LONG).show() }
    }
    val addPrivateSite: () -> Unit = {
        context.startActivity(Intent(context, OnionActivity::class.java))
    }

    DisposableEffect(browser, lifecycle) {
        var active = true
        fun refresh() = browser.savedTorSites { if (active) sites = it.toMap() }
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refresh()
        }
        lifecycle.addObserver(observer)
        refresh()
        onDispose { active = false; lifecycle.removeObserver(observer) }
    }

    Column(Modifier.fillMaxSize().testTag("tor_tabs_page")) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { showNewTab = true }, modifier = Modifier.weight(1f)) {
                    Text("New Tor tab")
                }
                OutlinedButton(onClick = addPrivateSite, modifier = Modifier.weight(1f)) {
                    Text("Private Tor sites")
                }
            }
            Text(
                "Onion addresses connect through Tor automatically. Private tabs stay in Private.",
                modifier = Modifier.padding(top = 8.dp),
                style = FirefoxTheme.typography.caption,
            )
            if (sites.isNotEmpty()) {
                Text("Quick access", modifier = Modifier.padding(top = 12.dp), style = FirefoxTheme.typography.subtitle2)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(sites.entries.toList(), key = { it.key }) { site ->
                        OutlinedButton(onClick = { open("https://${site.key}/") }) {
                            Text(site.value, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
        if (state.torTabsState.items.isEmpty()) {
            Text("No Tor tabs open", Modifier.padding(24.dp), style = FirefoxTheme.typography.body1)
        } else {
            TabLayout(
                tabs = state.torTabsState.items,
                displayTabsInGrid = state.config.displayTabsInGrid,
                tabInteractionHandler = tabInteractionHandler,
                selectedItemIndex = state.torTabsState.selectedItemIndex,
                selectionMode = state.mode,
                modifier = Modifier.weight(1f).testTag("tor_tabs_list"),
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
    if (showNewTab) {
        AlertDialog(
            onDismissRequest = { showNewTab = false },
            title = { Text("New Tor tab") },
            text = {
                Column {
                    OutlinedTextField(
                        value = address,
                        onValueChange = { address = it },
                        label = { Text("Website or .onion address") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    TextButton(onClick = { showNewTab = false; addPrivateSite() }) {
                        Text("Connect a private .onion share")
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showNewTab = false; open(address); address = "" }) { Text("Open") }
            },
            dismissButton = { TextButton(onClick = { showNewTab = false }) { Text("Cancel") } },
        )
    }
}
