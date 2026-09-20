package com.bashkitten

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
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

@RunWith(AndroidJUnit4::class)
class NavigationTest {
    @Test fun storeAndUpdatesReturnToTheSameChat() {
        assumeNotNull(InstrumentationRegistry.getArguments().getString("navigation"))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp(); device.executeShellCommand("wm dismiss-keyguard")
        fun find(view: View): WebView? = when (view) {
            is WebView -> view
            is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { find(view.getChildAt(it)) }
            else -> null
        }
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            fun js(script: String): String {
                val done = CountDownLatch(1); var result = ""
                scenario.onActivity { activity -> find(activity.window.decorView)!!.evaluateJavascript(script) { result = it; done.countDown() } }
                assertTrue(done.await(5, TimeUnit.SECONDS)); return result
            }
            for (i in 0 until 150) {
                if (js("document.querySelector('#app')?.classList.contains('hidden') === false && location.hash.startsWith('#session=')") == "true") break
                Thread.sleep(200)
            }
            assertEquals("true", js("document.querySelector('#app')?.classList.contains('hidden') === false"))
            val url = js("location.href")
            js("window.navigationProof='same-document';document.querySelector('#prompt').value='unsent navigation draft'")
            device.findObject(By.desc("Menu")).click()
            assertTrue(device.wait(Until.hasObject(By.text("Apps")), 5000))
            device.findObject(By.text("Apps")).click()
            assertTrue(device.wait(Until.hasObject(By.text("Your apps")), 5000))
            assertNotNull(device.findObject(By.text("Essential")))
            device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null), "store-redesign.png"))
            device.pressBack()
            assertTrue(device.wait(Until.gone(By.text("Your apps")), 5000))
            assertEquals("\"same-document\"", js("window.navigationProof"))
            assertEquals(url, js("location.href"))
            assertEquals("\"unsent navigation draft\"", js("document.querySelector('#prompt').value"))
            device.findObject(By.desc("Menu")).click()
            device.findObject(By.text("Package updates")).click()
            assertTrue(device.wait(Until.hasObject(By.text("Keep everything up to date")), 5000))
            assertNotNull(device.findObject(By.text("npm packages")))
            assertNull(device.findObject(By.text("Not installed")))
            device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null), "updates-redesign.png"))
            device.findObject(By.desc("Back to chat")).click()
            assertEquals("\"same-document\"", js("window.navigationProof"))
            js("document.querySelector('#prompt').value=''")
        }
    }
}
