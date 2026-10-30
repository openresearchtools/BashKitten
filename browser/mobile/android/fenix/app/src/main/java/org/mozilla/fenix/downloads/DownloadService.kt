/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.downloads

import com.bashkitten.BrowserApp
import mozilla.components.browser.state.state.content.DownloadState
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.concept.fetch.Request
import mozilla.components.concept.fetch.Response
import mozilla.components.feature.downloads.AbstractFetchDownloadService
import mozilla.components.feature.downloads.DefaultPackageNameProvider
import mozilla.components.feature.downloads.DownloadEstimator
import mozilla.components.feature.downloads.FileSizeFormatter
import mozilla.components.feature.downloads.PackageNameProvider
import mozilla.components.feature.downloads.filewriter.DefaultDownloadFileWriter
import mozilla.components.feature.downloads.filewriter.DownloadFileWriter
import mozilla.components.support.base.android.NotificationsDelegate
import mozilla.components.support.utils.DefaultDownloadFileUtils
import mozilla.components.support.utils.DownloadFileUtils
import org.mozilla.fenix.R
import org.mozilla.fenix.bashkitten.AuthorizedDownloadStream
import org.mozilla.fenix.ext.components
import org.mozilla.fenix.settings.downloads.DownloadLocationManager

class DownloadService : AbstractFetchDownloadService() {
    override val httpClient by lazy { components.core.client }
    override fun fetchDownload(download: DownloadState, request: Request): Response {
        val context = request.contextId
        if (context?.startsWith("bashkitten-agent-ui-") != true) return super.fetchDownload(download, request)
        val host = BrowserApp.get(applicationContext).host
        if (!host.downloadAuthorized(download.id, context)) throw SecurityException("The Agent download connection changed")
        val response = super.fetchDownload(download, request)
        val protected = response.copy(
            body = Response.Body(
                AuthorizedDownloadStream(response.body.byteStream()) { host.downloadAuthorized(download.id, context) },
                response.headers["Content-Type"],
            ),
        )
        host.retainDownloadResponse(download.id, protected)
        return protected
    }
    override fun onDownloadStateChanged(download: DownloadState): DownloadState {
        if (download.contextId?.startsWith("bashkitten-agent-ui-") != true) return download
        BrowserApp.get(applicationContext).host.downloadStatusChanged(download.id, download.status.name)
        return if (download.status == DownloadState.Status.PAUSED) download.copy(response = null) else download
    }
    override val store: BrowserStore by lazy { components.core.store }
    override val style: Style by lazy { Style(R.color.fx_mobile_tertiary) }
    override val notificationsDelegate: NotificationsDelegate by lazy { components.notificationsDelegate }
    override val fileSizeFormatter: FileSizeFormatter by lazy { components.core.fileSizeFormatter }
    override val downloadEstimator: DownloadEstimator by lazy { components.core.downloadEstimator }
    override val packageNameProvider: PackageNameProvider by lazy {
        DefaultPackageNameProvider(applicationContext)
    }
    override val downloadFileUtils: DownloadFileUtils by lazy {
        DefaultDownloadFileUtils(
            context = applicationContext,
            downloadLocation = {
                DownloadLocationManager(
                    applicationContext.components.settings,
                    applicationContext.contentResolver,
                ).defaultLocation
            },
        )
    }
    override val downloadFileWriter: DownloadFileWriter by lazy {
        DefaultDownloadFileWriter(
            context = applicationContext,
            downloadFileUtils = downloadFileUtils,
        )
    }
}
