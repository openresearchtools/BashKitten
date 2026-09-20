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
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Runs on a disposable primary-user Cuttlefish image with the suite candidates. */
@RunWith(AndroidJUnit4::class)
class SuiteIntegrationTest {
    @Test fun protectedSetupAndCommand() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        assertTrue(TermuxBridge.trusted(context))
        assertEquals(PackageManager.PERMISSION_GRANTED, context.packageManager.checkPermission("com.termux.permission.RUN_TRUSTED_COMMAND", context.packageName))
        ActivityScenario.launch(MainActivity::class.java).use {
            device.wait(Until.hasObject(By.text("Apps and services")), 15000)
            UiScrollable(UiSelector().scrollable(true)).scrollTextIntoView("Initialize Termux")
            device.findObject(By.text("Initialize Termux")).click()
            assertTrue("Setup did not return to BashKitten", device.wait(Until.hasObject(By.pkg("com.bashkitten")), 120000))
            val done = CountDownLatch(1); var result: Result<JSONObject>? = null
            instrumentation.runOnMainSync {
                TermuxBridge.execute(context, TermuxBridge.prefix + "/bin/bash", arrayOf("-c", "printf '{\"platform\":\"termux\",\"home\":\"%s\"}\\n' \"\$HOME\""), null) { result = it; done.countDown() }
            }
            assertTrue("Protected command timed out", done.await(60, TimeUnit.SECONDS))
            val reply = result!!.getOrThrow()
            assertEquals("termux", reply.getString("platform"))
            assertEquals("/data/data/com.termux/files/home", reply.getString("home"))
            val output = File(context.getExternalFilesDir(null), "suite-control.png")
            device.takeScreenshot(output)
        }
    }
}
