package com.bashkitten

import android.view.View
import android.view.ViewGroup
import android.view.inspector.WindowInspector
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Assume.assumeNotNull
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real Pi browser-login launch, cancelled before authorizing a provider account. */
@RunWith(AndroidJUnit4::class)
class LoginFlowTest {
    private fun webs(view: View): List<WebView> = when (view) {
        is WebView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { webs(view.getChildAt(it)) }
        else -> emptyList()
    }
    @Test fun externalProviderBrowser() {
        assumeNotNull(InstrumentationRegistry.getArguments().getString("nativeLogin"))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp(); device.executeShellCommand("wm dismiss-keyguard")
        ActivityScenario.launch(MainActivity::class.java).use {
            assertTrue(device.wait(Until.hasObject(By.clazz(WebView::class.java)), 30000))
            fun view(helper: Boolean): WebView? {
                var value: WebView? = null
                instrumentation.runOnMainSync {
                    value = WindowInspector.getGlobalWindowViews().flatMap { webs(it) }.firstOrNull { (it.url?.contains("/pi-login") == true) == helper }
                }
                return value
            }
            fun js(script: String, helper: Boolean = false): String {
                val done = CountDownLatch(1); var result = ""
                instrumentation.runOnMainSync { view(helper)!!.evaluateJavascript(script) { result = it; done.countDown() } }
                assertTrue(done.await(10, TimeUnit.SECONDS)); return result
            }
            fun until(script: String, helper: Boolean = false) {
                for (attempt in 0 until 100) {
                    if (view(helper) != null && js("Boolean($script)", helper) == "true") return
                    Thread.sleep(200)
                }
                fail("Login state did not become ready: $script")
            }
            fun tap(selector: String, helper: Boolean = false) {
                until("document.querySelector('$selector')?.getBoundingClientRect().height > 0", helper)
                val xy = JSONArray(js("(()=>{const r=document.querySelector('$selector').getBoundingClientRect();return [(r.x+r.width/2)*devicePixelRatio,(r.y+r.height/2)*devicePixelRatio]})()", helper))
                val location = IntArray(2)
                instrumentation.runOnMainSync { view(helper)!!.getLocationOnScreen(location) }
                device.click(location[0]+xy.getDouble(0).toInt(), location[1]+xy.getDouble(1).toInt())
            }
            until("document.querySelector('#app')?.classList.contains('hidden') === false")
            js("document.querySelector('#settingsBtn').click();document.querySelector('#tabServices').click()")
            until("document.querySelectorAll('#servicesList button').length > 0")
            js("document.querySelector('#serviceFilter').value='openai-codex';document.querySelector('#serviceFilter').dispatchEvent(new Event('input'))")
            tap("#servicesList .service-row button")
            until("document.querySelector('#loginInput')", true)
            assertEquals("\"undefined\"", js("typeof window.bashkittenHost", true))
            js("document.querySelector('#loginInput').value='browser'", true)
            tap("#steps button", true)
            until("document.querySelector('#steps a[target]')", true)
            assertEquals("\"auth.openai.com\"", js("new URL(document.querySelector('#steps a[target]').href).hostname", true))
            tap("#steps a[target]", true)
            assertTrue("Provider did not open in Android's browser", device.wait(Until.hasObject(By.pkg("org.chromium.chrome")), 15000))
            device.takeScreenshot(File(context.getExternalFilesDir(null), "suite-provider-browser.png"))
            device.pressBack()
            until("document.querySelector('#cancel')", true)
            tap("#cancel", true)
            until("document.querySelector('#cancel').hidden", true)
            instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "PASS: authenticated Pi helper opens native Android browser; account authorization cancelled\n") })
        }
    }
}
