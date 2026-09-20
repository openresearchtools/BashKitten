package com.bashkitten

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
import org.junit.Assume.assumeNotNull
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Test APK only: the host preserves the external Termux installation and its data. */
@RunWith(AndroidJUnit4::class)
class ExternalTermuxTest {
    @Test fun externalSourceAndConnection() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeNotNull(InstrumentationRegistry.getArguments().getString("externalTermux"))
        val context = instrumentation.targetContext
        assertTrue(AppStore.externalTermux(context))
        assertFalse(TermuxBridge.trusted(context))
        assertTrue(AppStore.canInstall(context, "com.bashkitten"))
        for (id in AppStore.names.keys.filter { it != "com.bashkitten" }) {
            assertFalse("Must not mix suite APKs into external Termux: $id", AppStore.canInstall(context, id))
            assertThrows(IllegalStateException::class.java) { AppStore.enqueueInstall(context, JSONObject().put("packageId", id)) }
        }
        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp(); device.executeShellCommand("wm dismiss-keyguard")
        ActivityScenario.launch(MainActivity::class.java).use {
            assertTrue(device.wait(Until.hasObject(By.text("Your apps")), 15000))
            UiScrollable(UiSelector().scrollable(true)).scrollTextIntoView("Termux:X11")
            if (AppStore.installed(context, "com.termux.x11") == null) assertTrue(device.hasObject(By.text("Missing")))
            assertFalse(device.hasObject(By.textContains("Type ·")))
            device.takeScreenshot(File(context.getExternalFilesDir(null), "external-termux-store.png"))
            if (InstrumentationRegistry.getArguments().getString("connected") == "true") {
                assertTrue(TermuxBridge.available(context))
                val done = CountDownLatch(1); var reply: Result<JSONObject>? = null
                instrumentation.runOnMainSync { TermuxBridge.probe(context) { reply = it; done.countDown() } }
                assertTrue(done.await(20, TimeUnit.SECONDS))
                assertTrue(reply!!.getOrThrow().getBoolean("connected"))
            }
        }
    }
}
