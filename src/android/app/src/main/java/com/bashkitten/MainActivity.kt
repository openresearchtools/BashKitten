package com.bashkitten

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var web: WebSurface
    private var appsOpen by mutableStateOf(true)
    private var status by mutableStateOf<JSONObject?>(null)
    private var notice by mutableStateOf("")
    private var requesting = false
    private val handler = Handler(Looper.getMainLooper())
    private var session: String? = null
    private val setup = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        notice = if (result.resultCode == RESULT_OK) "Termux is ready" else "Termux setup did not finish"
        refresh()
    }
    private val poll = object : Runnable { override fun run() { refresh(); handler.postDelayed(this, 5000) } }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        session = requestedSession(intent)
        web = WebSurface(this)
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                        Row(Modifier.fillMaxWidth().height(44.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            TextButton(onClick = { appsOpen = !appsOpen }) { Text("☰  BashKitten") }
                            if (status?.optJSONObject("web")?.optString("status") == "running") TextButton(onClick = { openChat() }) { Text("Chat") }
                        }
                        if (appsOpen) Store() else AndroidView(factory = { web.view }, modifier = Modifier.weight(1f).fillMaxWidth())
                    }
                }
            }
        }
    }

    override fun onResume() { super.onResume(); handler.post(poll) }
    override fun onPause() { handler.removeCallbacks(poll); web.flush(); super.onPause() }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); session = requestedSession(intent); if (status != null) openChat() }
    private fun requestedSession(intent: Intent): String? = intent.data?.takeIf { it.scheme == "bashkitten" && it.host == "session" }?.lastPathSegment?.takeIf { it.matches(Regex("[a-f0-9-]{36}")) }

    private fun refresh() {
        if (requesting || !TermuxBridge.trusted(this)) return
        requesting = true
        TermuxBridge.command(this, "status") { result ->
            requesting = false
            result.onSuccess { value -> status = value; if (!appsOpen && value.optJSONObject("web")?.optString("status") != "running") appsOpen = true }
                .onFailure { notice = it.message.orEmpty() }
        }
    }
    private fun command(name: String, args: JSONObject = JSONObject()) {
        notice = "Working…"
        TermuxBridge.command(this, name, args) { result -> result.onSuccess { status = it; notice = "" }.onFailure { notice = it.message.orEmpty() } }
    }
    private fun openChat() {
        val url = status?.optJSONObject("web")?.optString("url").orEmpty()
        if (!url.matches(Regex("https?://127\\.0\\.0\\.1:[0-9]+"))) return
        web.open(url + "/" + (session?.let { "#session=$it" } ?: "")); session = null; appsOpen = false
    }
    private fun installed(id: String): String? = runCatching { packageManager.getPackageInfo(id, 0).versionName }.getOrNull()

    @Composable private fun Store() {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Apps and services", style = MaterialTheme.typography.headlineSmall)
            Text("Required", style = MaterialTheme.typography.titleMedium)
            for ((id, name) in listOf("com.termux" to "Termux", "com.termux.api" to "Termux:API", "com.bashkitten" to "BashKitten")) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(name); Text(installed(id)?.let { "Installed · $it" } ?: "Not installed")
                }
            }
            if (installed("com.termux") != null && !TermuxBridge.trusted(this@MainActivity)) Text("This Termux uses a different signing certificate. Back up its home before migrating to the suite.")
            Button(enabled = TermuxBridge.trusted(this@MainActivity), onClick = {
                runCatching { setup.launch(Intent().setComponent(ComponentName("com.termux", "com.termux.app.SuiteSetupActivity"))) }.onFailure { notice = it.message.orEmpty() }
            }) { Text("Initialize Termux") }
            HorizontalDivider()
            val running = status?.optJSONObject("web")?.optString("status") == "running"
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Backend · " + (status?.optJSONObject("web")?.optString("status") ?: "Unknown"))
                TextButton(onClick = { command(if (running) "stop" else "start") }) { Text(if (running) "■ Stop" else "▶ Start") }
            }
            Row {
                TextButton(onClick = { command("restart") }) { Text("Restart backend") }
                TextButton(onClick = { command("pi-stop") }) { Text("Stop all Pi") }
            }
            val sessions = status?.optJSONArray("sessions")
            for (i in 0 until (sessions?.length() ?: 0)) {
                val item = sessions!!.getJSONObject(i)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { session = item.getString("id"); openChat() }) { Text(item.optString("title", "Chat")) }
                    if (item.optBoolean("running")) TextButton(onClick = { command("pi-stop", JSONObject().put("id", item.getString("id"))) }) { Text("■") }
                }
            }
            if (notice.isNotEmpty()) Text(notice)
        }
    }
}
