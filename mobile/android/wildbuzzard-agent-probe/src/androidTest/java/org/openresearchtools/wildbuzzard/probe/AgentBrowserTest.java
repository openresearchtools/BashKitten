// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard.probe;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import org.json.JSONArray;
import org.json.JSONObject;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class AgentBrowserTest {
    @Test public void externalAppControlsRealGeckoTabs() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        launch(context);
        long deadline = SystemClock.elapsedRealtime() + 20000;
        while (!ProbeActivity.connected && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
        assertTrue("External Binder connection", ProbeActivity.connected);
        click(device, "Request browser access");
        assertTrue("Browser-owned consent dialog", device.wait(Until.hasObject(By.text("Allow browser control?")), 15000));
        click(device, "Allow");
        launch(context);
        ProbeActivity.testResult = null;
        click(device, "Run lifecycle and page tests");
        deadline = SystemClock.elapsedRealtime() + 180000;
        while ((ProbeActivity.testResult == null || ProbeActivity.testResult.equals("RUNNING")) && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(200);
        assertEquals("Probe result", "PASS", ProbeActivity.testResult);
        launch(context);
        click(device, "Show last tab");
        assertTrue("Fenix foreground browser", device.wait(Until.hasObject(By.pkg("org.openresearchtools.wildbuzzard").depth(0)), 15000));
        verifyProcessRecovery(context, device);
        File captures = new File(context.getExternalFilesDir(null), "screenshots"); captures.mkdirs();
        device.executeShellCommand("cmd uimode night no");
        device.waitForIdle(); SystemClock.sleep(1000);
        assertTrue(device.takeScreenshot(new File(captures, "wildbuzzard-light.png")));
        device.executeShellCommand("cmd uimode night yes");
        device.waitForIdle(); SystemClock.sleep(1000);
        assertTrue(device.takeScreenshot(new File(captures, "wildbuzzard-dark.png")));
        UiObject2 menu = device.wait(Until.findObject(By.desc("More options")), 10000);
        assertNotNull("Fenix menu", menu); menu.click();
        device.waitForIdle();
        assertTrue(device.takeScreenshot(new File(captures, "wildbuzzard-dark-menu.png")));
        assertNotNull("Desktop site is in the normal menu", device.wait(Until.findObject(By.descStartsWith("Desktop site ")), 10000));
        assertNotNull("Per-tab adblocking is in the normal menu", device.wait(Until.findObject(By.descStartsWith("Adblocking for this tab ")), 10000));
        assertFalse("No separate product tab-options screen", device.hasObject(By.desc("Wild Buzzard tab controls")));
        new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("Settings"));
        click(device, "Settings");
        new UiScrollable(new UiSelector().scrollable(true)).scrollTextIntoView("Licenses and source");
        click(device, "Licenses and source");
        assertTrue(device.wait(Until.hasObject(By.text("Wild Buzzard, BrowserOS and agent tools")), 10000));
        assertTrue(device.wait(Until.hasObject(By.text("C Tor and its dependencies")), 10000));
        assertTrue(device.takeScreenshot(new File(captures, "wildbuzzard-dark-licenses.png")));
        click(device, "All notices and source links");
        assertTrue("Offline source and copyright bundle is displayed",
            device.wait(Until.hasObject(By.textStartsWith("Wild Buzzard for Android")), 10000));
        click(device, "Close");
        click(device, "Android library licenses");
        assertFalse("Resolved dependency licenses are packaged",
            device.wait(Until.hasObject(By.text("Dependency notices unavailable")), 1000));
        assertNotNull("Android dependency list", device.wait(Until.findObject(By.clazz("android.widget.ListView")), 10000));
        assertFalse("Debug APK must include actual dependency notices", device.hasObject(By.text("Debug License Info")));
        device.pressBack();
        device.waitForIdle();
        click(device, "Back");
        click(device, "Navigate up");
        assertNotNull("Settings returns to the browser", device.wait(Until.findObject(By.desc("More options")), 10000));
    }
    private void verifyProcessRecovery(Context context, UiDevice device) throws Exception {
        ProbeActivity probe = ProbeActivity.active;
        String selected = ProbeActivity.lastTab;
        String dormant = ((JSONObject) probe.command("tabs.create", new JSONObject()
            .put("url", "http://127.0.0.1:8765/"))).getString("id");
        probe.waitPage(dormant);
        probe.command("tabs.setDesktopMode", probe.params(dormant).put("enabled", true));
        probe.command("tabs.setAdblocking", probe.params(dormant).put("enabled", false));
        probe.waitValue(dormant, "return document.querySelector('#ad-test').dataset.result;", "loaded");
        device.pressHome();
        SystemClock.sleep(3000);
        device.executeShellCommand("am force-stop org.openresearchtools.wildbuzzard");
        context.startActivity(new Intent().setClassName("org.openresearchtools.wildbuzzard", "org.mozilla.fenix.HomeActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        context.startActivity(new Intent(context, ProbeActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        long deadline = SystemClock.elapsedRealtime() + 20000;
        while ((!ProbeActivity.connected || ProbeActivity.active == probe) && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
        assertTrue("Agent reconnects after browser process restart", ProbeActivity.connected);
        probe = ProbeActivity.active;
        JSONObject restored = null;
        while (restored == null && SystemClock.elapsedRealtime() < deadline) {
            JSONArray tabs = (JSONArray) probe.command("tabs.list", new JSONObject());
            for (int i = 0; i < tabs.length(); i++) {
                if (dormant.equals(tabs.getJSONObject(i).getString("id"))) restored = tabs.getJSONObject(i);
            }
            if (restored == null) SystemClock.sleep(100);
        }
        assertNotNull("Dormant agent tab survives process restart", restored);
        assertTrue("Desktop mode persists", restored.getBoolean("desktop"));
        assertFalse("Per-tab adblocking choice persists", restored.getBoolean("adblock"));
        probe.waitValue(dormant, "return navigator.userAgent.includes('Mobile');", "false");
        probe.waitValue(dormant, "return document.querySelector('#ad-test').dataset.result;", "loaded");
        probe.command("tabs.close", probe.params(dormant));
        ProbeActivity.lastTab = selected;
        click(device, "Show last tab");
        assertTrue("Restored Fenix tab opens from another app", device.wait(Until.hasObject(By.pkg("org.openresearchtools.wildbuzzard").depth(0)), 15000));
        probe.waitPage(selected);
    }
    private void launch(Context context) {
        context.startActivity(new Intent(context, ProbeActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
    }
    private void click(UiDevice device, String text) {
        java.util.regex.Pattern label = java.util.regex.Pattern.compile(java.util.regex.Pattern.quote(text), java.util.regex.Pattern.CASE_INSENSITIVE);
        UiObject2 item = device.findObject(By.desc(label));
        if (item == null) item = device.wait(Until.findObject(By.text(label)), 15000);
        assertNotNull(text, item); item.click();
    }
}
