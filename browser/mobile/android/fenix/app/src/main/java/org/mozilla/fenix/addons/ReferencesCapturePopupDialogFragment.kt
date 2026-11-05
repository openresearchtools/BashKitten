/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.addons

import android.graphics.Rect
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import mozilla.components.support.base.android.NoObscuredTouchesDialogFragment
import kotlin.math.min

/** Keeps the native References action popup above its original browsing tab. */
class ReferencesCapturePopupDialogFragment : NoObscuredTouchesDialogFragment() {
    private var containerId = View.NO_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setStyle(STYLE_NO_TITLE, 0)
        containerId = savedInstanceState?.getInt(CONTAINER_ID) ?: View.generateViewId()
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View = FrameLayout(requireContext()).apply {
        id = containerId
        layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        if (childFragmentManager.findFragmentById(containerId) == null) {
            val popup = WebExtensionActionPopupFragment().apply {
                arguments = WebExtensionActionPopupFragmentArgs(
                    webExtensionId = EXTENSION_ID,
                    webExtensionTitle = requireArguments().getString(TITLE),
                ).toBundle()
            }
            childFragmentManager.beginTransaction().replace(containerId, popup).commitNow()
        }
        view.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> resize() }
        ViewCompat.setOnApplyWindowInsetsListener(view) { _, insets ->
            resize()
            insets
        }
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        resize()
    }

    private fun resize() {
        val window = dialog?.window ?: return
        val visible = Rect()
        requireActivity().window.decorView.getWindowVisibleDisplayFrame(visible)
        val density = resources.displayMetrics.density
        val margin = (32 * density).toInt()
        val width = min((440 * density).toInt(), visible.width() - margin).coerceAtLeast(1)
        val height = min((420 * density).toInt(), visible.height() - margin).coerceAtLeast(1)
        if (window.attributes.width != width || window.attributes.height != height) {
            window.setLayout(width, height)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt(CONTAINER_ID, containerId)
        super.onSaveInstanceState(outState)
    }

    companion object {
        const val EXTENSION_ID = "references@taskarian.org"
        const val TAG = "references-capture-popup"
        private const val TITLE = "title"
        private const val CONTAINER_ID = "containerId"

        /** Creates a References action dialog with the extension's existing popup title. */
        fun newInstance(title: String?) = ReferencesCapturePopupDialogFragment().apply {
            arguments = Bundle().apply { putString(TITLE, title) }
        }
    }
}
