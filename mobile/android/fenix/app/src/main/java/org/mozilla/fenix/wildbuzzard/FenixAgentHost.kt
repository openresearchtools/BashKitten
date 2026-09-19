// SPDX-License-Identifier: AGPL-3.0-or-later
package org.mozilla.fenix.wildbuzzard

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import java.lang.ref.WeakReference
import java.util.function.Consumer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import mozilla.components.browser.engine.gecko.GeckoEngineSession
import mozilla.components.browser.state.action.EngineAction
import mozilla.components.browser.state.selector.selectedTab
import mozilla.components.browser.state.state.TabSessionState
import org.mozilla.fenix.FenixApplication
import org.mozilla.fenix.HomeActivity
import org.mozilla.geckoview.GeckoView
import org.openresearchtools.wildbuzzard.BrowserApp

class FenixAgentHost(private val application: FenixApplication) : BrowserApp.Host {
    private val components get() = application.components
    private var activity = WeakReference<Activity>(null)

    init {
        application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(value: Activity) { if (value is HomeActivity) activity = WeakReference(value) }
            override fun onActivityDestroyed(value: Activity) { if (activity.get() === value) activity.clear() }
            override fun onActivityCreated(value: Activity, state: Bundle?) = Unit
            override fun onActivityStarted(value: Activity) = Unit
            override fun onActivityPaused(value: Activity) = Unit
            override fun onActivityStopped(value: Activity) = Unit
            override fun onActivitySaveInstanceState(value: Activity, state: Bundle) = Unit
        })
    }

    private fun nativeTab(state: TabSessionState): BrowserApp.Tab? {
        val engine = state.engineState.engineSession as? GeckoEngineSession ?: return null
        return BrowserApp.Tab(state.id, BrowserApp.USER, engine.wildBuzzardSession()).also { refresh(it) }
    }

    override fun create(owner: String, contextId: String): BrowserApp.Tab {
        val engine = components.core.engine.createSession(private = false, contextId = contextId) as GeckoEngineSession
        val id = components.useCases.tabsUseCases.addTab(
            url = "about:blank", selectTab = false, startLoading = false,
            contextId = contextId, engineSession = engine,
        )
        return BrowserApp.Tab(id, owner, engine.wildBuzzardSession())
    }

    override fun selected(): BrowserApp.Tab? = components.core.store.state.selectedTab?.let(::nativeTab)?.let {
        BrowserApp.get(application).track(it)
    }

    override fun refresh(tab: BrowserApp.Tab): Boolean {
        val state = components.core.store.state.tabs.find { it.id == tab.id } ?: return false
        val current = state.engineState.engineSession as? GeckoEngineSession
        if (current != null && tab.session !== current.wildBuzzardSession()) {
            tab.session = current.wildBuzzardSession()
            tab.ready = false
            tab.preparing = false
        }
        tab.url = state.content.url
        tab.title = state.content.title
        tab.loading = state.content.loading
        tab.desktop = state.content.desktopMode
        return true
    }

    override fun close(id: String) { components.useCases.tabsUseCases.removeTab(id) }
    override fun isolate(tab: BrowserApp.Tab, contextId: String, done: Runnable, fail: Consumer<String>) {
        val store = components.core.store
        val state = store.state.tabs.find { it.id == tab.id }
        if (state == null) { fail.accept("Tab was closed"); return }
        val old = state.engineState.engineSession
        val engine = components.core.engine.createSession(state.content.private, contextId) as GeckoEngineSession
        engine.toggleDesktopMode(state.content.desktopMode, reload = false)
        store.dispatch(EngineAction.UnlinkEngineSessionAction(tab.id))
        val linked = store.dispatch(EngineAction.LinkEngineSessionAction(
            tab.id, engine, skipLoading = true, contextId = contextId,
        ))
        CoroutineScope(Dispatchers.Main).launch {
            linked.join()
            old?.close()
            tab.session = engine.wildBuzzardSession()
            tab.ready = false
            done.run()
        }
    }
    override fun show(id: String) {
        components.useCases.tabsUseCases.selectTab(id)
        application.startActivity(launchIntent())
    }
    override fun desktop(id: String, enabled: Boolean) {
        components.useCases.sessionUseCases.requestDesktopSite(enabled, id)
    }
    override fun launchIntent() = Intent(application, HomeActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(HomeActivity.OPEN_TO_BROWSER, true)

    override fun screenshot(id: String, result: Consumer<Bitmap>) {
        val tab = components.core.store.state.tabs.find { it.id == id }
        val engine = tab?.engineState?.engineSession as? GeckoEngineSession
        fun find(view: View): GeckoView? {
            if (view is GeckoView && view.session === engine?.wildBuzzardSession()) return view
            if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
            return null
        }
        val view = activity.get()?.window?.decorView?.let(::find)
        if (view == null) { result.accept(null); return }
        view.capturePixels().accept({ result.accept(it) }, { result.accept(null) })
    }
}
