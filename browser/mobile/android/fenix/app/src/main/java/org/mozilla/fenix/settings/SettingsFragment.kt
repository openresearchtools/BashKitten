/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings

import android.content.Intent
import android.os.Bundle
import androidx.navigation.NavDirections
import androidx.navigation.fragment.findNavController
import androidx.navigation.fragment.navArgs
import androidx.preference.Preference
import androidx.preference.PreferenceCategory
import androidx.preference.PreferenceFragmentCompat
import mozilla.components.browser.state.state.selectedOrDefaultSearchEngine
import mozilla.components.support.utils.BuildManufacturerChecker
import mozilla.components.support.utils.ext.navigateToDefaultBrowserAppsSettings
import org.mozilla.fenix.HomeActivity
import org.mozilla.fenix.R
import org.mozilla.fenix.e2e.SystemInsetsPaddedFragment
import org.mozilla.fenix.ext.navigateToNotificationsSettings
import org.mozilla.fenix.ext.requireComponents
import org.mozilla.fenix.ext.showToolbar
import org.mozilla.fenix.ext.showToolbarWithIconButton
import com.bashkitten.AgentAccessActivity
import com.bashkitten.BrowserApp
import mozilla.components.ui.icons.R as iconsR

/** Settings for the capabilities shipped by BashKitten. */
class SettingsFragment : PreferenceFragmentCompat(), SystemInsetsPaddedFragment {
    private val args by navArgs<SettingsFragmentArgs>()

    override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
        setPreferencesFromResource(R.xml.preferences, rootKey)
        val category = PreferenceCategory(requireContext()).apply {
            title = "Agent"
            key = "bashkitten_settings"
            isIconSpaceReserved = false
        }
        preferenceScreen.addPreference(category)
        category.addPreference(Preference(requireContext()).apply {
            title = "Packages"
            summary = "Manage the local Agent's Termux, APT and Pi packages"
            isIconSpaceReserved = false
            setOnPreferenceClickListener {
                (activity as? HomeActivity)?.bashKittenAgentPanel?.packages()
                true
            }
        })
        category.addPreference(Preference(requireContext()).apply {
            title = "Agent browser control"
            summary = "Allow or disconnect this Agent's access to ordinary browser tabs"
            isIconSpaceReserved = false
            setOnPreferenceClickListener {
                (activity as? HomeActivity)?.bashKittenAgentPanel?.browserControl()
                true
            }
        })
        category.addPreference(Preference(requireContext()).apply {
            title = "Completed-turn notifications"
            isIconSpaceReserved = false
            setOnPreferenceClickListener {
                (activity as? HomeActivity)?.bashKittenAgentPanel?.notifications()
                true
            }
        })
        category.addPreference(Preference(requireContext()).apply {
            title = "Agent access"
            summary = "Allow or revoke access for Termux and other apps"
            isIconSpaceReserved = false
            setOnPreferenceClickListener {
                startActivity(Intent(requireContext(), AgentAccessActivity::class.java))
                true
            }
        })
        category.addPreference(Preference(requireContext()).apply {
            title = "Revoke agent access"
            summary = "Disconnect authorized apps and shell programs and close their tabs"
            isIconSpaceReserved = false
            setOnPreferenceClickListener {
                BrowserApp.get(requireContext()).revokeAgentAccess()
                true
            }
        })
        requirePreference<Preference>(R.string.pref_key_about).parent?.addPreference(Preference(requireContext()).apply {
            title = "Check for browser update"
            isIconSpaceReserved = false
            setOnPreferenceClickListener {
                (activity as? HomeActivity)?.bashKittenAgentPanel?.checkBrowserUpdate()
                true
            }
        })
    }

    override fun onResume() {
        super.onResume()
        val title = getString(R.string.browser_menu_settings)
        if (args.searchInProgress) {
            showToolbar(title)
        } else {
            showToolbarWithIconButton(
                title = title,
                contentDescription = getString(R.string.settings_search_button_content_description),
                iconResId = iconsR.drawable.mozac_ic_search_24,
                onClick = { findNavController().navigate(R.id.action_settingsFragment_to_settingsSearchFragment) },
            )
        }
        val settings = requireComponents.settings
        requirePreference<Preference>(R.string.pref_key_about).title =
            getString(R.string.preferences_about, getString(R.string.app_name))
        requirePreference<Preference>(R.string.pref_key_search_settings).summary =
            requireComponents.core.store.state.search.selectedOrDefaultSearchEngine?.name
        requirePreference<Preference>(R.string.pref_key_tabs).summary = settings.getTabTimeoutString()
        requirePreference<Preference>(R.string.pref_key_open_links_in_apps).summary = settings.getOpenLinksInAppsString()
        requirePreference<Preference>(R.string.pref_key_delete_browsing_data_on_quit_preference).summary =
            getString(if (settings.shouldDeleteBrowsingDataOnQuit) R.string.delete_browsing_data_quit_on else R.string.delete_browsing_data_quit_off)
        requirePreference<Preference>(R.string.pref_key_credit_cards).title =
            getString(if (settings.addressFeature) R.string.preferences_autofill else R.string.preferences_credit_cards_2)
        requirePreference<Preference>(R.string.pref_key_https_only_settings).summary = getString(when {
            !settings.shouldUseHttpsOnly -> R.string.preferences_https_only_off
            settings.shouldUseHttpsOnlyInAllTabs -> R.string.preferences_https_only_on_all
            else -> R.string.preferences_https_only_on_private
        })
        requirePreference<DefaultBrowserPreference>(R.string.pref_key_make_default_browser).apply {
            updateSwitch()
            setOnPreferenceClickListener {
                requireContext().navigateToDefaultBrowserAppsSettings(BuildManufacturerChecker())
                true
            }
        }
        args.preferenceToScrollTo?.let { scrollToPreferenceWithHighlight(it) }
    }

    override fun onPreferenceTreeClick(preference: Preference): Boolean {
        val directions: NavDirections? = when (preference.key) {
            getString(R.string.pref_key_search_settings) -> {
                SettingsFragmentDirections.actionSettingsFragmentToSearchEngineFragment()
            }
            getString(R.string.pref_key_tabs) -> {
                SettingsFragmentDirections.actionSettingsFragmentToTabsSettingsFragment()
            }
            getString(R.string.pref_key_home) -> {
                SettingsFragmentDirections.actionSettingsFragmentToHomeSettingsFragment()
            }
            getString(R.string.pref_key_customize) -> {
                SettingsFragmentDirections.actionSettingsFragmentToCustomizationFragment()
            }
            getString(R.string.pref_key_passwords) -> {
                SettingsFragmentDirections.actionSettingsFragmentToSavedLoginsAuthFragment()
            }
            getString(R.string.pref_key_credit_cards) -> {
                SettingsFragmentDirections.actionSettingsFragmentToAutofillSettingFragment()
            }
            getString(R.string.pref_key_accessibility) -> {
                SettingsFragmentDirections.actionSettingsFragmentToAccessibilityFragment()
            }
            getString(R.string.pref_key_language) -> {
                SettingsFragmentDirections.actionSettingsFragmentToLocaleSettingsFragment()
            }
            getString(R.string.pref_key_private_browsing) -> {
                SettingsFragmentDirections.actionSettingsFragmentToPrivateBrowsingFragment()
            }
            getString(R.string.pref_key_https_only_settings) -> {
                SettingsFragmentDirections.actionSettingsFragmentToHttpsOnlyFragment()
            }
            getString(R.string.pref_key_tracking_protection_settings) -> {
                SettingsFragmentDirections.actionSettingsFragmentToTrackingProtectionFragment()
            }
            getString(R.string.pref_key_site_permissions) -> {
                SettingsFragmentDirections.actionSettingsFragmentToSitePermissionsFragment()
            }
            getString(R.string.pref_key_delete_browsing_data) -> {
                SettingsFragmentDirections.actionSettingsFragmentToDeleteBrowsingDataFragment()
            }
            getString(R.string.pref_key_delete_browsing_data_on_quit_preference) -> {
                SettingsFragmentDirections.actionSettingsFragmentToDeleteBrowsingDataOnQuitFragment()
            }
            getString(R.string.pref_key_notifications) -> {
                context?.navigateToNotificationsSettings {}
                null
            }
            getString(R.string.pref_key_open_links_in_apps) -> {
                SettingsFragmentDirections.actionSettingsFragmentToOpenLinksInAppsFragment()
            }
            getString(R.string.pref_key_downloads) -> {
                SettingsFragmentDirections.actionSettingsFragmentToOpenDownloadsSettingsFragment()
            }
            getString(R.string.pref_key_about) -> {
                SettingsFragmentDirections.actionSettingsFragmentToAboutFragment()
            }
            else -> null
        }
        if (directions != null) {
            findNavController().navigate(directions)
            return true
        }
        return super.onPreferenceTreeClick(preference)
    }
}
