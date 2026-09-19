// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard.probe;

import android.content.*;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.openresearchtools.wildbuzzard.probe.UiNavigation.click;
import static org.openresearchtools.wildbuzzard.probe.UiNavigation.scrollToAndClick;

/** Runs the browser APK's actual shell entry point under the independent probe UID. */
@RunWith(AndroidJUnit4.class)
public final class CommandBrowserTest {
    Context context;
    File state;
    String apk;
    static final class Result {
        final int exit; final String output;
        Result(int exit, String output) { this.exit = exit; this.output = output; }
    }
    Result run(String... args) throws Exception {
        ArrayList<String> command = new ArrayList<>(Arrays.asList("/system/bin/app_process", "/",
            "org.openresearchtools.wildbuzzard.BrowserCommand", "--state-dir", state.getAbsolutePath(), "--no-launch"));
        command.addAll(Arrays.asList(args));
        ProcessBuilder builder = new ProcessBuilder(command).redirectErrorStream(true);
        builder.environment().put("CLASSPATH", apk);
        builder.environment().remove("LD_PRELOAD"); builder.environment().remove("LD_LIBRARY_PATH");
        File output = new File(state, "command-output"); builder.redirectOutput(output);
        Process process = builder.start();
        assertTrue("Shell command completes", process.waitFor(45, TimeUnit.SECONDS));
        return new Result(process.exitValue(), new String(Files.readAllBytes(output.toPath()), StandardCharsets.UTF_8));
    }
    Object call(String method, JSONObject params) throws Exception {
        Result result = run(method, params.toString());
        assertEquals(result.output, 0, result.exit);
        return new JSONObject(result.output).get("result");
    }
    JSONObject tab(String id) throws Exception { return new JSONObject().put("tabId", id); }
    @Test public void shellProgramsControlBrowserWithoutCompanionRuntime() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        state = new File(context.getFilesDir(), "command-test-" + UUID.randomUUID()); assertTrue(state.mkdir());
        apk = context.getPackageManager().getApplicationInfo("org.openresearchtools.wildbuzzard", 0).sourceDir;
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        StringBuilder key = new StringBuilder(); for (byte value : bytes) key.append(String.format(Locale.ROOT, "%02x", value & 255));
        Path file = new File(state, "command-key").toPath(); Files.write(file, key.toString().getBytes(StandardCharsets.US_ASCII));
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
        assertTrue("Unapproved command key is denied", run("capabilities").exit != 0);
        context.startActivity(new Intent().setClassName("org.openresearchtools.wildbuzzard", "org.openresearchtools.wildbuzzard.CommandAccessActivity")
            .putExtra("key", key.toString()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        assertTrue(device.wait(Until.hasObject(By.text("Allow command-line browser control?")), 15000));
        click(device, "Allow");
        long deadline = SystemClock.elapsedRealtime() + 15000;
        Result ready;
        do { ready = run("capabilities"); if (ready.exit == 0) break; SystemClock.sleep(150); }
        while (SystemClock.elapsedRealtime() < deadline);
        assertEquals(ready.output, 0, ready.exit);
        assertTrue(ready.output.contains("tabs.show"));
        Result notices = run("--licenses"); assertEquals(notices.output, 0, notices.exit);
        assertTrue("CLI includes product and dependency notices", notices.output.contains("Wild Buzzard")
            && notices.output.contains("BrowserOS") && notices.output.contains("Android dependencies from this APK")
            && !notices.output.contains("Debug License Info"));
        String first = ((JSONObject) call("tabs.create", new JSONObject().put("url", "http://127.0.0.1:8765/"))).getString("id");
        String second = ((JSONObject) call("tabs.create", new JSONObject())).getString("id");
        JSONObject waited = (JSONObject) call("wait", tab(first).put("for", "selector").put("value", "#name").put("timeout", 10000));
        assertTrue("Shell command reaches real Gecko", waited.getBoolean("matched"));
        JSONObject evaluated = (JSONObject) call("evaluate", tab(first).put("code", "return document.querySelector('h1').textContent;"));
        assertTrue(evaluated.getString("value").contains("Agent test page"));
        call("tabs.close", tab(second));
        String listed = call("tabs.list", new JSONObject()).toString();
        assertTrue(listed.contains(first)); assertFalse(listed.contains(second));
        assertTrue("Unknown tab cannot be closed by CLI", run("tabs.close", tab("not-owned").toString()).exit != 0);
        if (ProbeActivity.active != null && ProbeActivity.connected) {
            assertFalse("Binder identity cannot see shell-key tabs", ProbeActivity.active.command("tabs.list", new JSONObject()).toString().contains(first));
        }
        JSONObject launch = (JSONObject) call("tabs.show", tab(first));
        context.startActivity(new Intent().setClassName("org.openresearchtools.wildbuzzard", "org.openresearchtools.wildbuzzard.CommandAccessActivity")
            .putExtra("launch", launch.getString("launch")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        assertNotNull(device.wait(Until.findObject(By.desc("More options")), 15000));
        JSONObject screenshot = (JSONObject) call("screenshot", tab(first));
        assertFixturePixels(android.util.Base64.decode(screenshot.getString("base64"), android.util.Base64.DEFAULT));
        UiObject2 counter = device.findObject(By.descStartsWith("Non-private Tabs Open:"));
        assertNotNull(counter); counter.click();
        assertTrue(device.wait(Until.hasObject(By.desc("Page preview")), 15000));
        SystemClock.sleep(1000);
        String thumbnail = device.executeShellCommand("run-as org.openresearchtools.wildbuzzard cat no_backup/mozac_browser_thumbnails/thumbnails/" + first + ".0 | base64");
        assertFixturePixels(android.util.Base64.decode(thumbnail, android.util.Base64.DEFAULT));
        device.pressBack();
        UiObject2 menu = device.wait(Until.findObject(By.desc("More options")), 15000); assertNotNull(menu); menu.click();
        scrollToAndClick(device, "Settings");
        scrollToAndClick(device, "Revoke agent access");
        assertTrue("Revocation disables the saved shell key", run("tabs.list").exit != 0);
        android.util.Log.i("WildBuzzardProbe", "PASS: browser-owned shell entry, real page access, tab isolation, closure, and revocation");
        device.pressBack();
    }
    void assertFixturePixels(byte[] encoded) {
        android.graphics.Bitmap bitmap = android.graphics.BitmapFactory.decodeByteArray(encoded, 0, encoded.length);
        assertNotNull("Page image decodes", bitmap);
        int light = 0, dark = 0, total = 0;
        for (int y = 4; y < bitmap.getHeight(); y += 8) {
            for (int x = 4; x < bitmap.getWidth(); x += 8) {
                int color = bitmap.getPixel(x, y);
                if (android.graphics.Color.red(color) > 220 && android.graphics.Color.green(color) > 220 && android.graphics.Color.blue(color) > 220) light++;
                if (android.graphics.Color.red(color) < 80 && android.graphics.Color.green(color) < 80 && android.graphics.Color.blue(color) < 80) dark++;
                total++;
            }
        }
        bitmap.recycle();
        assertTrue("White fixture page is actually captured, not a black placeholder", light > total / 2);
        assertTrue("Captured page includes its dark text and controls", dark > total / 100);
    }

}
