package com.bashkitten

import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiScrollable
import androidx.test.uiautomator.UiSelector
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.Assume.assumeNotNull
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Runs on a disposable primary-user Cuttlefish image with the suite candidates. */
@RunWith(AndroidJUnit4::class)
class SuiteIntegrationTest {
    /** Test-only candidate provisioning through the same protected IPC as the product. */
    @Test fun candidateCommand() {
        val encoded = InstrumentationRegistry.getArguments().getString("candidateCommand")
        assumeNotNull(encoded)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp(); device.executeShellCommand("wm dismiss-keyguard")
        val script = android.util.Base64.decode(encoded, android.util.Base64.DEFAULT).toString(Charsets.UTF_8)
        ActivityScenario.launch(MainActivity::class.java).use {
            assertTrue(device.wait(Until.hasObject(By.pkg("com.bashkitten")), 15000))
            val done = CountDownLatch(1); var result: Result<JSONObject>? = null
            instrumentation.runOnMainSync {
                TermuxBridge.execute(context, TermuxBridge.prefix + "/bin/bash", arrayOf("-c", script), null, 1800000) { result = it; done.countDown() }
            }
            assertTrue("Candidate command timed out", done.await(30, TimeUnit.MINUTES))
            println("Candidate result: " + result!!.getOrThrow().toString())
            device.takeScreenshot(File(context.getExternalFilesDir(null), "suite-candidate.png"))
        }
    }
    @Test fun protectedSetupAndCommand() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp()
        device.executeShellCommand("wm dismiss-keyguard")
        device.executeShellCommand("svc power stayon true")
        assertTrue(TermuxBridge.trusted(context))
        assertEquals(PackageManager.PERMISSION_GRANTED, context.packageManager.checkPermission("com.termux.permission.RUN_TRUSTED_COMMAND", context.packageName))
        ActivityScenario.launch(MainActivity::class.java).use {
            assertTrue(device.wait(Until.hasObject(By.text("Apps and services")), 15000))
            UiScrollable(UiSelector().scrollable(true)).scrollTextIntoView("Initialize Termux")
            device.findObject(By.text("Initialize Termux")).click()
            device.wait(Until.gone(By.pkg("com.bashkitten")), 5000)
            assertTrue("Setup did not return to BashKitten", device.wait(Until.hasObject(By.pkg("com.bashkitten")), 120000))
            val done = CountDownLatch(1); var result: Result<JSONObject>? = null
            instrumentation.runOnMainSync {
                TermuxBridge.execute(context, TermuxBridge.prefix + "/bin/bash", arrayOf("-c", "printf '{\"platform\":\"termux\",\"home\":\"%s\"}\\n' \"\$HOME\""), null) { result = it; done.countDown() }
            }
            assertTrue("Protected command timed out", done.await(60, TimeUnit.SECONDS))
            val reply = result!!.getOrThrow()
            assertEquals("termux", reply.getString("platform"))
            assertEquals("/data/data/com.termux/files/home", reply.getString("home"))
            val failed = CountDownLatch(1); var failure: Result<JSONObject>? = null
            instrumentation.runOnMainSync {
                TermuxBridge.execute(context, TermuxBridge.prefix + "/bin/bash", arrayOf("-c", "printf 'expected failure' >&2; exit 7"), null) { failure = it; failed.countDown() }
            }
            assertTrue(failed.await(60, TimeUnit.SECONDS))
            assertEquals("expected failure", failure!!.exceptionOrNull()?.message)
            val output = File(context.getExternalFilesDir(null), "suite-control.png")
            device.takeScreenshot(output)
        }
    }
}
