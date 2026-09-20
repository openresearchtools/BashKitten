// SPDX-License-Identifier: AGPL-3.0-or-later
package org.mozilla.fenix.wildbuzzard

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import org.mozilla.geckoview.GeckoView

/** Capture the displayed page surface, including on devices with broken compositor readback. */
internal fun captureDisplayedPage(
    view: View,
    fallback: ((Bitmap?) -> Unit) -> Unit,
    result: (Bitmap?) -> Unit,
) {
    fun findGecko(node: View): GeckoView? {
        if (node is GeckoView) return node
        if (node is ViewGroup) {
            for (index in 0 until node.childCount) {
                findGecko(node.getChildAt(index))?.let { return it }
            }
        }
        return null
    }
    fun findSurface(node: View): SurfaceView? {
        if (node is SurfaceView) return node
        if (node is ViewGroup) {
            for (index in 0 until node.childCount) {
                findSurface(node.getChildAt(index))?.let { return it }
            }
        }
        return null
    }
    val gecko = findGecko(view)
    val session = gecko?.session
    val handler = Handler(Looper.getMainLooper())
    val deadline = SystemClock.uptimeMillis() + 2000
    fun capture() {
        if (!view.hasWindowFocus() || gecko?.session !== session) { result(null); return }
        if (gecko != null && !gecko.hasPaintedSurface()) {
            if (SystemClock.uptimeMillis() < deadline) handler.postDelayed({ capture() }, 25) else result(null)
            return
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
                if (!view.hasWindowFocus() || gecko?.session !== session) {
                    bitmap.recycle()
                    result(null)
                } else if (status == PixelCopy.SUCCESS) {
                    result(bitmap)
                } else {
                    bitmap.recycle()
                    fallback(result)
                }
            }, handler)
        } catch (_: IllegalArgumentException) {
            bitmap.recycle()
            result(null)
        }
    }
    capture()
}
