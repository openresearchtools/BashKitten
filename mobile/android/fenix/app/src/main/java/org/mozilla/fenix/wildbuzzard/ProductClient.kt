// SPDX-License-Identifier: AGPL-3.0-or-later
package org.mozilla.fenix.wildbuzzard

import java.io.IOException
import java.net.URI
import mozilla.components.concept.fetch.Client
import mozilla.components.concept.fetch.Request
import mozilla.components.concept.fetch.Response

/** Applies only to app services. User web pages continue through the browser engine. */
class ProductClient(private val delegate: Client) : Client() {
    override fun fetch(request: Request): Response {
        val host = URI(request.url).host?.lowercase().orEmpty()
        val disabled = listOf("mozilla.com", "mozilla.org", "mozilla.net", "mozilla.cloud", "mozilla.social", "firefox.com", "firefoxusercontent.com", "mozaws.net", "mozgcp.net", "firefox.settings.services.mozilla.com", "adjust.com", "sentry.io")
        if (disabled.any { host == it || host.endsWith(".$it") }) throw IOException("Mozilla product services are disabled in WildBuzzard")
        return delegate.fetch(request)
    }
}
