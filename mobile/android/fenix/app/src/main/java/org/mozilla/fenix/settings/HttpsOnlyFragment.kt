/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings

import android.os.Bundle
import android.text.SpannableStringBuilder
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
import android.text.style.URLSpan
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.text.HtmlCompat
import androidx.core.text.getSpans
import androidx.core.view.children
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import org.mozilla.fenix.R
import org.mozilla.fenix.databinding.SettingsHttpsOnlyBinding
import org.mozilla.fenix.e2e.SystemInsetsPaddedFragment
import org.mozilla.fenix.ext.components
import org.mozilla.fenix.ext.openToBrowser
import org.mozilla.fenix.ext.requireComponents

/**
 * Lets the user customize HTTPS-only mode.
 */
class HttpsOnlyFragment : Fragment(), SystemInsetsPaddedFragment {
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        val binding = SettingsHttpsOnlyBinding.inflate(inflater)

        binding.httpsOnlySummary.text = getString(R.string.preferences_https_only_summary)

        binding.httpsOnlySwitch.run {
            isChecked = context.components.settings.shouldUseHttpsOnly
            setHttpsModes(binding, isChecked)

            setOnCheckedChangeListener { _, isHttpsOnlyEnabled ->
                context.components.settings.shouldUseHttpsOnly = isHttpsOnlyEnabled
                setHttpsModes(binding, isHttpsOnlyEnabled)
                updateEngineHttpsOnlyMode()
            }
        }

        // Since the http-only modes are in a RadioGroup we only need one listener to know of all their changes.
        binding.httpsOnlyAllTabs.setOnCheckedChangeListener { _, _ ->
            updateEngineHttpsOnlyMode()
        }

        return binding.root
    }

    private fun setHttpsModes(binding: SettingsHttpsOnlyBinding, isHttpsOnlyEnabled: Boolean) {
        if (!isHttpsOnlyEnabled) {
            binding.httpsOnlyModes.apply {
                clearCheck()
                children.forEach { it.isEnabled = false }
            }
        } else {
            binding.httpsOnlyModes.children.forEach { it.isEnabled = true }
        }
    }

    private fun updateEngineHttpsOnlyMode() {
        requireContext().components.core.engine.settings.httpsOnlyMode =
            requireComponents.settings.getHttpsOnlyMode()
    }

}
