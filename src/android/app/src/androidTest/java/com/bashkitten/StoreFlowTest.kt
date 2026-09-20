package com.bashkitten

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.util.AtomicFile
import android.util.Base64
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Assume.assumeNotNull
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A signed prerelease catalog may be seeded only by this separate test APK.
 * All verification, HTTPS APK download and PackageInstaller work use production code.
 */
@RunWith(AndroidJUnit4::class)
class StoreFlowTest {
    @Test fun signedCatalogInstall() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val catalog = args.getString("storeCatalog")
        assumeNotNull(catalog)
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        val file = AtomicFile(File(context.filesDir, "catalog.json"))
        val output = file.startWrite()
        try { output.write(Base64.decode(catalog, Base64.NO_WRAP)); file.finishWrite(output) }
        catch (error: Exception) { file.failWrite(output); throw error }
        val id = args.getString("storePackage") ?: "com.termux.api"
        if (args.getString("clearCandidateSession") == "true") {
            context.packageManager.packageInstaller.mySessions.filter { it.appPackageName == id }.forEach { context.packageManager.packageInstaller.abandonSession(it.sessionId) }
            AppStore.prefs(context).edit().putString("state:$id", "Failed · Previous test interrupted").remove("confirmation").remove("installSession:$id").apply()
        }
        val variant = args.getString("storeVariant")
        val entry = AppStore.entries(context).single { it.getString("packageId") == id && (variant == null || it.optString("variant") == variant) }
        val expected = entry.getLong("versionCode")
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            if (args.getString("replaceX11Variant") == "true") {
                assertEquals("com.termux.x11", id)
                val stopped = CountDownLatch(1); var stop: Result<org.json.JSONObject>? = null
                TermuxBridge.command(context, "desktop-stop") { stop = it; stopped.countDown() }
                assertTrue(stopped.await(50, TimeUnit.SECONDS)); stop!!.getOrThrow()
                AppStore.prefs(context).edit().putString("x11Variant", variant).apply()
                scenario.onActivity { it.startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:com.termux.x11"))) }
                assertTrue(device.wait(Until.hasObject(By.res("android:id/button1")), 10000))
                device.findObject(By.res("android:id/button1")).click()
                for (attempt in 0 until 30) { if (AppStore.installed(context, id) == null) break; Thread.sleep(500) }
                assertNull("Only the X11 viewer should be removed", AppStore.installed(context, id))
                assertNotNull(AppStore.installed(context, "com.termux"))
            }
            assertTrue("Use an older installed candidate for this update test", (AppStore.installed(context, id)?.longVersionCode ?: 0) < expected)
            if (!context.packageManager.canRequestPackageInstalls()) {
                scenario.onActivity { it.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))) }
                assertTrue(device.wait(Until.hasObject(By.checkable(true)), 10000))
                val toggle = device.findObject(By.checkable(true))
                if (!toggle.isChecked) toggle.click()
                device.pressBack()
                assertTrue(context.packageManager.canRequestPackageInstalls())
            }
            Thread.sleep(2000)
            AppStore.install(context, entry)
            for (attempt in 0 until 180) {
                if ((AppStore.installed(context, id)?.longVersionCode ?: 0) >= expected) break
                AppStore.confirmation(context)?.let { intent ->
                    scenario.onActivity { it.startIntentSender(intent.intentSender, null, 0, 0, 0) }
                    if (device.wait(Until.hasObject(By.res("android:id/button1")), 5000)) device.findObject(By.res("android:id/button1")).click()
                }
                Thread.sleep(1000)
            }
            assertEquals(expected, AppStore.installed(context, id)!!.longVersionCode)
            if (variant != null) {
                @Suppress("DEPRECATION") val shared = AppStore.installed(context, id)!!.sharedUserId == "com.termux"
                assertEquals(variant == "sharedUid", shared)
            }
            AppStore.reconcile(context)
            if (id != "com.bashkitten") {
                var recovered = false
                for (attempt in 0 until 30) {
                    val done = CountDownLatch(1)
                    TermuxBridge.command(context, "status") { result ->
                        recovered = result.getOrNull()?.let { it.isNull("appUpdate") && it.optJSONObject("web")?.optString("status") == "running" } == true
                        done.countDown()
                    }
                    assertTrue(done.await(50, TimeUnit.SECONDS))
                    if (recovered) break
                    Thread.sleep(1000)
                }
                assertTrue("Services did not recover after the Android installation", recovered)
            }
            instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "Installed verified $id versionCode=$expected through PackageInstaller\n") })
        }
    }
}
