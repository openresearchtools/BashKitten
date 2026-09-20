/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.browser.permissions

import mozilla.components.concept.engine.permission.Permission
import mozilla.components.feature.sitepermissions.SitePermissionsLearnMoreUrlProvider
import org.mozilla.fenix.settings.SupportUtils
import org.mozilla.fenix.settings.SupportUtils.SumoTopic

/**
 * Fenix implementation of the [SitePermissionsLearnMoreUrlProvider] used to determine the url
 * when a permission prompt offers a "learn more" link.
 *
 * See [mozilla.components.feature.sitepermissions.SitePermissionsFeature] for how it's used.
 */
class FenixSitePermissionLearnMoreUrlProvider : SitePermissionsLearnMoreUrlProvider {

    override fun getUrl(permission: Permission): String? = null
}
