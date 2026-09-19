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
        File captures = new File(context.getExternalFilesDir(null), "screenshots"); captures.mkdirs();
        device.executeShellCommand("cmd uimode night no");
        device.waitForIdle(); SystemClock.sleep(1000);
        assertTrue(device.takeScreenshot(new File(captures, "wildbuzzard-light.png")));
        device.executeShellCommand("cmd uimode night yes");
        device.waitForIdle(); SystemClock.sleep(1000);
        assertTrue(device.takeScreenshot(new File(captures, "wildbuzzard-dark.png")));
    }
    private void launch(Context context) {
        context.startActivity(new Intent(context, ProbeActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
    }
    private void click(UiDevice device, String text) {
        UiObject2 item = device.wait(Until.findObject(By.text(java.util.regex.Pattern.compile(java.util.regex.Pattern.quote(text), java.util.regex.Pattern.CASE_INSENSITIVE))), 15000);
        assertNotNull(text, item); item.click();
    }
}
