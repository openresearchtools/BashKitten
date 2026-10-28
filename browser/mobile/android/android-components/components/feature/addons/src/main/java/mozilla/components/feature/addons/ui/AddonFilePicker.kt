/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.addons.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResultCaller
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import mozilla.components.concept.engine.webextension.InstallationMethod
import mozilla.components.feature.addons.Addon
import mozilla.components.feature.addons.AddonManager
import mozilla.components.support.base.log.logger.Logger
import mozilla.components.support.ktx.android.net.getFileName
import mozilla.components.support.ktx.android.net.toFileUri
import java.io.File
import java.util.UUID

private const val XPI_DIR = "XPIs"

/**
 * Allows to launch a file picker to select an add-on file.
 * @param context the application context
 */
class AddonFilePicker(
    val context: Context,
    private val addonManager: AddonManager,
) {
    internal lateinit var activityLauncher: ActivityResultLauncher<Array<String>>
    private val logger = Logger("AddonFilePicker")

    /**
     * Launch an Android file picker where the user can select an add-on file.
     * @returns a [Boolean] indicating if the file picker was launched successfully or not.
     */
    fun launch(): Boolean {
        return try {
            activityLauncher.launch(emptyArray())
            true
        } catch (e: ActivityNotFoundException) {
            logger.error("Unable to find an app to select an XPI file", e)
            false
        }
    }

    /**
     * Registers a listener for file picker results.
     * @param resultCaller The [ActivityResultCaller] on which results will be observed.
     * @param scope Optional caller-owned scope for copying provider files off the UI thread.
     * @param onFileReadError Called if preparing the selected file fails before native installation.
     */
    fun registerForResults(
        resultCaller: ActivityResultCaller,
        scope: CoroutineScope? = null,
        onFileReadError: (Throwable) -> Unit = {},
    ) {
        activityLauncher =
            resultCaller.registerForActivityResult(AddonOpenDocument()) { uri ->
                if (scope == null) {
                    handleUriSelected(uri)
                } else if (uri != null) {
                    scope.launch(Dispatchers.Main) {
                        val directory = File(context.cacheDir, "$XPI_DIR/${UUID.randomUUID()}")
                        var handedToInstaller = false
                        try {
                            val prepared = withContext(Dispatchers.IO) {
                                check(directory.mkdirs()) { "Cannot prepare the selected add-on file" }
                                uri.toFileUri(context, directory.relativeTo(context.cacheDir).path).toString()
                            }
                            installFileUri(prepared) {
                                scope.launch(NonCancellable + Dispatchers.IO) {
                                    directory.deleteRecursively()
                                }
                            }
                            handedToInstaller = true
                        } catch (error: CancellationException) {
                            throw error
                        } catch (error: Exception) {
                            logger.error("Unable to prepare the selected add-on file", error)
                            onFileReadError(error)
                        } finally {
                            if (!handedToInstaller) {
                                withContext(NonCancellable + Dispatchers.IO) {
                                    directory.deleteRecursively()
                                }
                            }
                        }
                    }
                }
            }
    }

    internal fun handleUriSelected(uri: Uri?) {
        uri?.let { safeUri ->
            val fileUri = convertToFileUri(safeUri)
            installFileUri(fileUri) { removeTemporaryFile(safeUri) }
        }
    }

    private fun installFileUri(fileUri: String, cleanup: () -> Unit) {
        val onSuccess: ((Addon) -> Unit) = {
            logger.info("Add-on from $fileUri installed successfully")
            cleanup()
        }
        val onError: ((Throwable) -> Unit) = { throwable ->
            logger.error("Unable to install add-on from $fileUri", throwable)
            cleanup()
        }
        addonManager.installAddon(fileUri, InstallationMethod.FROM_FILE, onSuccess, onError)
    }

    internal fun removeTemporaryFile(fileUri: Uri) {
        val contentResolver = context.contentResolver
        File(File(context.cacheDir, XPI_DIR), fileUri.getFileName(contentResolver)).delete()
    }

    internal fun convertToFileUri(uri: Uri): String = uri.toFileUri(context, XPI_DIR).toString()
}

internal open class AddonOpenDocument : ActivityResultContracts.OpenDocument() {
    override fun createIntent(context: Context, input: Array<String>): Intent {
        return super.createIntent(context, arrayOf("application/x-xpinstall", "application/zip"))
    }
}
