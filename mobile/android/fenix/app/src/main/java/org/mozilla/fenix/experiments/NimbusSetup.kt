/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.experiments

import android.content.Context
import mozilla.appservices.remotesettings.RemoteSettingsService
import mozilla.components.service.nimbus.NimbusApi
import mozilla.components.service.nimbus.NimbusAppInfo
import mozilla.components.service.nimbus.NimbusBuilder
import mozilla.components.service.nimbus.messaging.FxNimbusMessaging
import mozilla.components.service.nimbus.messaging.NimbusSystem
import mozilla.components.support.base.log.logger.Logger
import org.mozilla.experiments.nimbus.NimbusInterface
import org.mozilla.experiments.nimbus.internal.GeckoPrefHandler
import org.mozilla.experiments.nimbus.internal.NimbusException
import org.mozilla.experiments.nimbus.internal.NimbusServerSettings
import org.mozilla.fenix.BuildConfig
import org.mozilla.fenix.R
import org.mozilla.fenix.ext.components
import org.mozilla.fenix.messaging.CustomAttributeProvider
import org.mozilla.fenix.nimbus.FxNimbus
import org.mozilla.fenix.utils.Settings

/**
 * The maximum amount of time the app launch will be blocked to load experiments from disk.
 *
 * ⚠️ This value was decided from analyzing the Focus metrics (nimbus_initial_fetch) for the ideal
 * timeout. We should NOT change this value without collecting more metrics first.
 */
private const val TIME_OUT_LOADING_EXPERIMENT_FROM_DISK_MS = 200L

private val logger = Logger("service/Nimbus")

/**
 * Create the Nimbus singleton object for the Fenix app.
 */
@Suppress("UNUSED_PARAMETER")
fun createNimbus(
    context: Context,
    settings: Settings,
    urlString: String?,
    remoteSettingsService: RemoteSettingsService?,
    geckoPrefHandler: GeckoPrefHandler,
): NimbusApi {
    return mozilla.components.service.nimbus.NimbusDisabled(context)
}

private fun Context.reportError(message: String, e: Throwable) {
    if (BuildConfig.BUILD_TYPE == "debug") {
        logger.error("Nimbus error: $message", e)
    }
    if (e !is NimbusException || e.isReportableError()) {
        @Suppress("TooGenericExceptionCaught")
        try {
            this.components.analytics.crashReporter.submitCaughtException(e)
        } catch (e: Throwable) {
            logger.error(message, e)
        }
    }
}

/**
 * Classifies which errors we should forward to our crash reporter or not. We want to filter out the
 * non-reportable ones if we know there is no reasonable action that we can perform.
 *
 * This fix should be upstreamed as part of: https://github.com/mozilla/application-services/issues/4333
 */
fun NimbusException.isReportableError(): Boolean {
    return when (this) {
        is NimbusException.ClientException -> false
        else -> true
    }
}

/**
 * Call `fetchExperiments` if the time since the last fetch is over a threshold.
 *
 * The threshold is given by the [NimbusSystem] feature object, defined in the
 * `nimbus.fml.yaml` file.
 */
fun NimbusInterface.maybeFetchExperiments(
    settings: Settings,
    feature: NimbusSystem = FxNimbusMessaging.features.nimbusSystem.value(),
    currentTimeMillis: Long = System.currentTimeMillis(),
) {
    if (settings.nimbusUsePreview) {
        settings.nimbusLastFetchTime = 0L
        fetchExperiments()
    } else {
        val minimumPeriodMinutes = feature.refreshIntervalForeground
        val lastFetchTimeMillis = settings.nimbusLastFetchTime
        val minimumPeriodMillis = minimumPeriodMinutes * Settings.ONE_MINUTE_MS

        if (currentTimeMillis - lastFetchTimeMillis >= minimumPeriodMillis) {
            settings.nimbusLastFetchTime = currentTimeMillis
            fetchExperiments()
        }
    }
}
