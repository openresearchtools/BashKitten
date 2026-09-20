package com.bashkitten

import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.view.ViewGroup
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
import java.util.zip.ZipInputStream

/** Opt-in installed-package flow on a disposable suite device, with fixture credentials. */
@RunWith(AndroidJUnit4::class)
class WebFlowTest {
    private fun findWeb(view: View): WebView? = when (view) {
        is WebView -> view
        is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { findWeb(view.getChildAt(it)) }
        else -> null
    }
    @Test fun loginPickerAndDownload() {
        assumeNotNull(InstrumentationRegistry.getArguments().getString("installedWebFlow"))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp(); device.executeShellCommand("wm dismiss-keyguard")
        val name = "bashkitten-picker-${System.currentTimeMillis()}.png"
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES)
        }
        val image = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)!!
        val bitmap = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.rgb(220, 40, 60)) }
        context.contentResolver.openOutputStream(image)!!.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                assertTrue(device.wait(Until.hasObject(By.clazz(WebView::class.java)), 30000))
                fun js(script: String): String {
                    val done = CountDownLatch(1); var result = ""
                    scenario.onActivity { activity -> findWeb(activity.window.decorView)!!.evaluateJavascript(script) { result = it; done.countDown() } }
                    assertTrue(done.await(5, TimeUnit.SECONDS)); return result
                }
                fun until(script: String) {
                    for (attempt in 0 until 150) { if (js("Boolean($script)") == "true") return; Thread.sleep(200) }
                    fail("Web state did not become ready: $script; " + js("document.body.innerText"))
                }
                fun tap(selector: String) {
                    until("document.querySelector('$selector').getBoundingClientRect().height > 0")
                    val coordinates = JSONArray(js("(()=>{const r=document.querySelector('$selector').getBoundingClientRect();return [(r.x+r.width/2)*devicePixelRatio,(r.y+r.height/2)*devicePixelRatio]})()"))
                    var location = IntArray(2)
                    scenario.onActivity { findWeb(it.window.decorView)!!.getLocationOnScreen(location) }
                    device.click(location[0]+coordinates.getDouble(0).toInt(), location[1]+coordinates.getDouble(1).toInt())
                }
                until("!document.querySelector('#auth').classList.contains('hidden') || !document.querySelector('#app').classList.contains('hidden')")
                if (js("document.querySelector('#app').classList.contains('hidden')") == "true") {
                    js("document.querySelector('#username').value='tester';document.querySelector('#password').value='local-testing-password';document.querySelector('#authForm').requestSubmit()")
                }
                until("!document.querySelector('#app').classList.contains('hidden')")
                scenario.recreate()
                assertTrue(device.wait(Until.hasObject(By.clazz(WebView::class.java)), 30000))
                until("!document.querySelector('#app').classList.contains('hidden')")
                js("document.querySelector('#newBtn').click()")
                val viewport = js("JSON.stringify({innerHeight,innerWidth,dpr:devicePixelRatio,app:document.querySelector('#app').getBoundingClientRect().toJSON()})")
                instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "Viewport: $viewport\n") })
                until("document.querySelector('#app').getBoundingClientRect().height > 300")
                tap("#folderBtn")
                until("document.querySelector('#folderDialog').open && !document.querySelector('#folderUse').disabled")
                js("document.querySelector('#folderPath').value='~';document.querySelector('#folderGo').click()")
                until("document.querySelector('#folderUp').disabled && !document.querySelector('#folderUse').disabled")
                js("document.querySelector('#newFolderName').value='bashkitten-files-${System.currentTimeMillis()} 花';document.querySelector('#createFolder').click()")
                until("document.querySelector('#folderPath').value.includes('bashkitten-files-') && !document.querySelector('#folderUse').disabled")
                js("document.querySelector('#folderForm').requestSubmit()")
                until("!document.querySelector('#folderDialog').open")
                scenario.onActivity { activity -> (activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(activity.window.decorView.windowToken, 0) }
                tap("#attachBtn"); until("!document.querySelector('#composerActions').classList.contains('hidden')"); tap("#menuAttach")
                assertTrue("System picker did not open", device.wait(Until.hasObject(By.pkg("com.google.android.documentsui")), 5000) || device.wait(Until.hasObject(By.pkg("com.android.documentsui")), 5000))
                assertTrue("Fixture image not listed in the picker", device.wait(Until.hasObject(By.text(name)), 15000))
                device.findObject(By.text(name)).click()
                device.findObject(By.text("Open"))?.click()
                until("[...document.querySelectorAll('#attachmentTray .attachment')].some(item => item.title === '$name' && item.querySelector('img')?.naturalWidth === 32)")
                tap("#filesToggle"); until("!document.querySelector('#filePanel').classList.contains('hidden')")
                tap("#uploadRepo")
                assertTrue(device.wait(Until.hasObject(By.text(name)), 15000)); device.findObject(By.text(name)).click()
                device.findObject(By.text("Open"))?.click()
                until("document.querySelector('#fileTree').innerText.includes('$name')")
                tap("#downloadRepo")
                var zip: android.net.Uri? = null
                for (attempt in 0 until 100) {
                    context.contentResolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, arrayOf("_id", "_display_name", "is_pending"), null, null, "_id DESC")?.use { cursor ->
                        while (cursor.moveToNext()) if (cursor.getString(1).startsWith("bashkitten-files-") && cursor.getInt(2) == 0) { zip = android.content.ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cursor.getLong(0)); break }
                    }
                    if (zip != null) break; Thread.sleep(200)
                }
                assertNotNull("Repository ZIP was not saved", zip)
                val entries = mutableListOf<String>()
                ZipInputStream(context.contentResolver.openInputStream(zip!!)!!).use { stream -> while (true) { val entry = stream.nextEntry ?: break; entries.add(entry.name) } }
                assertTrue("ZIP does not contain the uploaded image: $entries", entries.any { it.endsWith(name) })
                device.takeScreenshot(File(context.getExternalFilesDir(null), "suite-files.png"))
            }
        } finally { context.contentResolver.delete(image, null, null) }
    }
}
