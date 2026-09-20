package com.bashkitten

import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import java.util.concurrent.Executors
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.drawable.toBitmap
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
class MainActivity : ComponentActivity() {
    private lateinit var web: WebSurface
    private var screen by mutableStateOf("chat")
    private var menuOpen by mutableStateOf(false)
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
    private val handler = Handler(Looper.getMainLooper())
    private var session: String? = null
    private var firstReady = true
    private fun initialized() = AppStore.prefs(this).getBoolean("termuxInitialized", false)
    private fun webRunning() = status?.optJSONObject("web")?.optString("status") == "running"
    private fun jobActive() = status?.optJSONObject("packages")?.optJSONObject("job")?.optString("status") in setOf("running", "waiting")
    private val setup = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        notice = if (result.resultCode == RESULT_OK) "Termux is ready" else "Termux setup did not finish"
        if (result.resultCode == RESULT_OK) { AppStore.prefs(this).edit().putBoolean("termuxInitialized", true).apply(); startBootstrap() }
        refresh()
    }
    private val poll = object : Runnable { override fun run() { refresh(); handler.postDelayed(this, if (jobActive() || installing) 1000 else 5000) } }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        enableEdgeToEdge()
        session = requestedSession(intent)
        screen = state?.getString("screen") ?: if (initialized()) "chat" else "apps"
        x11Variant = AppStore.variant(this)
        catalog = AppStore.entries(this)
        AppStore.schedule(this)
        web = WebSurface(this)
        if (System.currentTimeMillis() - AppStore.prefs(this).getLong("checkedAt", 0) > 3600000) checkCatalog()
        setContent {
            val colors = if (isSystemInDarkTheme()) darkColorScheme(primary = Color(0xffc5c5ca), background = Color(0xff1e1e1e), surface = Color(0xff1e1e1e), surfaceContainer = Color(0xff292929))
                else lightColorScheme(primary = Color(0xff505058), background = Color(0xfff3f3f3), surface = Color(0xfff3f3f3), surfaceContainer = Color.White)
            MaterialTheme(colorScheme = colors) {
                BackHandler { if (menuOpen) menuOpen = false else if (screen != "chat") openChat() else moveTaskToBack(true) }
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (screen != "chat") IconButton(onClick = { openChat() }, modifier = Modifier.semantics { contentDescription = "Back to chat" }) { Text("‹", style = MaterialTheme.typography.headlineMedium) }
                            Box {
                                IconButton(onClick = { menuOpen = !menuOpen }, modifier = Modifier.semantics { contentDescription = "Menu" }) { Text("☰", style = MaterialTheme.typography.titleLarge) }
                                Menu()
                            }
                            Text(when (screen) { "apps" -> "Apps"; "updates" -> "Package updates"; "desktop" -> "Desktop"; "sessions" -> "Pi sessions"; else -> "BashKitten" }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            if (screen == "apps") IconButton(enabled = !checking, onClick = { checkCatalog() }, modifier = Modifier.semantics { contentDescription = "Refresh apps" }) { Text("↻", style = MaterialTheme.typography.headlineSmall) }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .4f))
                        Box(Modifier.weight(1f).fillMaxWidth()) {
                            // Keep one attached WebView alive while native screens cover it.
                            AndroidView(factory = { web.view }, modifier = Modifier.fillMaxSize(), update = { it.visibility = if (screen == "chat") View.VISIBLE else View.INVISIBLE })
                            if (screen != "chat") Surface(Modifier.fillMaxSize()) {
                                when (screen) {
                                    "apps" -> Store()
                                    "updates" -> Updates()
                                    "desktop" -> ScrollPage { DesktopBlock() }
                                    "sessions" -> ScrollPage { Sessions() }
                                }
                            } else if (!webRunning()) Surface(Modifier.fillMaxSize()) {
                                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                    Text(if (status == null) "Connecting to Termux…" else "Server stopped", style = MaterialTheme.typography.headlineSmall)
                                    Text(notice.ifBlank { "Your chats stay saved. Start the server to continue." })
                                    if (TermuxBridge.trusted(this@MainActivity)) Button(onClick = { command("start") }) { Text("Start server") }
                                    TextButton(onClick = { navigate("apps") }) { Text("Open Apps") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    override fun onSaveInstanceState(state: Bundle) { state.putString("screen", screen); super.onSaveInstanceState(state) }
    override fun onResume() { super.onResume(); if (initialized() && TermuxBridge.trusted(this)) TermuxBridge.ensureManager(this); handler.removeCallbacks(poll); handler.post(poll) }
    override fun onPause() { handler.removeCallbacks(poll); web.flush(); super.onPause() }
    override fun onDestroy() { handler.removeCallbacks(poll); web.close(); io.shutdown(); super.onDestroy() }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); session = requestedSession(intent); if (status != null) openChat() }
    private fun requestedSession(intent: Intent): String? = intent.data?.takeIf { it.scheme == "bashkitten" && it.host == "session" }?.lastPathSegment?.takeIf { it.matches(Regex("[a-f0-9-]{36}")) }
    private fun navigate(destination: String) { menuOpen = false; screen = destination; web.view.clearFocus(); (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(web.view.windowToken, 0) }
    private fun refresh() {
        AppStore.reconcile(this); storeRevision++
        if (requesting || !initialized() || !TermuxBridge.trusted(this)) return
        requesting = true
        TermuxBridge.command(this, "status") { result ->
            requesting = false
            result.onSuccess { value ->
                status = value; AppStore.recoverServices(this, value)
                if (webRunning() && (firstReady || session != null)) {
                    firstReady = false
                    if (screen == "chat" || session != null) openChat() else web.open(value.getJSONObject("web").getString("url") + "/")
                }
            }.onFailure { error -> TermuxBridge.bootstrapStatus(this) { value -> value.onSuccess { bootstrap = it }; notice = error.message.orEmpty() } }
        }
    }
    private fun startBootstrap() {
        navigate("updates")
        runCatching { AppStore.setupProblem(this, true)?.let { error(it) }; TermuxBridge.bootstrap(this, AppStore.keyringChecksum(this)); notice = "Preparing the Termux environment…" }.onFailure { notice = it.message.orEmpty() }
    }
    private fun command(name: String, args: JSONObject = JSONObject()) {
        notice = ""
        TermuxBridge.command(this, name, args) { result -> result.onSuccess { status = it; if (name == "desktop-start") openViewer(); if (name in setOf("start", "restart") && screen == "chat") firstReady = true }.onFailure { notice = it.message.orEmpty() } }
    }
    private fun packageJob(kind: String) { navigate("updates"); command("package-job", JSONObject().put("kind", kind)) }
    private fun openChat() {
        val url = status?.optJSONObject("web")?.optString("url").orEmpty()
        if (url.matches(Regex("https?://127\\.0\\.0\\.1:[0-9]+"))) {
            if (session != null || web.view.url == null || web.origin != url) web.open(url + "/" + (session?.let { "#session=$it" } ?: ""))
            session = null
        }
        menuOpen = false; screen = "chat"
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
            notice = "Allow installation from BashKitten, then tap Install again."; return
        }
        installing = true
        io.execute {
            val result = runCatching { AppStore.install(this, entry) }
            runOnUiThread { installing = false; result.onFailure { notice = it.message.orEmpty() }; storeRevision++; confirmInstallation() }
        }
    }
    private fun confirmInstallation() { AppStore.confirmation(this)?.let { confirmation -> runCatching { startIntentSender(confirmation.intentSender, null, 0, 0, 0) }.onFailure { notice = "Android installation confirmation could not open. Retry the installation." } } }

    @Composable private fun Menu() {
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            for ((id, name) in listOf("chat" to "Chat", "apps" to "Apps", "updates" to "Package updates", "desktop" to "Desktop", "sessions" to "Pi sessions")) {
                DropdownMenuItem(text = { Text(name) }, onClick = { if (id == "chat") openChat() else navigate(id) })
            }
            HorizontalDivider()
            Row(Modifier.width(260.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Server · " + if (webRunning()) "Running" else "Stopped", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                IconButton(onClick = { command(if (webRunning()) "stop" else "start") }, modifier = Modifier.semantics { contentDescription = if (webRunning()) "Stop server" else "Start server" }) { Text(if (webRunning()) "■" else "▶") }
            }
        }
    }
    @Composable private fun ScrollPage(content: @Composable ColumnScope.() -> Unit) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            content()
            if (notice.isNotBlank()) Text(notice, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
    @Composable private fun AppRow(id: String) {
        val revision = storeRevision
        val current = AppStore.installed(this, id)
        val icon = remember(id, current?.longVersionCode) { runCatching { packageManager.getApplicationIcon(id).toBitmap(144, 144).asImageBitmap() }.getOrNull() }
        val entry = catalog.find { it.optString("packageId") == id && (id != "com.termux.x11" || it.optString("variant") == x11Variant) }
        val state = remember(revision, id) { AppStore.prefs(this).getString("state:$id", "").orEmpty() }
        val update = entry != null && (current?.longVersionCode ?: 0) < entry.optLong("versionCode")
        val pending = listOf("Downloading", "Waiting", "Installing", "Confirm").any { state.startsWith(it) }
        var detail by remember { mutableStateOf(false) }
        val description = when (id) {
            "com.termux" -> "Your Linux environment"; "com.termux.api" -> "Android services for Termux"; "com.bashkitten" -> "Your Pi workspace"
            "com.termux.x11" -> "Desktop display"; "com.termux.boot" -> "Start scripts after a reboot"; "com.termux.widget" -> "Home screen shortcuts"
            "com.termux.styling" -> "Terminal themes and fonts"; "com.termux.window" -> "Floating terminal window"; else -> "Tasker integration"
        }
        Card(onClick = { detail = true }, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(18.dp)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    val resource = when (id) { "com.termux" -> R.drawable.store_termux; "com.termux.api" -> R.drawable.store_api; "com.termux.x11" -> R.drawable.store_x11; "com.termux.boot" -> R.drawable.store_boot; "com.termux.widget" -> R.drawable.store_widget; "com.termux.styling" -> R.drawable.store_styling; "com.termux.window" -> R.drawable.store_float; "com.termux.tasker" -> R.drawable.store_tasker; else -> R.drawable.ic_bashkitten }
                    if (icon != null) Image(icon, contentDescription = null, modifier = Modifier.size(56.dp)) else Image(painterResource(resource), contentDescription = null, modifier = Modifier.size(56.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(AppStore.names.getValue(id), style = MaterialTheme.typography.titleMedium)
                        Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(current?.versionName?.let { if (update) "$it → ${entry!!.optString("versionName")}" else it } ?: entry?.optString("versionName").orEmpty(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    FilledTonalButton(enabled = (update && !installing && !pending) || state.startsWith("Confirm"), onClick = { if (state.startsWith("Confirm")) confirmInstallation() else install(entry!!) }, contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)) {
                        Text(if (state.startsWith("Confirm")) "Continue" else if (pending) "Installing" else if (state.startsWith("Failed") && update) "Retry" else if (current == null) "Install" else if (update) "Update" else "Installed", style = MaterialTheme.typography.labelMedium)
                    }
                }
                if (pending) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (state.isNotBlank() && state != "Installed") Text(state, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (detail) AlertDialog(onDismissRequest = { detail = false }, title = { Text(AppStore.names.getValue(id)) }, text = { Text(description + (entry?.optString("notes")?.takeIf { it.isNotBlank() }?.let { "\n\n$it" } ?: "")) }, confirmButton = { TextButton(onClick = { detail = false }) { Text("Done") } }, dismissButton = { if (entry != null) TextButton(onClick = { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(entry.getString("sourceUrl")))) }) { Text("Source / licenses") } })
    }
    @Composable private fun Store() {
        PullToRefreshBox(isRefreshing = checking, onRefresh = { checkCatalog() }, modifier = Modifier.fillMaxSize()) {
            ScrollPage {
                Text("Your apps", style = MaterialTheme.typography.headlineLarge)
                Text("Everything for your BashKitten workspace.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Card(onClick = { navigate("updates") }, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                    Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text("Package updates", style = MaterialTheme.typography.titleMedium); Text(if (jobActive()) status!!.getJSONObject("packages").getJSONObject("job").optString("phase") else "Termux packages · npm · Pi", style = MaterialTheme.typography.bodySmall) }
                        Text("›", style = MaterialTheme.typography.headlineSmall)
                    }
                }
                AppStore.setupProblem(this@MainActivity)?.let { Text(it) }
                val checkError = AppStore.prefs(this@MainActivity).getString("checkError", null)
                if (checkError != null) Text("Could not refresh apps. Pull down to retry.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                Text("Essential", style = MaterialTheme.typography.titleLarge)
                AppRow("com.bashkitten"); AppRow("com.termux"); AppRow("com.termux.api")
                if (!initialized()) {
                    if (installed("com.termux") != null && !TermuxBridge.trusted(this@MainActivity)) Text("The installed Termux has a different signature. Its data must be backed up before changing installations.")
                    Button(enabled = TermuxBridge.trusted(this@MainActivity) && installed("com.termux.api") != null, onClick = { runCatching { setup.launch(Intent().setComponent(ComponentName("com.termux", "com.termux.app.SuiteSetupActivity"))) }.onFailure { notice = it.message.orEmpty() } }) { Text("Set up environment") }
                }
                Text("Desktop", style = MaterialTheme.typography.titleLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (variant in listOf("standalone", "sharedUid")) FilterChip(selected = x11Variant == variant, onClick = { x11Variant = variant; AppStore.prefs(this@MainActivity).edit().putString("x11Variant", variant).apply() }, label = { Text(if (variant == "standalone") "Standalone" else "Shared UID") })
                }
                val x11 = AppStore.installed(this@MainActivity, "com.termux.x11")
                @Suppress("DEPRECATION") val installedVariant = if (x11?.sharedUserId == "com.termux") "sharedUid" else "standalone"
                if (x11 != null && installedVariant != x11Variant) Text("To switch variants, stop the desktop and remove X11 in Android settings, then install your choice here.", style = MaterialTheme.typography.bodySmall) else AppRow("com.termux.x11")
                Text("Optional", style = MaterialTheme.typography.titleLarge)
                for (id in AppStore.names.keys.drop(4)) AppRow(id)
            }
        }
    }
    @Composable private fun Updates() {
        val packages = status?.optJSONObject("packages")
        val sources = packages?.optJSONObject("sources")
        val job = packages?.optJSONObject("job")
        val active = jobActive()
        ScrollPage {
            Text("Keep everything up to date", style = MaterialTheme.typography.headlineSmall)
            Text("System packages and npm packages, including Pi.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (packages == null) {
                Text(if (initialized()) "Waiting for the Termux package service…" else "Install the essential apps, then set up the environment in Apps.")
                if (initialized()) TextButton(onClick = { startBootstrap() }) { Text("Resume setup") }
                bootstrap?.optJSONObject("bootstrap")?.let { Text(it.optString("phase")) }
                bootstrap?.optString("logBase64")?.takeIf { it.isNotBlank() }?.let { encoded -> Text(runCatching { android.util.Base64.decode(encoded, android.util.Base64.DEFAULT).toString(Charsets.UTF_8) }.getOrDefault(""), style = MaterialTheme.typography.bodySmall) }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !active, onClick = { packageJob("update-packages") }) { Text("Update all") }
                    OutlinedButton(enabled = !active, onClick = { packageJob("check-packages") }) { Text("Check updates") }
                }
                for ((key, title) in listOf("apt" to "Termux packages", "npm" to "npm packages", "pi" to "Pi")) {
                    val source = sources?.optJSONObject(key)
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(title, style = MaterialTheme.typography.titleMedium)
                            if (key == "pi") Text("Installed · " + packages.optJSONObject("runtime")?.optString("version").orEmpty(), style = MaterialTheme.typography.bodyMedium)
                            if (source?.has("error") == true) Text(source.optString("error"), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                            else if (source == null) Text("Check for updates", style = MaterialTheme.typography.bodySmall)
                            else if (key == "pi") Text(if (source.optBoolean("upstreamAvailable")) "Available · " + source.optString("latest") else "Up to date", style = MaterialTheme.typography.bodySmall)
                            else Text("${source.optInt("available")} updates available", style = MaterialTheme.typography.bodySmall)
                            val items = source?.optJSONArray("packages")
                            for (i in 0 until (items?.length() ?: 0)) {
                                val item = items!!.getJSONObject(i)
                                Text(item.optString("name") + " · " + item.optString("current") + " → " + item.optString("latest"), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                if (job != null) {
                    HorizontalDivider()
                    Text(if (job.optString("status") == "complete") "Updates complete" else job.optString("phase"), style = MaterialTheme.typography.titleMedium)
                    if (active) {
                        val progress = job.optJSONObject("progress")
                        if (progress != null) { LinearProgressIndicator(progress = { (progress.optDouble("percent", 0.0) / 100).toFloat() }, modifier = Modifier.fillMaxWidth()); Text(progress.optString("message"), style = MaterialTheme.typography.bodySmall) }
                        else LinearProgressIndicator(Modifier.fillMaxWidth())
                    }
                    job.optString("error").takeIf { it.isNotBlank() }?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    val log = job.optString("log")
                    val scroll = rememberScrollState()
                    LaunchedEffect(log) { scroll.scrollTo(scroll.maxValue) }
                    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                        SelectionContainer { Text(log.ifBlank { "Preparing…" }, Modifier.fillMaxWidth().heightIn(min = 140.dp, max = 300.dp).verticalScroll(scroll).padding(12.dp), style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace) }
                    }
                    if (active) TextButton(enabled = !job.optBoolean("cancelRequested"), onClick = { command("package-cancel") }) { Text(if (job.optBoolean("cancelRequested")) "Finishing current step…" else "Cancel after current step") }
                    if (job.optString("status") in setOf("failed", "interrupted", "cancelled")) Button(onClick = { command("package-job", JSONObject().put("retry", true)) }) { Text("Retry") }
                }
            }
        }
    }
    @Composable private fun Sessions() {
        val sessions = status?.optJSONArray("sessions")
        Text("Pi sessions", style = MaterialTheme.typography.headlineSmall)
        TextButton(onClick = { command("pi-stop") }) { Text("Stop all Pi instances") }
        for (i in 0 until (sessions?.length() ?: 0)) {
            val item = sessions!!.getJSONObject(i)
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.fillMaxWidth().padding(12.dp)) {
                    TextButton(onClick = { session = item.getString("id"); openChat() }) { Text(item.optString("title", "Chat")) }
                    if (item.optBoolean("running")) Row {
                        if (item.optBoolean("busy")) TextButton(onClick = { command("pi-abort", JSONObject().put("id", item.getString("id"))) }) { Text("Stop turn") }
                        TextButton(onClick = { command("pi-stop", JSONObject().put("id", item.getString("id"))) }) { Text("Stop instance") }
                        TextButton(onClick = { command("pi-kill", JSONObject().put("id", item.getString("id"))) }) { Text("Force stop") }
                    }
                }
            }
        }
    }
    private fun openViewer() {
        packageManager.getLaunchIntentForPackage("com.termux.x11")?.let { startActivity(it) }
    }
    @Composable private fun DesktopBlock() {
        val desktop = status?.optJSONObject("desktop") ?: return
        var profilesOpen by remember { mutableStateOf(false) }
        var methodsOpen by remember { mutableStateOf(false) }
        var advanced by remember { mutableStateOf(false) }
        var custom by remember(desktop.optString("customCommand")) { mutableStateOf(desktop.optString("customCommand")) }
        val running = desktop.optBoolean("running")
        val busy = status?.optJSONObject("packages")?.optJSONObject("job")?.optString("status") in setOf("running", "waiting")
        val profiles = desktop.getJSONArray("profiles")
        val selected = (0 until profiles.length()).map { profiles.getJSONObject(it) }.find { it.getString("id") == desktop.optString("requested") }
        val companion = catalog.find { it.optString("packageId") == "com.termux.x11" && it.optString("variant") == x11Variant }
        if (companion != null && installed("com.termux.x11") == companion.optString("versionName")) TextButton(enabled = !busy, onClick = {
            command("package-job", JSONObject().put("kind", "install-desktop").put("input", JSONObject().put("companionVersion", companion.optString("companionVersion"))))
        }) { Text("Install XFCE / LibreOffice") }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Desktop · " + if (running) "Running" else "Stopped")
            TextButton(enabled = running || (!busy && desktop.optBoolean("ready")), onClick = { command(if (running) "desktop-stop" else "desktop-start") }) { Text(if (running) "■ Stop desktop" else "▶ Start desktop") }
        }
        Box {
            TextButton(enabled = !busy, onClick = { profilesOpen = true }) { Text((selected?.optString("name") ?: "Choose graphics") + if (desktop.optBoolean("ready")) " ✓" else "") }
            DropdownMenu(expanded = profilesOpen, onDismissRequest = { profilesOpen = false }) {
                for (i in 0 until profiles.length()) {
                    val profile = profiles.getJSONObject(i)
                    DropdownMenuItem(text = { Text(profile.getString("name") + if (profile.getString("id") == desktop.optString("requested") && desktop.optBoolean("ready")) " ✓" else "") }, onClick = {
                        profilesOpen = false; command("package-job", JSONObject().put("kind", "graphics-profile").put("input", JSONObject().put("profile", profile.getString("id"))))
                    })
                }
            }
        }
        Box {
            TextButton(onClick = { methodsOpen = true }) { Text("Startup · " + desktop.optString("method")) }
            DropdownMenu(expanded = methodsOpen, onDismissRequest = { methodsOpen = false }) {
                for ((id, label) in linkedMapOf("xstartup" to "XFCE with D-Bus (-xstartup)", "separator" to "Command separator (--)", "separate" to "Separate server / session", "environment" to "TERMUX_X11_XSTARTUP", "no-dbus" to "XFCE without D-Bus", "custom" to "Custom command")) {
                    DropdownMenuItem(text = { Text(label) }, onClick = { methodsOpen = false; command("desktop-settings", JSONObject().put("method", id)) })
                }
            }
        }
        Row {
            TextButton(onClick = { openViewer() }) { Text("Open X11 viewer") }
            TextButton(onClick = { sendBroadcast(Intent("com.termux.x11.ACTION_STOP").setPackage("com.termux.x11")) }) { Text("Close viewer") }
            TextButton(onClick = { advanced = !advanced }) { Text("Options") }
        }
        if (advanced) {
            Text("Stopping the desktop closes its applications. Closing only the viewer keeps them running.", style = MaterialTheme.typography.bodySmall)
            for ((key, label) in listOf("legacyDrawing" to "Legacy drawing", "forceBgra" to "Force BGRA")) Row {
                Checkbox(checked = desktop.optBoolean(key), onCheckedChange = { command("desktop-settings", JSONObject().put(key, it)) }); Text(label)
            }
            var dpi by remember(desktop.optInt("dpi")) { mutableStateOf(desktop.optInt("dpi").toString()) }
            var display by remember(desktop.optInt("display")) { mutableStateOf(desktop.optInt("display").toString()) }
            Row {
                OutlinedTextField(value = display, onValueChange = { display = it }, label = { Text("Display") }, modifier = Modifier.weight(1f))
                OutlinedTextField(value = dpi, onValueChange = { dpi = it }, label = { Text("DPI") }, modifier = Modifier.weight(1f))
            }
            OutlinedTextField(value = custom, onValueChange = { custom = it }, label = { Text("Custom startup command") }, modifier = Modifier.fillMaxWidth())
            Text("Custom: termux-x11 :$display -xstartup \"$custom\"", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { command("desktop-settings", JSONObject().put("display", display.toIntOrNull() ?: 0).put("dpi", dpi.toIntOrNull() ?: 0).put("customCommand", custom)) }) { Text("Save options") }
            var profileName by remember { mutableStateOf("") }
            var requirements by remember { mutableStateOf("") }
            var variables by remember { mutableStateOf("") }
            var conflicts by remember { mutableStateOf("") }
            Text("Custom graphics profile", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(value = profileName, onValueChange = { profileName = it }, label = { Text("Profile name") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = requirements, onValueChange = { requirements = it }, label = { Text("Packages · one name=minimum-version per line") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = variables, onValueChange = { variables = it }, label = { Text("Environment · one NAME=value per line") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = conflicts, onValueChange = { conflicts = it }, label = { Text("Conflicting package names · optional") }, modifier = Modifier.fillMaxWidth())
            Text("Only the packages you declare are managed. Select the saved profile to prepare and validate it; Start launches the saved startup command.", style = MaterialTheme.typography.bodySmall)
            TextButton(enabled = !busy && profileName.isNotBlank(), onClick = {
                runCatching {
                    fun pairs(text: String): JSONObject = JSONObject().apply {
                        text.lineSequence().filter { it.isNotBlank() }.forEach { line ->
                            val parts = line.split('=', limit = 2); require(parts.size == 2 && parts[0].isNotBlank()) { "Use one name=value per line" }; put(parts[0].trim(), parts[1].trim())
                        }
                    }
                    val profile = JSONObject().put("name", profileName).put("packages", pairs(requirements)).put("env", pairs(variables))
                        .put("conflicts", org.json.JSONArray(conflicts.split(Regex("\\s+")).filter { it.isNotBlank() }))
                    command("desktop-settings", JSONObject().put("customProfile", profile))
                }.onFailure { notice = it.message.orEmpty() }
            }) { Text("Save graphics profile") }
            val saved = desktop.optJSONArray("customProfiles")
            if (saved != null) for (i in 0 until saved.length()) {
                val profile = saved.getJSONObject(i)
                Row {
                    TextButton(onClick = {
                        profileName = profile.getString("name")
                        fun lines(value: JSONObject) = value.keys().asSequence().joinToString("\n") { it + "=" + value.getString(it) }
                        requirements = lines(profile.getJSONObject("packages")); variables = lines(profile.getJSONObject("env"))
                        conflicts = profile.optJSONArray("conflicts")?.let { a -> (0 until a.length()).joinToString(" ") { a.getString(it) } }.orEmpty()
                    }) { Text("Edit " + profile.getString("name")) }
                    TextButton(enabled = !busy, onClick = { command("desktop-settings", JSONObject().put("removeProfile", profile.getString("id"))) }) { Text("Remove") }
                }
            }
            desktop.optString("renderer").takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
        desktop.optString("error").takeIf { it.isNotBlank() }?.let { Text(it) }
    }
}
