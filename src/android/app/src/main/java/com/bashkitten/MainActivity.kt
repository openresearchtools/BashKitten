package com.bashkitten

import android.content.ClipData
import android.content.ClipboardManager
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
    private fun back() = openChat()
    private var menuOpen by mutableStateOf(false)
    private var status by mutableStateOf<JSONObject?>(null)
    private var notice by mutableStateOf("")
    private var requesting = false
    private val io = Executors.newSingleThreadExecutor()
    private var catalog by mutableStateOf<List<JSONObject>>(emptyList())
    private var storeRevision by mutableIntStateOf(0)
    private var bootstrap by mutableStateOf<JSONObject?>(null)
    private var checking by mutableStateOf(false)
    private var connecting by mutableStateOf(false)
    private var connectExpanded by mutableStateOf(false)
    private var inventory by mutableStateOf<JSONObject?>(null)
    private var inventoryLoading by mutableStateOf(false)
    private var inventoryError by mutableStateOf("")
    private var packagesExpanded by mutableStateOf(false)
    private var visible = false
    private var setupActive = false
    private var managerAttempts = 0
    private var reconnectUntil = 0L
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
    private val poll = object : Runnable { override fun run() {
        if (!visible) return
        refresh()
        if (setupActive || AppStore.busy(this@MainActivity) || (screen != "chat" && jobActive()) || managerAttempts > 0 || reconnecting()) handler.postDelayed(this, 1500)
    } }
    private fun reconnecting() = System.currentTimeMillis() < reconnectUntil && !webRunning() && status?.optJSONObject("web")?.optBoolean("desired", true) != false
    private fun followWork() { if (visible) { handler.removeCallbacks(poll); handler.postDelayed(poll, 1000) } }
    private fun essentialsMissing() = listOf("com.termux", "com.termux.api", "com.termux.x11").any { AppStore.installed(this, it) == null }
    private val commandPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) connectTermux() else notice = "Allow ‘Run commands in Termux’ in BashKitten’s Android permissions, then connect."
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        enableEdgeToEdge()
        session = requestedSession(intent)
        screen = state?.getString("screen") ?: if (initialized()) "chat" else "apps"
        if (screen in setOf("licenses", "license")) screen = "about"
        @Suppress("DEPRECATION")
        val x11 = AppStore.installed(this, "com.termux.x11")
        x11Variant = if (x11 == null) AppStore.variant(this) else if (x11.sharedUserId == "com.termux") "sharedUid" else "standalone"
        AppStore.prefs(this).edit().putString("x11Variant", x11Variant).apply()
        catalog = AppStore.entries(this)
        AppStore.schedule(this)
        web = WebSurface(this)
        if (System.currentTimeMillis() - AppStore.prefs(this).getLong("checkedAt", 0) > 86400000) checkCatalog()
        setContent {
            val colors = if (isSystemInDarkTheme()) darkColorScheme(primary = Color(0xffa9c7ff), background = Color(0xff1e1e1e), surface = Color(0xff1e1e1e), surfaceContainer = Color(0xff292929))
                else lightColorScheme(primary = Color(0xff1764d8), background = Color(0xfff5f6fa), surface = Color(0xfff5f6fa), surfaceContainer = Color.White)
            MaterialTheme(colorScheme = colors) {
                BackHandler { if (menuOpen) menuOpen = false else if (screen != "chat") back() else moveTaskToBack(true) }
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (screen != "chat") IconButton(onClick = { back() }, modifier = Modifier.semantics { contentDescription = "Back to chat" }) { Text("‹", style = MaterialTheme.typography.headlineMedium) }
                            Box {
                                IconButton(onClick = { menuOpen = !menuOpen; if (menuOpen) refresh() }, modifier = Modifier.semantics { contentDescription = "Menu" }) { Text("☰", style = MaterialTheme.typography.titleLarge) }
                                Menu()
                            }
                            Text(when (screen) { "apps" -> "Apps"; "desktop" -> "Desktop"; "sessions" -> "Pi sessions"; "about" -> "About"; else -> "BashKitten" }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            if (screen == "apps") IconButton(enabled = !checking, onClick = { checkUpdates() }, modifier = Modifier.semantics { contentDescription = "Refresh apps" }) { Text("↻", style = MaterialTheme.typography.headlineSmall) }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .4f))
                        Box(Modifier.weight(1f).fillMaxWidth()) {
                            // Keep one attached WebView alive while native screens cover it.
                            AndroidView(factory = { web.view }, modifier = Modifier.fillMaxSize(), update = { it.visibility = if (screen == "chat") View.VISIBLE else View.INVISIBLE })
                            if (screen != "chat") Surface(Modifier.fillMaxSize()) {
                                when (screen) {
                                    "apps" -> Store()
                                    "desktop" -> ScrollPage { DesktopBlock() }
                                    "sessions" -> ScrollPage { Sessions() }
                                    "about" -> AndroidView(factory = { AboutView(this@MainActivity) }, modifier = Modifier.fillMaxSize(), onRelease = { it.destroy() })

                                }
                            } else if (!webRunning()) Surface(Modifier.fillMaxSize()) {
                                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                    Text(if (status == null) "Connecting to Termux…" else if (reconnecting()) "Starting server…" else "Server stopped", style = MaterialTheme.typography.headlineSmall)
                                    Text(notice.ifBlank { status?.optJSONObject("web")?.optString("error").orEmpty().takeUnless { it == "null" }.orEmpty().ifBlank { "Your chats stay saved. Start the server to continue." } })
                                    if (TermuxBridge.available(this@MainActivity)) Button(onClick = { command("start") }) { Text("Start server") }
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
    override fun onResume() { super.onResume(); visible = true; preflight() }
    override fun onPause() { visible = false; handler.removeCallbacks(poll); web.flush(); super.onPause() }
    override fun onDestroy() { handler.removeCallbacks(poll); web.close(); io.shutdown(); super.onDestroy() }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); session = requestedSession(intent); if (status != null) openChat() }
    private fun requestedSession(intent: Intent): String? = intent.data?.takeIf { it.scheme == "bashkitten" && it.host == "session" }?.lastPathSegment?.takeIf { it.matches(Regex("[a-f0-9-]{36}")) }
    private fun navigate(destination: String) {
        menuOpen = false; screen = destination
        web.view.clearFocus(); (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(web.view.windowToken, 0)
        if (destination in setOf("apps", "desktop", "sessions")) { refresh(); followWork() }
    }
    private fun aboutScreen() = screen == "about"
    fun backendUnavailable() { if (screen == "chat") { firstReady = true; navigate("apps"); preflight() } }
    private fun preflight() {
        if (aboutScreen()) return
        firstReady = true; reconnectUntil = System.currentTimeMillis() + 60000
        AppStore.reconcile(this); storeRevision++
        if (essentialsMissing()) screen = "apps"
        if (AppStore.busy(this)) followWork()
        if (!TermuxBridge.available(this)) { status = null; screen = "apps"; connectExpanded = installed("com.termux") != null; return }
        if (!initialized()) { screen = "apps"; return }
        TermuxBridge.ensureManager(this); managerAttempts = 5; refresh(); followWork()
    }
    private fun connectTermux() {
        if (connecting) return
        if (TermuxBridge.trusted(this) && !initialized()) {
            runCatching { setup.launch(Intent().setComponent(ComponentName("com.termux", "com.termux.app.SuiteSetupActivity"))) }.onFailure { notice = it.message.orEmpty() }
            return
        }
        if (!TermuxBridge.available(this)) { commandPermission.launch(TermuxBridge.permission); return }
        connecting = true; notice = ""
        TermuxBridge.probe(this) { result ->
            connecting = false
            result.onSuccess { value ->
                AppStore.prefs(this).edit().putBoolean("termuxInitialized", true).apply()
                if (!value.optBoolean("packages")) startBootstrap()
                else {
                    connectExpanded = false; TermuxBridge.ensureManager(this); managerAttempts = 5
                    handler.postDelayed({ command("termux-source", JSONObject().put("source", if (TermuxBridge.trusted(this)) "suite" else "external")); refresh(); followWork() }, 1200)
                }
            }.onFailure { notice = it.message.orEmpty(); connectExpanded = true; screen = "apps" }
        }
    }
    private fun refresh() {
        AppStore.reconcile(this); storeRevision++
        if (requesting || !initialized() || !TermuxBridge.available(this)) return
        requesting = true
        TermuxBridge.command(this, "status") { result ->
            requesting = false
            result.onSuccess { value ->
                status = value; managerAttempts = 0; setupActive = false; AppStore.recoverServices(this, value)
                if (webRunning() || !value.getJSONObject("web").optBoolean("desired", true)) reconnectUntil = 0
                if (webRunning() && (firstReady || session != null)) {
                    firstReady = false
                    if (((screen == "chat" && !menuOpen) || session != null) && !essentialsMissing()) openChat() else web.open(value.getJSONObject("web").getString("url") + "/")
                }
                if (reconnecting() || (screen != "chat" && jobActive())) followWork()
            }.onFailure { error ->
                if (managerAttempts > 0) managerAttempts--
                if (managerAttempts == 0 && !setupActive && !aboutScreen()) { screen = "apps"; connectExpanded = true; notice = error.message.orEmpty() }
                if (reconnecting()) { TermuxBridge.ensureManager(this); followWork() }
                TermuxBridge.bootstrapStatus(this) { result -> result.onSuccess {
                    bootstrap = it
                    setupActive = it.optJSONObject("bootstrap")?.optString("status") == "running"
                    if (setupActive) { notice = ""; packagesExpanded = true; followWork() }
                } }
            }
        }
    }
    private fun startBootstrap() {
        navigate("apps"); packagesExpanded = true
        runCatching {
            AppStore.setupProblem(this, true)?.let { error(it) }
            TermuxBridge.bootstrap(this, AppStore.keyringChecksum(this)); setupActive = true
            notice = ""; followWork()
        }.onFailure { notice = it.message.orEmpty() }
    }
    private fun command(name: String, args: JSONObject = JSONObject()) {
        notice = ""
        TermuxBridge.command(this, name, args) { result -> result.onSuccess {
            status = it
            if (name == "desktop-start") openViewer()
            if (name in setOf("start", "restart")) { firstReady = true; reconnectUntil = System.currentTimeMillis() + 60000; refresh(); followWork() }
            if (jobActive()) followWork()
        }.onFailure { notice = it.message.orEmpty() } }
    }
    private fun packageJob(kind: String) { packagesExpanded = true; navigate("apps"); command("package-job", JSONObject().put("kind", kind)) }
    private fun checkUpdates() { checkCatalog(); if (status != null && !jobActive()) packageJob("check-packages") }
    private fun loadInventory() {
        if (inventoryLoading) return
        inventoryLoading = true; inventoryError = ""
        TermuxBridge.command(this, "package-inventory") { result ->
            inventoryLoading = false
            result.onSuccess { inventory = it }.onFailure { inventoryError = it.message.orEmpty() }
        }
    }
    private fun openChat() {
        val url = status?.optJSONObject("web")?.optString("url").orEmpty()
        if (url.matches(Regex("https?://127\\.0\\.0\\.1:[0-9]+"))) {
            val fragment = web.view.url?.takeIf { it.startsWith(web.origin + "/") }?.let { Uri.parse(it).encodedFragment }?.takeIf { it.matches(Regex("session=[a-f0-9-]{36}")) }
            val target = session?.let { "$url/#session=$it" } ?: fragment?.let { "$url/#$it" } ?: "$url/"
            web.open(target)
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
        runCatching { AppStore.enqueueInstall(this, entry); storeRevision++; followWork() }.onFailure { notice = it.message.orEmpty() }
    }
    private fun confirmInstallation() { AppStore.confirmation(this)?.let { confirmation -> runCatching { startIntentSender(confirmation.intentSender, null, 0, 0, 0) }.onFailure { notice = "Android installation confirmation could not open. Retry the installation." } } }

    @Composable private fun Menu() {
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            for ((id, name) in listOf("chat" to "Chat", "apps" to "Apps", "desktop" to "Desktop", "sessions" to "Pi sessions", "about" to "About")) {
                DropdownMenuItem(text = { Text(name) }, onClick = { if (id == "chat") openChat() else navigate(id) })
            }
            HorizontalDivider()
            Row(Modifier.width(260.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Server · " + if (webRunning()) "Running" else "Stopped", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                IconButton(onClick = { command(if (webRunning()) "stop" else "start") }, modifier = Modifier.semantics { contentDescription = if (webRunning()) "Stop server" else "Start server" }) { Text(if (webRunning()) "■" else "▶") }
            }
            if (webRunning()) DropdownMenuItem(text = { Text("Open in browser") }, onClick = {
                menuOpen = false
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(status!!.getJSONObject("web").getString("url"))))
            })
        }
    }
    @Composable private fun ScrollPage(content: @Composable ColumnScope.() -> Unit) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            content()
            if (notice.isNotBlank()) Text(notice, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
    @Composable private fun AppRow(id: String) {
        val revision = storeRevision
        val current = remember(revision, id) { AppStore.installed(this, id) }
        val icon = remember(id, current?.longVersionCode) { runCatching { packageManager.getApplicationIcon(id).toBitmap(144, 144).asImageBitmap() }.getOrNull() }
        val allowed = remember(revision, id) { AppStore.canInstall(this, id) }
        val entry = catalog.find { it.optString("packageId") == id && (id != "com.termux.x11" || it.optString("variant") == x11Variant) }
        val state = remember(revision, id) { AppStore.prefs(this).getString("state:$id", "").orEmpty() }
        val update = allowed && entry != null && (current?.longVersionCode ?: 0) < entry.optLong("versionCode")
        val pending = allowed && listOf("Queued", "Downloading", "Waiting", "Installing", "Confirm").any { state.startsWith(it) }
        var detail by remember { mutableStateOf(false) }
        var typesOpen by remember { mutableStateOf(false) }
        val description = when (id) {
            "com.termux" -> "Your Linux environment"; "com.termux.api" -> "Android services for Termux"; "com.bashkitten" -> "Your Pi workspace"
            "com.termux.x11" -> "Desktop display"; "com.termux.boot" -> "Start scripts after a reboot"; "com.termux.widget" -> "Home screen shortcuts"
            "com.termux.styling" -> "Terminal themes and fonts"; "com.termux.window" -> "Floating terminal window"; else -> "Tasker integration"
        }
        Card(onClick = { detail = true }, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(20.dp)) {
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    val resource = when (id) { "com.termux" -> R.drawable.store_termux; "com.termux.api" -> R.drawable.store_api; "com.termux.x11" -> R.drawable.store_x11; "com.termux.boot" -> R.drawable.store_boot; "com.termux.widget" -> R.drawable.store_widget; "com.termux.styling" -> R.drawable.store_styling; "com.termux.window" -> R.drawable.store_float; "com.termux.tasker" -> R.drawable.store_tasker; else -> R.drawable.ic_bashkitten }
                    if (icon != null) Image(icon, contentDescription = null, modifier = Modifier.size(48.dp)) else Image(painterResource(resource), contentDescription = null, modifier = Modifier.size(48.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(AppStore.names.getValue(id), style = MaterialTheme.typography.titleMedium)
                        Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val version = current?.versionName?.let { if (update) "$it → ${entry!!.optString("versionName")}" else it } ?: if (allowed) entry?.optString("versionName").orEmpty() else ""
                        if (version.isNotBlank()) Text(version, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (!allowed && current == null) Text("Missing", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelLarge)
                    else FilledTonalButton(enabled = (update && !AppStore.busy(this@MainActivity)) || (allowed && state.startsWith("Confirm")), onClick = { if (state.startsWith("Confirm")) confirmInstallation() else install(entry!!) }, contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)) {
                        Text(if (allowed && state.startsWith("Confirm")) "Continue" else if (pending) "Installing" else if (state.startsWith("Failed") && update) "Retry" else if (current == null) "Install" else if (update) "Update" else "Installed", style = MaterialTheme.typography.labelMedium)
                    }
                }
                if (!allowed && id != "com.bashkitten") Text(if (current == null) "Install this app from the same source as your Termux." else "Managed by your Termux source.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (id == "com.termux.x11" && allowed) {
                    if (current == null) Box {
                        TextButton(enabled = !pending, onClick = { typesOpen = true }, contentPadding = PaddingValues(horizontal = 0.dp)) { Text("Type · " + (if (x11Variant == "standalone") "Normal (recommended)" else "Shared UID") + " ▾") }
                        DropdownMenu(expanded = typesOpen, onDismissRequest = { typesOpen = false }) {
                            for ((type, label) in listOf("standalone" to "Normal (recommended)", "sharedUid" to "Shared UID")) DropdownMenuItem(text = { Text(label + if (x11Variant == type) " ✓" else "") }, onClick = {
                                x11Variant = type; typesOpen = false; AppStore.prefs(this@MainActivity).edit().putString("x11Variant", type).apply()
                            })
                        }
                    } else {
                        @Suppress("DEPRECATION") val type = if (current.sharedUserId == "com.termux") "Shared UID" else "Normal"
                        Text("Type · $type", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (pending) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (allowed && state.isNotBlank() && state != "Installed") Text(state, style = MaterialTheme.typography.bodySmall)
                if (id == "com.termux" && current != null) ConnectionBlock()
            }
        }
        if (detail) AlertDialog(onDismissRequest = { detail = false }, title = { Text(AppStore.names.getValue(id)) }, text = { Text(description + (if (allowed) entry?.optString("notes")?.takeIf { it.isNotBlank() }?.let { "\n\n$it" }.orEmpty() else "\n\nInstalled from another source. Use that source for updates and compatible add-ons.") + if (id == "com.termux.x11" && current != null && allowed) "\n\nTo change type, stop the desktop and remove X11 manually in Android settings, then choose a type here." else "") }, confirmButton = { TextButton(onClick = { detail = false }) { Text("Done") } }, dismissButton = { if (allowed && entry != null) TextButton(onClick = { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(entry.getString("sourceUrl")))) }) { Text("Source / licenses") } })
    }
    @Composable private fun ConnectionBlock() {
        val external = AppStore.externalTermux(this)
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(if (status != null) "Server · " + if (webRunning()) "Running" else "Stopped" else "Connect your environment", style = MaterialTheme.typography.labelLarge)
                if (status != null) Text("Termux connected", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (status != null) IconButton(onClick = { command(if (webRunning()) "stop" else "start") }, modifier = Modifier.semantics { contentDescription = if (webRunning()) "Stop server" else "Start server" }) { Text(if (webRunning()) "■" else "▶") }
            else TextButton(enabled = !connecting, onClick = { if (external) connectExpanded = !connectExpanded else connectTermux() }) { Text(if (connecting) "Connecting…" else if (external) "Connect to Termux" else "Set up") }
        }
        if (external && connectExpanded) {
            Text("1. Open Termux and run this command once:", style = MaterialTheme.typography.bodySmall)
            SelectionContainer { Text(TermuxBridge.connectCommand, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) }
            Row {
                TextButton(onClick = { (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Connect BashKitten", TermuxBridge.connectCommand)); android.widget.Toast.makeText(this@MainActivity, "Command copied", android.widget.Toast.LENGTH_SHORT).show() }) { Text("Copy command") }
                TextButton(onClick = { packageManager.getLaunchIntentForPackage("com.termux")?.let { startActivity(it) } }) { Text("Open Termux") }
            }
            Text("2. Allow ‘Run commands in Termux’ in BashKitten’s Android permissions (Additional permissions), then connect.", style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }) { Text("App settings") }
                Button(enabled = !connecting, onClick = { connectTermux() }) { Text(if (connecting) "Connecting…" else "Connect") }
            }
        }
    }
    @Composable private fun Store() {
        PullToRefreshBox(isRefreshing = checking, onRefresh = { checkUpdates() }, modifier = Modifier.fillMaxSize()) {
            ScrollPage {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Your apps", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f))
                    TextButton(enabled = !checking && !jobActive(), onClick = { checkUpdates() }) { Text("Check for updates") }
                }
                AppStore.setupProblem(this@MainActivity)?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                val checkError = AppStore.prefs(this@MainActivity).getString("checkError", null)
                if (checkError != null) Text("Could not refresh apps. Pull down to retry.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                AppRow("com.bashkitten")
                Text("Your environment", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                AppRow("com.termux"); AppRow("com.termux.api"); AppRow("com.termux.x11")
                PackagesBlock()
                Text("Optional apps", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                for (id in AppStore.names.keys.drop(4)) AppRow(id)
            }
        }
    }
    @Composable private fun PackagesBlock() {
        val packages = status?.optJSONObject("packages")
        val sources = packages?.optJSONObject("sources")
        val job = packages?.optJSONObject("job")
        var logExpanded by remember { mutableStateOf(false) }
        var listExpanded by remember { mutableStateOf(false) }
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(20.dp)) {
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                TextButton(onClick = { packagesExpanded = !packagesExpanded }, contentPadding = PaddingValues(0.dp), modifier = Modifier.fillMaxWidth().semantics { contentDescription = if (packagesExpanded) "Collapse packages" else "Expand packages" }) {
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
                        Text("Packages", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                        Text("Termux · npm · Pi" + packages?.optJSONObject("runtime")?.optString("version")?.let { " $it" }.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(if (packagesExpanded) "⌃" else "⌄")
                }
                if (jobActive()) { Text(job!!.optString("phase"), style = MaterialTheme.typography.bodySmall); LinearProgressIndicator(Modifier.fillMaxWidth()) }
                if (packagesExpanded) {
                    if (packages == null) {
                        Text(if (setupActive) "Preparing your environment…" else "Connect to Termux to manage packages.", style = MaterialTheme.typography.bodySmall)
                        if (initialized()) TextButton(enabled = !setupActive, onClick = { startBootstrap() }) { Text("Resume setup") }
                        bootstrap?.optJSONObject("bootstrap")?.let { Text(it.optString("phase"), style = MaterialTheme.typography.bodySmall) }
                        bootstrap?.optString("logBase64")?.takeIf { it.isNotBlank() }?.let { OutputLog(runCatching { android.util.Base64.decode(it, android.util.Base64.DEFAULT).toString(Charsets.UTF_8) }.getOrDefault("")) }
                    } else {
                        Button(enabled = !jobActive(), onClick = { packageJob("update-packages"); logExpanded = true }) { Text("Update packages") }
                        for ((key, title) in listOf("apt" to "Termux", "npm" to "npm", "pi" to "Pi")) {
                            val source = sources?.optJSONObject(key)
                            val text = if (source?.has("error") == true) source.optString("error") else if (source == null) "Not checked" else if (key == "pi") { if (source.optBoolean("upstreamAvailable")) "${source.optString("installed")} → ${source.optString("latest")}" else "Up to date" } else "${source.optInt("available")} updates available"
                            Text("$title · $text", style = MaterialTheme.typography.bodySmall, color = if (source?.has("error") == true) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        TextButton(onClick = { listExpanded = !listExpanded; if (listExpanded) loadInventory() }, contentPadding = PaddingValues(0.dp)) { Text(if (listExpanded) "Hide installed packages ⌃" else "Installed packages ⌄") }
                        if (listExpanded) {
                            if (inventoryLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                            if (inventoryError.isNotBlank()) Text(inventoryError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                            inventory?.let { value ->
                                val rows = buildList {
                                    add("Pi" to value.optString("pi"))
                                    for (kind in listOf("apt", "npm")) value.optJSONArray(kind)?.let { array -> for (i in 0 until array.length()) { val item = array.getJSONObject(i); add("${item.getString("name")} · $kind" to item.getString("version")) } }
                                }
                                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 240.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { items(rows) { (name, version) -> Row { Text(name, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall); Text(version, style = MaterialTheme.typography.labelSmall) } } }
                                value.optString("npmError").takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                            }
                        }
                        if (job != null) {
                            TextButton(onClick = { logExpanded = !logExpanded }, contentPadding = PaddingValues(0.dp)) { Text((if (jobActive()) "Update output" else if (job.optString("status") == "complete") "Completed" else job.optString("phase")) + if (logExpanded) " ⌃" else " ⌄") }
                            job.optString("error").takeIf { it.isNotBlank() }?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                            if (logExpanded) OutputLog(job.optString("log").ifBlank { "Preparing…" })
                            if (jobActive()) TextButton(enabled = !job.optBoolean("cancelRequested"), onClick = { command("package-cancel") }) { Text(if (job.optBoolean("cancelRequested")) "Finishing current step…" else "Cancel after current step") }
                            if (job.optString("status") in setOf("failed", "interrupted", "cancelled")) TextButton(onClick = { command("package-job", JSONObject().put("retry", true)); logExpanded = true }) { Text("Retry") }
                        }
                    }
                }
            }
        }
    }
    @Composable private fun OutputLog(log: String) {
        val scroll = rememberScrollState()
        LaunchedEffect(log) { scroll.scrollTo(scroll.maxValue) }
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.background) {
            SelectionContainer { Text(log, Modifier.fillMaxWidth().heightIn(min = 100.dp, max = 240.dp).verticalScroll(scroll).padding(10.dp), style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace) }
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
        if (AppStore.externalTermux(this) || (companion != null && installed("com.termux.x11") == companion.optString("versionName"))) TextButton(enabled = !busy, onClick = {
            command("package-job", JSONObject().put("kind", "install-desktop").put("input", JSONObject().put("companionVersion", companion?.optString("companionVersion"))))
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
