package com.bashkitten

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/** Offline copy of the web About view; no backend, cookies or native command bridge. */
@SuppressLint("SetJavaScriptEnabled")
class AboutView(context: Context) : WebView(context) {
    init {
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.isForMainFrame && request.hasGesture() && request.url.scheme in setOf("https", "http"))
                    context.startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
        }
        val html = context.assets.open("about.html").bufferedReader().use { it.readText() }
        loadDataWithBaseURL("https://bashkitten.invalid/", html, "text/html", "UTF-8", null)
    }
}
