package com.bashkitten

import android.app.Dialog
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.Message
import android.provider.MediaStore
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Ordinary system picker/cookies; native privileges are never exposed to JavaScript. */
class WebSurface(private val activity: MainActivity) {
    private val downloads = Executors.newSingleThreadExecutor()
    private var chooser: ValueCallback<Array<Uri>>? = null
    private val picker = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        chooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)); chooser = null
    }
    var origin: String = "http://127.0.0.1:3939"
    val view: WebView = create()

    fun flush() = CookieManager.getInstance().flush()
    fun open(url: String) { origin = Uri.parse(url).let { "${it.scheme}://${it.host}:${it.port}" }; if (view.url != url) view.loadUrl(url) }
    private fun local(uri: Uri) = "${uri.scheme}://${uri.host}:${uri.port}" == origin
    private fun external(uri: Uri) {
        if (uri.scheme !in setOf("https", "http", "mailto")) return
        runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)) }
            .onFailure { toast("No application can open this link") }
    }
    private fun toast(text: String) = activity.runOnUiThread { Toast.makeText(activity, text, Toast.LENGTH_LONG).show() }

    private fun create(dialog: Dialog? = null): WebView = WebView(activity).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = true // Granted system-picker URIs for HTML file inputs.
        settings.setSupportMultipleWindows(true)
        settings.javaScriptCanOpenWindowsAutomatically = false
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(web: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val uri = request.url
                if (local(uri) && uri.path in setOf("/", "/pi-login")) return false
                if (request.hasGesture()) {
                    if (local(uri) && uri.path?.startsWith("/api/") == true) download(uri.toString(), null, null)
                    else external(uri)
                }
                return true
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(web: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                chooser?.onReceiveValue(null); chooser = callback
                runCatching { picker.launch(params.createIntent()) }.onFailure { chooser?.onReceiveValue(null); chooser = null; toast("Could not open the system file picker") }
                return true
            }
            override fun onCreateWindow(web: WebView, isDialog: Boolean, isUserGesture: Boolean, result: Message): Boolean {
                if (!isUserGesture) return false
                val popup = Dialog(activity)
                val child = create(popup)
                popup.setContentView(child); popup.setOnDismissListener { child.destroy() }
                popup.show(); popup.window?.setLayout(-1, -1)
                (result.obj as WebView.WebViewTransport).webView = child
                result.sendToTarget()
                return true
            }
            override fun onCloseWindow(window: WebView) { dialog?.dismiss() }
        }
        setDownloadListener { url, _, disposition, mime, _ -> if (local(Uri.parse(url))) download(url, disposition, mime) else external(Uri.parse(url)) }
    }

    private fun download(url: String, disposition: String?, mime: String?) {
        val cookies = CookieManager.getInstance().getCookie(url).orEmpty()
        downloads.execute {
            var saved: Uri? = null
            try {
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 15000; connection.readTimeout = 60000
                connection.setRequestProperty("Cookie", cookies)
                try {
                    check(connection.responseCode == 200) { "Download failed (${connection.responseCode})" }
                    val type = connection.contentType?.substringBefore(';') ?: mime ?: "application/octet-stream"
                    val name = URLUtil.guessFileName(url, connection.getHeaderField("Content-Disposition") ?: disposition, type).substringAfterLast('/').take(180)
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, name); put(MediaStore.Downloads.MIME_TYPE, type)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/BashKitten")
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                    saved = activity.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("Downloads is unavailable")
                    activity.contentResolver.openOutputStream(saved!!).use { output ->
                        checkNotNull(output); connection.inputStream.use { it.copyTo(output) }
                    }
                    activity.contentResolver.update(saved!!, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
                    val uri = saved!!
                    activity.runOnUiThread {
                        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        runCatching { activity.startActivity(intent) }.onFailure { toast("Saved $name to Downloads/BashKitten") }
                    }
                } finally { connection.disconnect() }
            } catch (error: Exception) {
                saved?.let { activity.contentResolver.delete(it, null, null) }
                toast(error.message ?: "Download failed")
            }
        }
    }
}
