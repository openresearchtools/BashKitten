package com.bashkitten

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.os.Parcel
import android.util.Base64
import android.util.AtomicFile
import androidx.work.*
import org.json.JSONObject
import java.io.File
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.TimeUnit

/** Catalog metadata has its own key; it cannot authorize a different APK signing identity. */
object AppStore {
    const val certificate = "2f6a2ceae1a80e98b3a12156d37e7dc5541ce0968dd48285bc71bb555713df38"
    private const val catalogUrl = "https://github.com/openresearchtools/termux-suite/releases/download/catalog/catalog.json"
    val names = linkedMapOf("com.termux" to "Termux", "com.termux.api" to "Termux:API", "com.bashkitten" to "BashKitten", "com.termux.x11" to "Termux:X11", "com.termux.boot" to "Termux:Boot", "com.termux.widget" to "Termux:Widget", "com.termux.styling" to "Termux:Styling", "com.termux.window" to "Termux:Float", "com.termux.tasker" to "Termux:Tasker")
    fun prefs(context: Context) = context.getSharedPreferences("store", Context.MODE_PRIVATE)
    fun installed(context: Context, id: String) = runCatching { context.packageManager.getPackageInfo(id, PackageManager.GET_SIGNING_CERTIFICATES) }.getOrNull()
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun signer(info: android.content.pm.PackageInfo) = info.signingInfo?.apkContentsSigners?.singleOrNull()?.toByteArray()?.let { digest(it) }
    fun variant(context: Context) = prefs(context).getString("x11Variant", "standalone")!!
    fun entries(context: Context): List<JSONObject> = runCatching {
        val catalog = verify(context, AtomicFile(File(context.filesDir, "catalog.json")).readFully(), false)
        val apps = catalog.getJSONArray("apps")
        (0 until apps.length()).map { apps.getJSONObject(it) }
    }.getOrDefault(emptyList())

    fun keyringChecksum(context: Context): String {
        val catalog = verify(context, AtomicFile(File(context.filesDir, "catalog.json")).readFully(), false)
        val hash = catalog.getJSONObject("bootstrap").getString("keyringSha256")
        check(hash.matches(Regex("[a-f0-9]{64}"))) { "Invalid keyring checksum" }
        return hash
    }
    private fun verify(context: Context, bytes: ByteArray, advance: Boolean): JSONObject {
        val envelope = JSONObject(bytes.toString(Charsets.UTF_8))
        val payload = Base64.decode(envelope.getString("payload"), Base64.NO_WRAP)
        val publicPem = context.assets.open("catalog-public-key.pem").bufferedReader().use { it.readText() }
        val publicBytes = Base64.decode(publicPem.replace(Regex("-----[^-]+-----|\\s"), ""), Base64.DEFAULT)
        val verifier = Signature.getInstance("SHA256withRSA")
        verifier.initVerify(KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(publicBytes)))
        verifier.update(payload)
        check(verifier.verify(Base64.decode(envelope.getString("signature"), Base64.NO_WRAP))) { "Catalog signature is invalid" }
        val value = JSONObject(payload.toString(Charsets.UTF_8))
        check(value.getInt("schema") == 1) { "Update BashKitten to read this catalog" }
        val now = System.currentTimeMillis() / 1000
        check(value.getLong("issuedAt") <= now + 300 && value.getLong("expiresAt") > now) { "Catalog has expired; check updates when online" }
        check(value.getLong("expiresAt") - value.getLong("issuedAt") in 1..1209600) { "Invalid catalog validity period" }
        val pref = prefs(context); val sequence = value.getLong("sequence"); val hash = digest(payload)
        check(sequence >= pref.getLong("sequence", 0)) { "Refusing an older catalog" }
        if (sequence == pref.getLong("sequence", 0)) check(hash == pref.getString("catalogHash", hash)) { "Catalog sequence was reused" }
        val apps = value.getJSONArray("apps"); val identities = mutableSetOf<String>()
        for (i in 0 until apps.length()) {
            val app = apps.getJSONObject(i); val id = app.getString("packageId")
            check(id in names && app.getString("certificateSha256").replace(":", "").lowercase() == certificate) { "Unexpected app identity" }
            check(app.getString("abi") == "arm64-v8a" && app.getLong("versionCode") in 1..2100000000) { "Unsupported app build" }
            check(app.getString("sha256").matches(Regex("[a-f0-9]{64}")) && app.getLong("size") in 1..536870912) { "Invalid app checksum or size" }
            check(identities.add(id + ":" + app.optString("variant"))) { "Duplicate catalog entry" }
            releaseUrl(app.getString("url")); releaseUrl(app.getString("sourceUrl"))
        }
        if (advance) pref.edit().putLong("sequence", sequence).putString("catalogHash", hash).apply()
        return value
    }
    private fun releaseUrl(value: String) {
        val uri = URL(value)
        check(uri.protocol == "https" && uri.host == "github.com" && uri.userInfo == null && uri.port == -1 &&
            (uri.path.startsWith("/openresearchtools/bashkitten/releases/download/") || uri.path.startsWith("/openresearchtools/termux-suite/releases/download/"))) { "Unexpected release URL" }
    }
    private fun connection(address: String): HttpURLConnection {
        var url = URL(address)
        repeat(5) {
            check(url.protocol == "https" && url.host in setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com") && url.userInfo == null && url.port == -1) { "Unsafe download redirect" }
            val connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = 15000; connection.readTimeout = 60000; connection.instanceFollowRedirects = false
            if (connection.responseCode in 300..399) {
                val next = connection.getHeaderField("Location") ?: error("Missing download location")
                connection.disconnect(); url = URL(url, next)
            } else {
                check(connection.responseCode == 200) { "Download failed (${connection.responseCode})" }
                return connection
            }
        }
        error("Too many download redirects")
    }
    @Synchronized fun check(context: Context) {
        try {
            val connection = connection(catalogUrl)
            val bytes = try { connection.inputStream.use { input ->
                val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
                while (true) { val count = input.read(buffer); if (count < 0) break; check(output.size() + count <= 1048576) { "Catalog is too large" }; output.write(buffer, 0, count) }
                output.toByteArray()
            } } finally { connection.disconnect() }
            check(bytes.size <= 1048576) { "Catalog is too large" }; verify(context, bytes, false)
            val file = AtomicFile(File(context.filesDir, "catalog.json")); val out = file.startWrite()
            try { out.write(bytes); file.finishWrite(out) } catch (error: Exception) { file.failWrite(out); throw error }
            verify(context, bytes, true)
            prefs(context).edit().putLong("checkedAt", System.currentTimeMillis()).remove("checkError").apply()
        } catch (error: Exception) {
            prefs(context).edit().putString("checkError", error.message ?: "Catalog check failed").apply(); throw error
        }
    }
    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<CatalogWorker>(6, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("catalog", ExistingPeriodicWorkPolicy.KEEP, request)
    }
    fun install(context: Context, entry: JSONObject) {
        val id = entry.getString("packageId")
        check(entries(context).any { it.toString() == entry.toString() }) { "Catalog changed or expired; check updates again" }
        check("arm64-v8a" in Build.SUPPORTED_ABIS && Build.VERSION.SDK_INT >= entry.getInt("minSdk")) { "This device is not supported" }
        val current = installed(context, id)
        if (current != null) {
            check(signer(current) == certificate) { "This app uses another signing certificate. Back up its data before migrating." }
            check(current.longVersionCode < entry.getLong("versionCode")) { "This version is already installed" }
        }
        val apk = File(context.cacheDir, "$id.apk.part")
        prefs(context).edit().putString("state:$id", "Downloading…").apply()
        try {
            val connection = connection(entry.getString("url")); val expected = entry.getLong("size")
            check(context.cacheDir.usableSpace > expected * 2 + 33554432) { "Not enough space to download and install" }
            val sha = MessageDigest.getInstance("SHA-256"); var total = 0L; var lastPercent = -1
            try { connection.inputStream.use { input -> apk.outputStream().use { output ->
                val buffer = ByteArray(65536)
                while (true) {
                    val count = input.read(buffer); if (count < 0) break
                    total += count; check(total <= expected) { "Download exceeds its signed size" }
                    sha.update(buffer, 0, count); output.write(buffer, 0, count)
                    val percent = (total * 100 / expected).toInt()
                    if (percent != lastPercent) { prefs(context).edit().putString("state:$id", "Downloading $percent%").apply(); lastPercent = percent }
                }
            } } } finally { connection.disconnect() }
            check(total == expected && sha.digest().joinToString("") { "%02x".format(it) } == entry.getString("sha256")) { "APK checksum mismatch" }
            val archive = context.packageManager.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: error("Invalid APK")
            check(archive.packageName == id && archive.longVersionCode == entry.getLong("versionCode") && archive.versionName == entry.getString("versionName") && signer(archive) == certificate) { "APK identity does not match the catalog" }
            check(archive.applicationInfo?.flags?.and(android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) { "Refusing a debug APK" }
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(id); setSize(total)
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                if (Build.VERSION.SDK_INT >= 34) setRequestUpdateOwnership(true)
            }
            val installer = context.packageManager.packageInstaller; val sessionId = installer.createSession(params)
            try { installer.openSession(sessionId).use { session ->
                session.openWrite("base.apk", 0, total).use { output -> apk.inputStream().use { it.copyTo(output) }; session.fsync(output) }
                val callback = Intent(context, InstallResultReceiver::class.java).setAction("com.bashkitten.INSTALL.$sessionId").putExtra("packageId", id)
                val pending = PendingIntent.getBroadcast(context, sessionId, callback, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                prefs(context).edit().putString("state:$id", "Installing…").apply()
                session.commit(pending.intentSender)
            } } catch (error: Exception) { installer.abandonSession(sessionId); throw error }
        } catch (error: Exception) {
            prefs(context).edit().putString("state:$id", "Failed · " + error.message).apply(); throw error
        } finally { apk.delete() }
    }
    fun confirmation(context: Context): Intent? {
        val saved = prefs(context).getString("confirmation", null) ?: return null
        return runCatching {
            val parcel = Parcel.obtain()
            try { val bytes = Base64.decode(saved, Base64.NO_WRAP); parcel.unmarshall(bytes, 0, bytes.size); parcel.setDataPosition(0); Intent.CREATOR.createFromParcel(parcel) } finally { parcel.recycle() }
        }.getOrNull()
    }
}

class CatalogWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = runCatching { AppStore.check(applicationContext); Result.success() }.getOrElse { Result.retry() }
}
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("packageId") ?: return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val pref = AppStore.prefs(context).edit()
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            val confirmation = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
            if (confirmation != null) {
                val parcel = Parcel.obtain()
                try { confirmation.writeToParcel(parcel, 0); pref.putString("confirmation", Base64.encodeToString(parcel.marshall(), Base64.NO_WRAP)) } finally { parcel.recycle() }
                pref.putString("state:$id", "Confirm installation in Android")
            }
        } else {
            pref.remove("confirmation").putString("state:$id", if (status == PackageInstaller.STATUS_SUCCESS) "Installed" else "Failed · " + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty().take(400))
        }
        pref.apply()
    }
}
