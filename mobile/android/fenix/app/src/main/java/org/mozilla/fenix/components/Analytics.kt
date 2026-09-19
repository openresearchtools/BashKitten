/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components

import android.app.Application
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import mozilla.components.lib.crash.CrashReporter
import mozilla.components.lib.crash.runtimetagproviders.BuildRuntimeTagProvider
import mozilla.components.lib.crash.runtimetagproviders.EnvironmentRuntimeProvider
import mozilla.components.lib.crash.runtimetagproviders.ExperimentDataRuntimeTagProvider
import mozilla.components.lib.crash.runtimetagproviders.VersionInfoProvider
import mozilla.components.lib.crash.sentry.SentryService
import mozilla.components.lib.crash.sentry.eventprocessors.CrashMetadataEventProcessor
import mozilla.components.lib.crash.service.CrashReporterService
import mozilla.components.lib.crash.service.GleanCrashReporterService
import mozilla.components.lib.crash.service.socorro.MozillaSocorroService
import mozilla.components.lib.crash.store.CrashReportOption
import mozilla.components.support.ktx.android.content.isMainProcess
import mozilla.components.support.utils.Browsers
import mozilla.components.support.utils.RunWhenReadyQueue
import mozilla.components.support.utils.ext.packageManagerCompatHelper
import org.mozilla.fenix.BuildConfig
import org.mozilla.fenix.Config
import org.mozilla.fenix.HomeActivity
import org.mozilla.fenix.R
import org.mozilla.fenix.ReleaseChannel
import org.mozilla.fenix.components.metrics.AdjustMetricsService
import org.mozilla.fenix.components.metrics.DefaultMetricsStorage
import org.mozilla.fenix.components.metrics.FirstSessionMetricsService
import org.mozilla.fenix.components.metrics.GleanMetricsService
import org.mozilla.fenix.components.metrics.GleanProfileIdPreferenceStore
import org.mozilla.fenix.components.metrics.GleanUsageReportingMetricsService
import org.mozilla.fenix.components.metrics.InstallReferrerMetricsService
import org.mozilla.fenix.components.metrics.MetricController
import org.mozilla.fenix.components.metrics.MetricsStorage
import org.mozilla.fenix.crashes.CrashFactCollector
import org.mozilla.fenix.crashes.NimbusExperimentDataProvider
import org.mozilla.fenix.crashes.ReleaseRuntimeTagProvider
import org.mozilla.fenix.crashes.crashReportOption
import org.mozilla.fenix.perf.lazyMonitored
import org.mozilla.fenix.utils.Settings
import org.mozilla.geckoview.BuildConfig.MOZ_APP_BUILDID
import org.mozilla.geckoview.BuildConfig.MOZ_APP_VENDOR
import org.mozilla.geckoview.BuildConfig.MOZ_APP_VERSION
import org.mozilla.geckoview.BuildConfig.MOZ_UPDATE_CHANNEL

/**
 * Component group for all functionality related to analytics e.g. crash reporting and telemetry.
 */
class Analytics(
    private val context: Context,
    private val settings: Settings,
    private val nimbusComponents: NimbusComponents,
    private val runWhenReadyQueue: RunWhenReadyQueue,
) {
    val crashReporter: CrashReporter by lazyMonitored {
        CrashReporter(
            context = context,
            services = emptyList(),
            telemetryServices = emptyList(),
            shouldPrompt = CrashReporter.Prompt.NEVER,
            enabled = false,
            useLegacyReporting = false,
            runtimeTagProviders = emptyList(),
        )
    }

    val crashFactCollector: CrashFactCollector by lazyMonitored {
        CrashFactCollector(crashReporter)
    }

    val metricsStorage: MetricsStorage by lazyMonitored {
        DefaultMetricsStorage(
            context = context,
            settings = settings,
            checkDefaultBrowser = { Browsers.isDefaultBrowser(context) },
        )
    }

    val metrics: MetricController by lazyMonitored {
        MetricController.create(
            listOf(
                GleanMetricsService(context),
                AdjustMetricsService(
                    application = context as Application,
                    storage = metricsStorage,
                    crashReporter = crashReporter,
                ),
                FirstSessionMetricsService(context),
                InstallReferrerMetricsService(context, settings),
                GleanUsageReportingMetricsService(gleanProfileIdStore = GleanProfileIdPreferenceStore(context)),
            ),
            isDataTelemetryEnabled = { settings.isTelemetryEnabled },
            isMarketingDataTelemetryEnabled = {
                settings.isMarketingTelemetryEnabled && settings.hasMadeMarketingTelemetrySelection
            },
            isUsageTelemetryEnabled = { settings.isDailyUsagePingEnabled },
            settings,
        )
    }
}

private fun isSentryEnabled() = !BuildConfig.SENTRY_TOKEN.isNullOrEmpty()

private fun getSentryProjectUrl(): String? {
    val baseUrl = "https://sentry.io/organizations/mozilla/issues"
    return when (Config.channel) {
        ReleaseChannel.Nightly -> "$baseUrl/?project=6295546"
        ReleaseChannel.Release -> "$baseUrl/?project=6375561"
        ReleaseChannel.Beta -> "$baseUrl/?project=6295551"
        else -> null
    }
}

private val Context.versionInfoProvider: VersionInfoProvider
    get() {
        val packageInfo = applicationContext.packageManagerCompatHelper.getPackageInfoCompat(
            applicationContext.packageName,
            0,
        )
        return VersionInfoProvider.fromPackageInfo(packageInfo)
    }
