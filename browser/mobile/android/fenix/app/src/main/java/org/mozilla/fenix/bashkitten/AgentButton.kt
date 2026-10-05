// SPDX-License-Identifier: AGPL-3.0-only
package org.mozilla.fenix.bashkitten

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.mozilla.fenix.R

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
