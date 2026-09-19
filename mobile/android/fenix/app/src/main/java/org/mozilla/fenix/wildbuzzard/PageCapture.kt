// SPDX-License-Identifier: AGPL-3.0-or-later
package org.mozilla.fenix.wildbuzzard

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup

/** Capture the displayed page surface, including on devices with broken compositor readback. */
internal fun captureDisplayedPage(
    view: View,
    fallback: ((Bitmap?) -> Unit) -> Unit,
    result: (Bitmap?) -> Unit,
) {
    fun findSurface(node: View): SurfaceView? {
        if (node is SurfaceView) return node
        if (node is ViewGroup) {
            for (index in 0 until node.childCount) {
                findSurface(node.getChildAt(index))?.let { return it }
            }
        }
        return null
    }
    val surface = findSurface(view)
    if (surface == null) { fallback(result); return }
    if (!surface.isShown || !surface.holder.surface.isValid || surface.width <= 0 || surface.height <= 0) {
        result(null)
        return
    }
    val bitmap = Bitmap.createBitmap(surface.width, surface.height, Bitmap.Config.ARGB_8888)
    try {
        PixelCopy.request(surface, bitmap, { status ->
            if (status == PixelCopy.SUCCESS) {
                result(bitmap)
            } else {
                bitmap.recycle()
                fallback(result)
            }
        }, Handler(Looper.getMainLooper()))
    } catch (_: IllegalArgumentException) {
        bitmap.recycle()
        result(null)
    }
}
