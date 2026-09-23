// SPDX-License-Identifier: AGPL-3.0-or-later
package org.mozilla.fenix.bashkitten

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
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
import mozilla.components.browser.state.action.ContentAction
import mozilla.components.browser.state.action.DownloadAction
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import mozilla.components.browser.engine.gecko.GeckoEngineSession
import mozilla.components.browser.state.action.EngineAction
import mozilla.components.browser.state.selector.selectedTab
import mozilla.components.browser.state.state.TabSessionState
import mozilla.components.lib.state.ext.flow
import mozilla.components.feature.tabs.WindowFeature
import org.mozilla.fenix.FenixApplication
import org.mozilla.fenix.HomeActivity
import org.mozilla.geckoview.GeckoView
import com.bashkitten.BrowserApp

class FenixAgentHost(private val application: FenixApplication) : BrowserApp.Host {
    private val components get() = application.components
    override fun runtime() = components.core.geckoRuntime
    private var activity = WeakReference<Activity>(null)
    private val windows = WindowFeature(components.core.store, components.useCases.tabsUseCases)

    init {
        windows.start()
        CoroutineScope(Dispatchers.Main).launch {
            components.core.store.flow().map { state ->
                state.downloads.values.map { it.id to it.sessionId } +
                    state.tabs.mapNotNull { tab -> tab.content.download?.let { it.id to tab.id } }
            }.distinctUntilChanged().collect { downloads ->
                val app = BrowserApp.get(application)
                downloads.forEach { (id, tabId) -> app.rememberDownload(id, tabId) }
            }
        }
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

    private fun nativeTab(state: TabSessionState): BrowserApp.Tab {
        val engine = state.engineState.engineSession as? GeckoEngineSession
        return BrowserApp.Tab(state.id, BrowserApp.USER, engine?.bashKittenSession()).also {
            it.parentId = state.parentId
            refresh(it)
        }
    }

    override fun create(owner: String, contextId: String): BrowserApp.Tab {
        val privateTab = contextId.startsWith("bashkitten-tor-hosted-")
        val engine = components.core.engine.createSession(private = privateTab, contextId = contextId) as GeckoEngineSession
        val id = components.useCases.tabsUseCases.addTab(
            url = "about:blank", selectTab = false, startLoading = false,
            contextId = contextId, engineSession = engine, private = privateTab,
        )
        return BrowserApp.Tab(id, owner, engine.bashKittenSession())
    }

    override fun selected(): BrowserApp.Tab? = components.core.store.state.selectedTab?.let(::nativeTab)?.let {
        BrowserApp.get(application).track(it, it.parentId)
    }

    override fun list(): List<BrowserApp.Tab> = components.core.store.state.tabs.map(::nativeTab)

    override fun refresh(tab: BrowserApp.Tab): Boolean {
        val state = components.core.store.state.tabs.find { it.id == tab.id } ?: return false
        val current = state.engineState.engineSession as? GeckoEngineSession
        if (tab.session !== current?.bashKittenSession()) {
            tab.session = current?.bashKittenSession()
            tab.ready = false
            tab.preparing = false
        }
        tab.url = state.content.url
        tab.title = state.content.title
        tab.loading = state.content.loading
        tab.desktop = state.content.desktopMode
        return true
    }

    override fun ensure(tab: BrowserApp.Tab, done: Runnable, fail: Consumer<String>) {
        val store = components.core.store
        if (store.state.tabs.none { it.id == tab.id }) { fail.accept("Tab was closed"); return }
        store.dispatch(EngineAction.CreateEngineSessionAction(tab.id))
        CoroutineScope(Dispatchers.Main).launch {
            try {
                withTimeout(15000) {
                    store.flow().first { state ->
                        state.tabs.find { it.id == tab.id }?.engineState?.engineSession != null
                    }
                }
                if (!refresh(tab)) { fail.accept("Tab was closed"); return@launch }
                if (tab.session?.isOpen != true) { fail.accept("Tab session is unavailable"); return@launch }
                done.run()
            } catch (error: Exception) { fail.accept("Could not restore tab session") }
        }
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
        store.dispatch(EngineAction.LinkEngineSessionAction(
            tab.id, engine, skipLoading = true, contextId = contextId,
        ))
        old?.close()
        tab.session = engine.bashKittenSession()
        tab.ready = false
        done.run()
    }
    override fun show(id: String) {
        components.useCases.tabsUseCases.selectTab(id)
        val privateTab = components.core.store.state.tabs.find { it.id == id }?.content?.private == true
        application.startActivity(launchIntent().putExtra(HomeActivity.PRIVATE_BROWSING_MODE, privateTab))
    }
    override fun desktop(id: String, enabled: Boolean) {
        components.useCases.sessionUseCases.requestDesktopSite(enabled, id)
    }
    override fun bookmark(url: String, title: String, done: Consumer<String>, fail: Consumer<String>) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val storage = components.core.bookmarksStorage
                if (storage.getBookmarksWithUrl(url).getOrThrow().isNotEmpty()) {
                    done.accept("Already in bookmarks")
                } else {
                    storage.addItem(mozilla.appservices.places.BookmarkRoot.Mobile.id, url, title, null).getOrThrow()
                    done.accept("Saved to bookmarks")
                }
            } catch (error: Exception) { fail.accept("Could not save bookmark") }
        }
    }
    override fun quickAccess(url: String, title: String, done: Consumer<String>, fail: Consumer<String>) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val storage = components.core.topSitesStorage
                val existing = storage.getTopSites(Int.MAX_VALUE, null, null).find { it.url == url }
                if (existing == null) storage.addTopSite(title, url, isDefault = false)
                else storage.updateTopSite(existing, title, url)
                done.accept(if (existing == null) "Saved to quick access" else "Already in quick access")
            } catch (error: Exception) { fail.accept("Could not save quick access") }
        }
    }
    override fun launchIntent() = Intent(application, HomeActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        .putExtra(HomeActivity.OPEN_TO_BROWSER, true)

    override fun downloads(): List<BrowserApp.Download> {
        val state = components.core.store.state
        val downloads = (state.downloads.values + state.tabs.mapNotNull { it.content.download }).distinctBy { it.id }
        val app = BrowserApp.get(application)
        return downloads.map { value ->
            BrowserApp.Download(
                value.id, value.sessionId ?: app.downloadTab(value.id), value.fileName ?: "download", value.contentType ?: "application/octet-stream",
                value.status.name, value.filePath, value.contentLength ?: value.currentBytesCopied,
            )
        }
    }

    override fun acceptDownload(tabId: String, downloadId: String) {
        val store = components.core.store
        val download = store.state.tabs.find { it.id == tabId }?.content?.download
            ?: throw IllegalStateException("No pending download in this tab")
        require(download.id == downloadId) { "Download does not belong to this tab" }
        BrowserApp.get(application).rememberDownload(download.id, tabId)
        store.dispatch(ContentAction.ConsumeDownloadAction(tabId, download.id))
        store.dispatch(DownloadAction.AddDownloadAction(download.copy(sessionId = tabId, skipConfirmation = true, openInApp = false)))
    }

    override fun screenshot(id: String, result: Consumer<Bitmap?>) {
        val tab = components.core.store.state.tabs.find { it.id == id }
        val engine = tab?.engineState?.engineSession as? GeckoEngineSession
        if (engine == null || components.core.store.state.selectedTabId != id) {
            result.accept(null)
            return
        }
        val session = engine.bashKittenSession()
        fun find(view: View): GeckoView? {
            if (view is GeckoView && view.session === session) return view
            if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
            return null
        }
        val view = activity.get()?.window?.decorView?.let(::find)
        if (view == null || !view.isShown) { result.accept(null); return }
        captureDisplayedPage(view, { callback ->
            view.capturePixels().accept({ callback(it) }, { callback(null) })
        }, { bitmap ->
            val current = components.core.store.state
            if (current.selectedTabId != id || view.session !== session ||
                current.tabs.find { it.id == id }?.engineState?.engineSession !== engine
            ) {
                bitmap?.recycle()
                result.accept(null)
            } else {
                result.accept(bitmap)
            }
        })
    }
}
