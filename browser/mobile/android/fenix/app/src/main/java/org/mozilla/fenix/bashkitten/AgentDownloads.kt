// SPDX-License-Identifier: AGPL-3.0-or-later
package org.mozilla.fenix.bashkitten

import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentManager
import com.bashkitten.BrowserApp
import java.io.Closeable
import java.io.FilterInputStream
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.function.BooleanSupplier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import mozilla.components.browser.state.state.content.DownloadState
import mozilla.components.concept.fetch.Header
import mozilla.components.concept.fetch.MutableHeaders
import mozilla.components.concept.fetch.Response
import mozilla.components.feature.downloads.AbstractFetchDownloadService
import mozilla.components.feature.downloads.DownloadsFeature
import mozilla.components.feature.downloads.SimpleDownloadDialogFragment
import mozilla.components.feature.downloads.manager.FetchDownloadManager
import mozilla.components.lib.state.ext.flow
import mozilla.components.support.utils.DefaultDownloadFileUtils
import org.mozilla.fenix.FenixApplication
import org.mozilla.fenix.HomeActivity
import org.mozilla.fenix.components.appstate.AppAction
import org.mozilla.fenix.downloads.DownloadService
import org.mozilla.fenix.downloads.listscreen.middleware.DefaultBroadcastSender
import org.mozilla.fenix.settings.downloads.DownloadLocationManager
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.WebResponse

/** Hands protected Gecko responses to Fenix's native dialog and download owner. */
internal class AgentDownloads(
    private val application: FenixApplication,
    private val activity: () -> HomeActivity?,
) {
    private val components get() = application.components
    private val scope = CoroutineScope(Dispatchers.Main)
    private val pending = ConcurrentHashMap<String, Pending>()
    private val fileUtils = DefaultDownloadFileUtils(application) {
        DownloadLocationManager(components.settings, application.contentResolver).defaultLocation
    }
    private val manager = FetchDownloadManager(
        application, components.core.store, DownloadService::class,
        notificationsDelegate = components.notificationsDelegate,
    )

    private class Pending(val access: BooleanSupplier, val body: InputStream?, val context: String?) {
        @Volatile var valid = true
        @Volatile var paused = false
        var started = false
        var seen = false
        var dialog: SimpleDownloadDialogFragment? = null
        val responses: MutableSet<Closeable> = ConcurrentHashMap.newKeySet<Closeable>().apply { if (body != null) add(body) }
    }

    init {
        BrowserApp.get(application).agent.observe {
            pending.toMap().forEach { (id, owner) ->
                if (!owner.access.asBoolean) {
                    owner.valid = false
                    if (owner.started) DefaultBroadcastSender(application).sendBroadcast(id, AbstractFetchDownloadService.ACTION_CANCEL)
                    owner.dialog?.dismissAllowingStateLoss()
                    release(id)
                }
            }
        }
        scope.launch {
            components.core.store.flow().collect { state ->
                pending.toMap().forEach { (id, owner) ->
                    val download = state.downloads[id]
                    if (download != null) owner.seen = true
                    if (owner.seen && (download == null || download.status in listOf(DownloadState.Status.COMPLETED, DownloadState.Status.CANCELLED))) release(id)
                }
            }
        }
    }

    private fun release(id: String) {
        val owner = pending.remove(id) ?: return
        owner.valid = false
        closeResponses(owner)
    }

    private fun closeResponses(owner: Pending) {
        val responses = owner.responses.toList()
        owner.responses.removeAll(responses.toSet())
        scope.launch(Dispatchers.IO) { responses.forEach { runCatching { it.close() } } }
    }

    fun statusChanged(id: String, status: String) {
        val owner = pending[id] ?: return
        when (status) {
            "PAUSED" -> { owner.paused = true; closeResponses(owner) }
            "DOWNLOADING" -> owner.paused = false
            "COMPLETED", "CANCELLED" -> release(id)
        }
    }

    fun authorized(id: String, context: String) = pending[id]?.let { it.valid && !it.paused && it.context == context } == true

    fun retain(id: String, response: Closeable) {
        val owner = pending[id]
        owner?.responses?.add(response)
        if (owner == null || !owner.valid || pending[id] !== owner) {
            owner?.responses?.remove(response)
            runCatching { response.close() }
            throw SecurityException("The Agent download connection changed")
        }
        if (owner.paused) {
            owner.responses.remove(response)
            runCatching { response.close() }
            throw CancellationException("The Agent download was paused")
        }
    }

    fun download(source: GeckoSession, web: WebResponse, access: BooleanSupplier) {
        // Preserve Gecko's existing authenticated response and context. No second
        // request, copied cookies, external downloader or alternate route.
        web.setReadTimeoutMillis(0)
        val owner = Pending(access, web.body, source.settings.contextId)
        val sourceHeaders = MutableHeaders(web.headers.map { Header(it.key, it.value) })
        val decoded = sourceHeaders["Content-Encoding"]?.equals("identity", ignoreCase = true) == false
        val headers = MutableHeaders(sourceHeaders.filterNot { decoded && it.name.equals("Content-Length", ignoreCase = true) })
        val response = Response(
            web.uri, if (web.uri.startsWith("blob:") || web.uri.startsWith("data:")) 200 else web.statusCode,
            headers, owner.body?.let { Response.Body(AuthorizedDownloadStream(it) { owner.valid }, headers["Content-Type"]) } ?: Response.Body.empty(),
        )
        val download = DownloadState(
            url = web.uri,
            fileName = fileUtils.guessFileName(headers["Content-Disposition"], web.uri, headers["Content-Type"]),
            contentType = headers["Content-Type"],
            contentLength = headers["Content-Length"]?.toLongOrNull(),
            directoryPath = fileUtils.currentDownloadLocation,
            contextId = source.settings.contextId,
            private = source.settings.usePrivateMode,
            response = response,
            openInApp = false,
        )
        pending[download.id] = owner
        val host = activity()
        if (!access.asBoolean || host == null || host.supportFragmentManager.isStateSaved) { release(download.id); return }

        val dialog = SimpleDownloadDialogFragment.newInstance(
            promptsStyling = DownloadsFeature.PromptsStyling(gravity = android.view.Gravity.BOTTOM, shouldWidthMatchParent = true),
        )
        owner.dialog = dialog
        dialog.setDownload(download, requireNotNull(download.fileName))
        dialog.onCancelDownload = { release(download.id) }
        dialog.onStartDownload = {
            if (owner.valid && owner.access.asBoolean) {
                owner.started = true
                manager.download(download)
                components.appStore.dispatch(AppAction.DownloadAction.DownloadInProgress(download.id))
            } else release(download.id)
        }
        val fragments = host.supportFragmentManager
        fragments.registerFragmentLifecycleCallbacks(object : FragmentManager.FragmentLifecycleCallbacks() {
            override fun onFragmentDestroyed(manager: FragmentManager, fragment: Fragment) {
                if (fragment !== dialog) return
                manager.unregisterFragmentLifecycleCallbacks(this)
                owner.dialog = null
                if (!owner.started) release(download.id)
            }
        }, false)
        dialog.show(fragments, "bashkitten-download-${download.id}")
    }

}

/** A revoked response cannot trigger the native service's closed-stream retry. */
internal class AuthorizedDownloadStream(input: InputStream, private val access: () -> Boolean) : FilterInputStream(input) {
    private fun current() { if (!access()) throw SecurityException("The Agent connection changed") }
    override fun read(): Int { current(); return guarded { `in`.read() } }
    override fun read(bytes: ByteArray, offset: Int, length: Int): Int { current(); return guarded { `in`.read(bytes, offset, length) } }
    private inline fun guarded(read: () -> Int): Int {
        try { return read().also { current() } }
        catch (error: java.io.IOException) { current(); throw error }
    }
}
