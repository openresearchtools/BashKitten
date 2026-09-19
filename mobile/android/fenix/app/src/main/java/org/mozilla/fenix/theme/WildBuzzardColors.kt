// SPDX-License-Identifier: AGPL-3.0-or-later
package org.mozilla.fenix.theme

import androidx.compose.ui.graphics.Color
import mozilla.components.compose.base.theme.*

// Exact default light/dark palette from WildBuzzardThemeColors.sys.mjs.
internal fun wildBuzzardScheme(theme: Theme) = if (theme == Theme.Light) {
    acornLightColorScheme().copy(
        primary = Color(0xFF4A4A4A),
        onPrimary = Color(0xFFFFFFFF),
        primaryContainer = Color(0xFFE6E6E6),
        onPrimaryContainer = Color(0xFF252525),
        inversePrimary = Color(0xFFC8C8C8),
        secondary = Color(0xFF4A4A4A),
        onSecondary = Color(0xFFFFFFFF),
        secondaryContainer = Color(0xFFE6E6E6),
        onSecondaryContainer = Color(0xFF252525),
        tertiary = Color(0xFF4A4A4A),
        onTertiary = Color(0xFFFFFFFF),
        tertiaryContainer = Color(0xFFE6E6E6),
        onTertiaryContainer = Color(0xFF252525),
        background = Color(0xFFF5F5F5),
        onBackground = Color(0xFF252525),
        surface = Color(0xFFF5F5F5),
        onSurface = Color(0xFF252525),
        surfaceVariant = Color(0xFFE6E6E6),
        onSurfaceVariant = Color(0xFF4A4A4A),
        surfaceTint = Color(0xFFF5F5F5),
        inverseSurface = Color(0xFF303030),
        inverseOnSurface = Color(0xFFE5E5E5),
        outline = Color(0xFF808080),
        outlineVariant = Color(0xFFC8C8C8),
        surfaceBright = Color(0xFFFFFFFF),
        surfaceDim = Color(0xFFE6E6E6),
        surfaceContainer = Color(0xFFF5F5F5),
        surfaceContainerHigh = Color(0xFFE6E6E6),
        surfaceContainerHighest = Color(0xFFC8C8C8),
        surfaceContainerLow = Color(0xFFFFFFFF),
        surfaceContainerLowest = Color(0xFFFFFFFF),
    )
} else {
    acornDarkColorScheme().copy(
        primary = Color(0xFFC8C8C8),
        onPrimary = Color(0xFF252525),
        primaryContainer = Color(0xFF414141),
        onPrimaryContainer = Color(0xFFE5E5E5),
        inversePrimary = Color(0xFF4A4A4A),
        secondary = Color(0xFFC8C8C8),
        onSecondary = Color(0xFF252525),
        secondaryContainer = Color(0xFF414141),
        onSecondaryContainer = Color(0xFFE5E5E5),
        tertiary = Color(0xFFD8D8D8),
        onTertiary = Color(0xFF252525),
        tertiaryContainer = Color(0xFF303030),
        onTertiaryContainer = Color(0xFFE5E5E5),
        background = Color(0xFF1E1E1E),
        onBackground = Color(0xFFE5E5E5),
        surface = Color(0xFF303030),
        onSurface = Color(0xFFE5E5E5),
        surfaceVariant = Color(0xFF414141),
        onSurfaceVariant = Color(0xFFC8C8C8),
        surfaceTint = Color(0xFF303030),
        inverseSurface = Color(0xFFE6E6E6),
        inverseOnSurface = Color(0xFF252525),
        outline = Color(0xFF808080),
        outlineVariant = Color(0xFF414141),
        surfaceBright = Color(0xFF414141),
        surfaceDim = Color(0xFF1E1E1E),
        surfaceContainer = Color(0xFF303030),
        surfaceContainerHigh = Color(0xFF414141),
        surfaceContainerHighest = Color(0xFF4A4A4A),
        surfaceContainerLow = Color(0xFF252525),
        surfaceContainerLowest = Color(0xFF1E1E1E),
    )
}
internal fun wildBuzzardColors(theme: Theme) = if (theme == Theme.Light) {
    lightColorPalette.copy(layerGradientStart = Color(0xFFE6E6E6), layerGradientEnd = Color(0xFFC8C8C8),
        information = Color(0xFF4A4A4A), informationContainer = Color(0xFFE6E6E6),
        onInformationContainer = Color(0xFF252525), surfaceDimVariant = Color(0xFFE6E6E6),
        autofillText = Color(0xFF4A4A4A), selectedText = Color(0xFFC8C8C8), iconPrivate = Color(0xFF4A4A4A))
} else {
    darkColorPalette.copy(layerGradientStart = Color(0xFF252525), layerGradientEnd = Color(0xFF303030),
        information = Color(0xFFC8C8C8), informationContainer = Color(0xFF292929),
        onInformationContainer = Color(0xFFE5E5E5), surfaceDimVariant = Color(0xFF252525),
        autofillText = Color(0xFFC8C8C8), selectedText = Color(0xFF414141), iconPrivate = Color(0xFFC8C8C8))
}

internal fun wildBuzzardGradients(theme: Theme): AcornGradientScheme {
    val dark = theme != Theme.Light
    val gradient = AcornGradient(
        type = AcornGradientType.Linear(96f),
        colorStops = listOf(
            mozilla.components.compose.base.utils.ColorStop(0f, Color(if (dark) 0xFF252525 else 0xFFE6E6E6)),
            mozilla.components.compose.base.utils.ColorStop(1f, Color(if (dark) 0xFF414141 else 0xFFC8C8C8)),
        ),
    )
    return AcornGradientScheme(gradient, gradient, gradient, gradient)
}
