package com.bashkitten

import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.os.Bundle
import java.util.concurrent.Executors
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
    private val io = Executors.newSingleThreadExecutor()
    private var catalog by mutableStateOf<List<JSONObject>>(emptyList())
    private var storeRevision by mutableIntStateOf(0)
    private var bootstrap by mutableStateOf<JSONObject?>(null)
    private var checking by mutableStateOf(false)
    private var installing by mutableStateOf(false)
    private var x11Variant by mutableStateOf("standalone")
    private var changeX11 by mutableStateOf(false)
    private val handler = Handler(Looper.getMainLooper())
    private var session: String? = null
    private val setup = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        notice = if (result.resultCode == RESULT_OK) "Termux is ready" else "Termux setup did not finish"
        if (result.resultCode == RESULT_OK) startBootstrap()
        refresh()
    }
    private val poll = object : Runnable { override fun run() { refresh(); handler.postDelayed(this, 5000) } }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        enableEdgeToEdge()
        session = requestedSession(intent)
        x11Variant = AppStore.variant(this)
        catalog = AppStore.entries(this)
        AppStore.schedule(this)
        if (System.currentTimeMillis() - AppStore.prefs(this).getLong("checkedAt", 0) > 3600000) checkCatalog()
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

    override fun onResume() { super.onResume(); if (TermuxBridge.trusted(this)) TermuxBridge.ensureManager(this); handler.post(poll) }
    override fun onPause() { handler.removeCallbacks(poll); web.flush(); super.onPause() }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); session = requestedSession(intent); if (status != null) openChat() }
    private fun requestedSession(intent: Intent): String? = intent.data?.takeIf { it.scheme == "bashkitten" && it.host == "session" }?.lastPathSegment?.takeIf { it.matches(Regex("[a-f0-9-]{36}")) }

    private fun refresh() {
        storeRevision++
        if (requesting || !TermuxBridge.trusted(this)) return
        requesting = true
        TermuxBridge.command(this, "status") { result ->
            requesting = false
            result.onSuccess { value -> status = value; if (!appsOpen && value.optJSONObject("web")?.optString("status") != "running") appsOpen = true }
                .onFailure { error ->
                    TermuxBridge.bootstrapStatus(this) { value -> value.onSuccess { bootstrap = it }; notice = error.message.orEmpty() }
                }
        }
    }
    private fun startBootstrap() {
        runCatching { TermuxBridge.bootstrap(this, AppStore.keyringChecksum(this)); notice = "Preparing the Termux environment…" }
            .onFailure { notice = it.message.orEmpty() }
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

    private fun checkCatalog() {
        if (checking) return
        checking = true
        io.execute {
            val result = runCatching { AppStore.check(this); AppStore.entries(this) }
            runOnUiThread { checking = false; result.onSuccess { catalog = it }.onFailure { notice = it.message.orEmpty() }; storeRevision++ }
        }
    }
    private fun install(entry: JSONObject) {
        if (!packageManager.canRequestPackageInstalls()) {
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            notice = "Allow installation from BashKitten, then tap Install again."
            return
        }
        installing = true
        io.execute {
            val result = runCatching { AppStore.install(this, entry) }
            runOnUiThread { installing = false; result.onFailure { notice = it.message.orEmpty() }; storeRevision++; confirmInstallation() }
        }
    }
    private fun confirmInstallation() {
        AppStore.confirmation(this)?.let { confirmation ->
            runCatching { startActivity(confirmation) }.onFailure { notice = "Android installation confirmation could not open. Retry the installation." }
        }
    }
    @Composable private fun AppRow(id: String) {
        val revision = storeRevision
        val current = AppStore.installed(this, id)
        val entry = catalog.find { it.optString("packageId") == id && (id != "com.termux.x11" || it.optString("variant") == x11Variant) }
        val state = remember(revision, id) { AppStore.prefs(this).getString("state:$id", "").orEmpty() }
        val update = entry != null && (current?.longVersionCode ?: 0) < entry.optLong("versionCode")
        Column {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(AppStore.names.getValue(id), style = MaterialTheme.typography.titleMedium)
                    Text(current?.versionName?.let { "Installed · $it" } ?: "Not installed", style = MaterialTheme.typography.bodySmall)
                    if (entry != null) Text(entry.optString("versionName") + " · suite " + entry.optInt("suiteRevision", 1), style = MaterialTheme.typography.bodySmall)
                }
                Button(enabled = update && !installing, onClick = { install(entry!!) }) { Text(if (current == null) "Install" else if (update) "Update" else "Installed") }
            }
            if (state.isNotBlank() && state != "Installed") Text(state, style = MaterialTheme.typography.bodySmall)
            if (entry != null) Row {
                TextButton(onClick = { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(entry.getString("sourceUrl")))) }) { Text("Source / licenses") }
                if (entry.optString("notes").isNotBlank()) Text(entry.optString("notes"), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    @Composable private fun PackageBlock() {
        val packages = status?.optJSONObject("packages")
        val pi = packages?.optJSONObject("sources")?.optJSONObject("pi")
        val apt = packages?.optJSONObject("sources")?.optJSONObject("apt")
        val job = packages?.optJSONObject("job")
        val active = job?.optString("status") in setOf("running", "waiting")
        var details by remember { mutableStateOf(false) }
        fun run(kind: String) = command("package-job", JSONObject().put("kind", kind))
        HorizontalDivider()
        Text("Termux packages", style = MaterialTheme.typography.titleMedium)
        if (packages == null) {
            bootstrap?.optJSONObject("bootstrap")?.let { Text(it.optString("phase"), style = MaterialTheme.typography.bodySmall) }
            bootstrap?.optString("logBase64")?.takeIf { it.isNotBlank() }?.let { encoded ->
                val log = runCatching { android.util.Base64.decode(encoded, android.util.Base64.DEFAULT).toString(Charsets.UTF_8) }.getOrDefault("")
                Text(log.lineSequence().toList().takeLast(5).joinToString("\n"), style = MaterialTheme.typography.bodySmall)
            }
            TextButton(enabled = TermuxBridge.trusted(this@MainActivity), onClick = { startBootstrap() }) { Text("Set up / resume") }
        }
        Row {
            Button(enabled = packages != null && !active, onClick = { run("update-packages") }) { Text("Update packages") }
            TextButton(enabled = packages != null && !active, onClick = { run("check-packages") }) { Text("Check updates") }
        }
        Text("Pi (npm) · " + (packages?.optJSONObject("runtime")?.optString("version") ?: "Not installed"), style = MaterialTheme.typography.bodyMedium)
        pi?.let { Text(if (it.has("error")) "npm: " + it.optString("error") else "Upstream " + it.optString("latest") + " · Compatible " + it.optString("compatible"), style = MaterialTheme.typography.bodySmall) }
        apt?.let { Text(if (it.has("error")) "APT: " + it.optString("error") else it.optInt("available").toString() + " package updates", style = MaterialTheme.typography.bodySmall) }
        Row {
            TextButton(enabled = packages != null && !active, onClick = { run("update-pi") }) { Text("Update Pi") }
            if (packages?.optJSONObject("runtime")?.optString("previous")?.isNotBlank() == true) TextButton(enabled = !active, onClick = { run("rollback-pi") }) { Text("Roll back Pi") }
            TextButton(onClick = { details = !details }) { Text(if (details) "Hide details" else "Details") }
        }
        if (job != null) {
            Text(job.optString("phase") + " · " + job.optString("status"), style = MaterialTheme.typography.bodySmall)
            if (active) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (job.has("error")) Text(job.optString("error"), style = MaterialTheme.typography.bodySmall)
            if (job.optString("status") in setOf("failed", "interrupted")) TextButton(onClick = { command("package-job", JSONObject().put("retry", true)) }) { Text("Retry") }
            Text(job.optString("log").lineSequence().toList().takeLast(5).joinToString("\n"), style = MaterialTheme.typography.bodySmall)
        }
        if (details) {
            Row {
                TextButton(enabled = packages != null && !active, onClick = { run("refresh-lists") }) { Text("Refresh lists") }
                TextButton(enabled = packages != null && !active, onClick = { run("recover-packages") }) { Text("Repair packages") }
            }
            Text(job?.optString("log").orEmpty(), style = MaterialTheme.typography.bodySmall)
        }
        HorizontalDivider()
    }
    @Composable private fun Store() {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Apps and services", style = MaterialTheme.typography.headlineSmall)
            Row {
                TextButton(enabled = !checking, onClick = { checkCatalog() }) { Text(if (checking) "Checking…" else "Check app updates") }
                if (AppStore.confirmation(this@MainActivity) != null) Button(onClick = { confirmInstallation() }) { Text("Confirm install") }
            }
            AppStore.prefs(this@MainActivity).getString("checkError", null)?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            PackageBlock()
            Text("Required", style = MaterialTheme.typography.titleMedium)
            AppRow("com.termux"); AppRow("com.termux.api"); AppRow("com.bashkitten")
            Text("Desktop", style = MaterialTheme.typography.titleMedium)
            Row {
                for (variant in listOf("standalone", "sharedUid")) FilterChip(selected = x11Variant == variant, onClick = {
                    x11Variant = variant; AppStore.prefs(this@MainActivity).edit().putString("x11Variant", variant).apply()
                }, label = { Text(if (variant == "standalone") "Standalone" else "Shared UID") })
            }
            val x11 = AppStore.installed(this@MainActivity, "com.termux.x11")
            @Suppress("DEPRECATION") val installedVariant = if (x11?.sharedUserId == "com.termux") "sharedUid" else "standalone"
            if (x11 != null && installedVariant != x11Variant) {
                Text("Switching variant requires removing only the X11 viewer. Its settings may be reset; Termux projects stay in Termux.")
                TextButton(onClick = { changeX11 = true }) { Text("Change X11 variant") }
            } else AppRow("com.termux.x11")
            if (changeX11) AlertDialog(onDismissRequest = { changeX11 = false }, title = { Text("Remove the X11 viewer?") },
                text = { Text("Stop the desktop and save its applications first. Android will ask to uninstall X11. Then install the selected variant here.") },
                confirmButton = { TextButton(onClick = { changeX11 = false; startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:com.termux.x11"))) }) { Text("Continue") } },
                dismissButton = { TextButton(onClick = { changeX11 = false }) { Text("Cancel") } })
            Text("Optional", style = MaterialTheme.typography.titleMedium)
            for (id in AppStore.names.keys.drop(4)) AppRow(id)
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
