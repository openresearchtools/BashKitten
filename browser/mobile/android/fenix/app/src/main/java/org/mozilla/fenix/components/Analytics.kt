/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components

import android.app.Application
import android.content.Context
import mozilla.components.lib.crash.CrashReporter
import mozilla.components.support.utils.Browsers
import mozilla.components.support.utils.RunWhenReadyQueue
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
import org.mozilla.fenix.perf.lazyMonitored
import org.mozilla.fenix.utils.Settings

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
