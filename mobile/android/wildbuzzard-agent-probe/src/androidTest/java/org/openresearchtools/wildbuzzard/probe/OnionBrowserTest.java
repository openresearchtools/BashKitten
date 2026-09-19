// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard.probe;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.file.Files;
import java.util.List;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

/** Optional live Tor tests; fixture credentials are generated outside the repository. */
@RunWith(AndroidJUnit4.class)
public final class OnionBrowserTest {
    @Test public void onionIdentityTrustKeepsOtherTlsChecks() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file = new File(context.getExternalFilesDir(null), "probe-fixture.json");
        assumeTrue("Start onion-fixture.py and push its private probe-fixture.json to the probe app", file.isFile());
        JSONObject fixture = new JSONObject(new String(Files.readAllBytes(file.toPath()), java.nio.charset.StandardCharsets.UTF_8));
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        context.startActivity(new Intent(context, ProbeActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
        device.waitForIdle();
        long deadline = SystemClock.elapsedRealtime() + 20000;
        while (!ProbeActivity.connected && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
        assertTrue("External Binder connection", ProbeActivity.connected);
        ProbeActivity probe = ProbeActivity.active;
        click(device, "Request browser access");
        click(device, "Allow");
        String tab = ((JSONObject) probe.command("tabs.create", new JSONObject().put("url", "http://127.0.0.1:8765/"))).getString("id");
        probe.send(probe.browser.showTab(tab));
        probe.waitPage(tab);
        device.waitForIdle();
        UiObject2 menu = device.wait(Until.findObject(By.desc("More options")), 20000);
        assertNotNull("Fenix menu", menu); menu.click();
        if (!device.wait(Until.hasObject(By.desc("Wild Buzzard tab controls")), 2000)) {
            new UiScrollable(new UiSelector().scrollable(true)).scrollTextIntoView("Wild Buzzard tab controls");
        }
        click(device, "Wild Buzzard tab controls");
        click(device, "Onion keys");
        assertTrue(device.wait(Until.hasObject(By.text("Private onion sites")), 10000));
        String browserPid = device.executeShellCommand("pidof org.openresearchtools.wildbuzzard").trim();
        device.executeShellCommand("pm grant org.openresearchtools.wildbuzzard android.permission.CAMERA");
        click(device, "Scan QR code");
        click(device, "Close scanner");
        assertTrue("Scanner closes back to enrollment", device.wait(Until.hasObject(By.text("Private onion sites")), 10000));
        click(device, "Scan QR code");
        assertTrue(device.wait(Until.hasObject(By.text("Close scanner")), 10000));
        device.pressBack();
        assertTrue("Android Back closes scanner", device.wait(Until.hasObject(By.text("Private onion sites")), 10000));
        assertEquals("Scanner cancellation keeps browser alive", browserPid, device.executeShellCommand("pidof org.openresearchtools.wildbuzzard").trim());
        String credentialFile = InstrumentationRegistry.getArguments().getString("credentialFile");
        assertNotNull("Runner stages a complete auth_private enrollment file", credentialFile);
        click(device, "Choose .auth_private file");
        UiObject2 roots = device.wait(Until.findObject(By.desc("Show roots")), 10000);
        assertNotNull("Android document picker", roots); roots.click();
        click(device, "Downloads");
        if (!device.wait(Until.hasObject(By.text(credentialFile)), 3000))
            new UiScrollable(new UiSelector().scrollable(true)).scrollTextIntoView(credentialFile);
        click(device, credentialFile);
        assertTrue("Tor installs the encrypted credential", device.wait(Until.hasObject(By.text("Onion key imported")), 195000));
        assertTrue("File import supplies the onion address without typing",
            device.wait(Until.hasObject(By.text(java.util.regex.Pattern.compile("Open " + java.util.regex.Pattern.quote(fixture.getString("onion")), java.util.regex.Pattern.CASE_INSENSITIVE))), 10000));
        String privateTab = create(probe, "https://" + fixture.getString("onion"), true);
        if (fixture.optBoolean("expired")) {
            assertCertError(probe, privateTab, "Expired enrolled onion certificate");
        } else {
            assertFixtureLoaded(probe, privateTab);
            assertCertError(probe, create(probe, "https://wrong." + fixture.getString("onion"), true), "Enrolled onion hostname mismatch");
            assertCertError(probe, create(probe, "https://" + fixture.getString("publicOnion"), true), "Unenrolled onion unknown CA");
            assertCertError(probe, create(probe, "https://127.0.0.1:9443/", false), "Clearnet unknown CA");
            String loopback = create(probe, "http://127.0.0.1:8765/", true);
            assertNavigationError(probe, loopback, false, "Tor tab must not bypass its proxy for localhost");
        }
        android.util.Log.i("WildBuzzardProbe", "PASS: live onion TLS policy checks completed");
    }
    private String create(ProbeActivity probe, String url, boolean tor) throws Exception {
        return ((JSONObject) probe.command("tabs.create", new JSONObject().put("url", url).put("tor", tor))).getString("id");
    }
    private void assertFixtureLoaded(ProbeActivity probe, String id) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 120000;
        do {
            try {
                if (probe.evaluate(id, "return document.querySelector('h1')?.textContent;").toString().contains("Agent test page")) {
                    assertEquals("https:", probe.evaluate(id, "return location.protocol;"));
                    assertEquals("Enrolled onion remains a secure web context", true,
                        probe.evaluate(id, "return window.isSecureContext;"));
                    android.util.Log.i("WildBuzzardProbe", "PASS: enrolled onion private-CA HTTPS without CA installation");
                    return;
                }
            } catch (IllegalStateException ignored) {}
            SystemClock.sleep(250);
        } while (SystemClock.elapsedRealtime() < deadline);
        fail("Enrolled private onion did not load");
    }
    private void assertCertError(ProbeActivity probe, String id, String label) throws Exception {
        assertNavigationError(probe, id, true, label);
    }
    private void assertNavigationError(ProbeActivity probe, String id, boolean certificate, String label) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 120000;
        do {
            JSONArray tabs = (JSONArray) probe.command("tabs.list", new JSONObject());
            for (int i = 0; i < tabs.length(); i++) {
                JSONObject tab = tabs.getJSONObject(i);
                if (tab.getString("id").equals(id) && !tab.optString("error").isEmpty()) {
                    if (certificate) assertEquals(label, "ERROR_SECURITY_BAD_CERT", tab.getString("error"));
                    probe.command("tabs.close", probe.params(id));
                    android.util.Log.i("WildBuzzardProbe", "PASS: " + label);
                    return;
                }
            }
            SystemClock.sleep(250);
        } while (SystemClock.elapsedRealtime() < deadline);
        fail(label + ": expected navigation error");
    }
    private void click(UiDevice device, String text) {
        java.util.regex.Pattern label = java.util.regex.Pattern.compile(java.util.regex.Pattern.quote(text), java.util.regex.Pattern.CASE_INSENSITIVE);
        UiObject2 item = device.findObject(By.desc(label));
        if (item == null) item = device.wait(Until.findObject(By.text(label)), 15000);
        assertNotNull(text, item); item.click();
    }
}
