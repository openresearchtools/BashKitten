/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.metrics

import org.mozilla.fenix.utils.Settings

/**
 * Descriptions of utm parameters comes from
 * https://support.google.com/analytics/answer/1033863
 * - utm_source
 *  Identify the advertiser, site, publication, etc.
 *  that is sending traffic to your property, for example: google, newsletter4, billboard.
 * - utm_medium
 *  The advertising or marketing medium, for example: cpc, banner, email newsletter.
 * utm_campaign
 *  The individual campaign name, slogan, promo code, etc. for a product.
 * - utm_term
 *  Identify paid search keywords.
 *  If you're manually tagging paid keyword campaigns, you should also use
 *  utm_term to specify the keyword.
 * - utm_content
 *  Used to differentiate similar content, or links within the same ad.
 *  For example, if you have two call-to-action links within the same email message,
 *  you can use utm_content and set different values for each so you can tell
 *  which version is more effective.
 */
data class UTMParams(
    val source: String,
    val medium: String,
    val campaign: String,
    val content: String,
    val term: String,
) {

    companion object {
        const val UTM_SOURCE = "utm_source"
        const val UTM_MEDIUM = "utm_medium"
        const val UTM_CAMPAIGN = "utm_campaign"
        const val UTM_CONTENT = "utm_content"
        const val UTM_TERM = "utm_term"

        /**
         * Try and unpack the install referrer response.
         */
        fun parseInstallReferrer(installReferrerResponse: String): Map<String, String> {
            val params = mutableMapOf<String, String>()
            for (param in installReferrerResponse.split("&")) {
                val keyValue = param.split("=", limit = 2)
                if (keyValue.size == 2) {
                    val key = keyValue[0]
                    val value = keyValue[1]
                    params[key] = value
                }
            }
            return params
        }

        /**
         * Extract the [UTMParams] from the install referrer response.
         */
        fun parseUTMParameters(installReferrerResponse: String): UTMParams {
            val utmParams = parseInstallReferrer(installReferrerResponse)
            return UTMParams(
                source = utmParams[UTM_SOURCE] ?: "",
                medium = utmParams[UTM_MEDIUM] ?: "",
                campaign = utmParams[UTM_CAMPAIGN] ?: "",
                content = utmParams[UTM_CONTENT] ?: "",
                term = utmParams[UTM_TERM] ?: "",
            )
        }

        /**
         * Derive the set of UTM parameters stored in Settings.
         */
        fun fromSettings(settings: Settings): UTMParams =
            with(settings) {
                UTMParams(
                    source = utmSource,
                    medium = utmMedium,
                    campaign = utmCampaign,
                    content = utmContent,
                    term = utmTerm,
                )
            }
    }

    /**
     * Persist the UTM params into Settings.
     */
    fun intoSettings(settings: Settings) {
        with(settings) {
            utmSource = source
            utmMedium = medium
            utmCampaign = campaign
            utmTerm = term
            utmContent = content
        }
    }

    /**
     * Check if this UTM param is empty
     *
     * @Return [Boolean] true if none of the utm params are set.
     */
    fun isEmpty(): Boolean {
        return source.isBlank() &&
            medium.isBlank() &&
            campaign.isBlank() &&
            term.isBlank() &&
            content.isBlank()
    }
}
