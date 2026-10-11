// SPDX-License-Identifier: AGPL-3.0-only
package org.mozilla.fenix.bashkitten

import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.coordinatorlayout.widget.CoordinatorLayout
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.bashkitten.BrowserApp
import com.bashkitten.display.DisplayTabs
import com.bashkitten.display.DisplayViewport
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import mozilla.components.browser.state.action.ContentAction
import mozilla.components.browser.state.selector.selectedTab
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.feature.tabs.TabsUseCases
import mozilla.components.feature.session.SessionUseCases
import mozilla.components.lib.state.ext.flow

/** Small Fenix adapter: tab selection, content bounds and lifetime only. */
class FenixDisplayViewport(
    private val owner: LifecycleOwner,
    private val parent: CoordinatorLayout,
    private val web: View,
    private val store: BrowserStore,
    private val tabs: TabsUseCases,
    private val sessions: SessionUseCases,
) : DefaultLifecycleObserver {
    private var viewport: DisplayViewport? = null
    private var selectedId: String? = null
    private var started = false
    private var topToolbar = 0
    private var bottomToolbar = 0
    private var oldWebVisibility = View.VISIBLE
    private val layout = ViewTreeObserver.OnGlobalLayoutListener { bounds() }
    private val collection = owner.lifecycleScope.launch {
        store.flow().map { it.selectedTab?.let { tab -> Triple(tab.id, tab.contextId, tab.content.url) } }
            .distinctUntilChanged().collect { selected ->
                if (selected?.second == DisplayTabs.CONTEXT) {
                    if (selected.third != "about:blank") {
                        // The address bar still browses normally. Move that navigation to an
                        // ordinary tab; no website inherits a native Display capability.
                        tabs.addTab(url = selected.third)
                        sessions.loadUrl("about:blank", sessionId = selected.first)
                        return@collect
                    }
                    if (selectedId != selected.first) {
                        removeViewport()
                        selectedId = selected.first
                        val app = BrowserApp.get(parent.context)
                        viewport = DisplayViewport(parent.context, app.display::request) { tabs.removeTab(selected.first) }
                        oldWebVisibility = web.visibility
                        web.visibility = View.INVISIBLE
                        // Browser chrome remains above this native slot.
                        parent.addView(viewport, 1, CoordinatorLayout.LayoutParams(1, 1))
                        bounds()
                    }
                    viewport?.selected(started)
                    if (store.state.selectedTab?.content?.title != "Display · Local") {
                        store.dispatch(ContentAction.UpdateTitleAction(selected.first, "Display · Local"))
                    }
                } else removeViewport()
            }
    }
    init {
        owner.lifecycle.addObserver(this)
        parent.viewTreeObserver.addOnGlobalLayoutListener(layout)
    }
    fun toolbarInsets(top: Int, bottom: Int) {
        topToolbar = top; bottomToolbar = bottom; bounds()
    }
    private fun bounds() {
        val display = viewport ?: return
        if (parent.width <= 0 || parent.height <= 0) return
        val location = IntArray(2)
        parent.getLocationOnScreen(location)
        val visible = Rect()
        parent.getWindowVisibleDisplayFrame(visible)
        // Fenix owns system insets; this additionally clips an overlaid IME when
        // the platform leaves the browser layout at its unresized height.
        val left = maxOf(0, visible.left - location[0])
        val right = minOf(parent.width, visible.right - location[0])
        val top = maxOf(topToolbar, visible.top - location[1])
        val bottom = minOf(parent.height - bottomToolbar, visible.bottom - location[1])
        val width = (right - left).coerceAtLeast(1)
        val height = (bottom - top).coerceAtLeast(1)
        val params = display.layoutParams as CoordinatorLayout.LayoutParams
        if (params.width != width || params.height != height || params.topMargin != top || params.leftMargin != left) {
            params.width = width; params.height = height; params.topMargin = top; params.leftMargin = left
            display.layoutParams = params
        }
    }
    override fun onStart(owner: LifecycleOwner) { started = true; viewport?.selected(true) }
    override fun onStop(owner: LifecycleOwner) { started = false; viewport?.selected(false) }
    override fun onDestroy(owner: LifecycleOwner) { destroy() }
    private fun removeViewport() {
        viewport?.let {
            it.selected(false)
            web.visibility = oldWebVisibility
            (it.parent as? ViewGroup)?.removeView(it)
        }
        viewport = null; selectedId = null
    }
    fun destroy() {
        collection.cancel()
        owner.lifecycle.removeObserver(this)
        if (parent.viewTreeObserver.isAlive) parent.viewTreeObserver.removeOnGlobalLayoutListener(layout)
        removeViewport()
    }
}
