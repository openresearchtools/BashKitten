package com.bashkitten

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class AboutTest {
    @Test fun bundledNoticesOpenOfflineAndBackPreservesTheApp() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val entries = JSONArray(instrumentation.targetContext.assets.open("licenses.json").bufferedReader().use { it.readText() })
        assertTrue(entries.length() > 20)
        for (i in 0 until entries.length()) assertTrue(entries.getJSONObject(i).getString("text").length > 200)
        assertTrue((0 until entries.length()).any { entries.getJSONObject(it).getString("name").startsWith("androidx.") })
        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp(); device.executeShellCommand("wm dismiss-keyguard")
        ActivityScenario.launch(MainActivity::class.java).use {
            assertTrue(device.wait(Until.hasObject(By.desc("Menu")), 10000))
            device.findObject(By.desc("Menu")).click()
            val about = device.wait(Until.findObject(By.text("About")), 10000)
            assertNotNull("About must remain available while the backend connects", about)
            about!!.click()
            assertTrue(device.wait(Until.hasObject(By.textContains("Termux and Node.js are installed separately")), 5000))
            device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null), "about.png"))
            device.findObject(By.text("Licenses")).click()
            assertTrue(device.wait(Until.hasObject(By.text("BashKitten")), 10000))
            device.findObject(By.text("BashKitten")).click()
            assertTrue(device.wait(Until.hasObject(By.textContains("GNU GENERAL PUBLIC LICENSE")), 5000))
            device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null), "license.png"))
            device.pressBack()
            assertTrue(device.wait(Until.hasObject(By.text("Termux app icons")), 5000) || device.hasObject(By.textContains("androidx.")))
            device.pressBack()
            assertTrue(device.wait(Until.hasObject(By.text("Source code")), 5000))
        }
    }
}
