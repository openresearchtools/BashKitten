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
import static org.openresearchtools.wildbuzzard.probe.UiNavigation.click;
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
        context.startActivity(new Intent(context, ProbeActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
        assertTrue("Visible caller may launch its browser tab",
            device.wait(Until.hasObject(By.text(java.util.regex.Pattern.compile("Show last tab", java.util.regex.Pattern.CASE_INSENSITIVE))), 15000));
        String tab = ((JSONObject) probe.command("tabs.create", new JSONObject().put("url", "http://127.0.0.1:8765/"))).getString("id");
        probe.send(probe.browser.showTab(tab));
        probe.waitPage(tab);
        device.waitForIdle();
        UiObject2 counter = device.wait(Until.findObject(By.desc(java.util.regex.Pattern.compile("(?:Non-private )?Tabs Open:.*"))), 45000);
        assertNotNull("Fenix tab counter", counter); counter.click();
        UiObject2 torPage = device.wait(Until.findObject(By.descStartsWith("Tor tabs:")), 10000);
        assertNotNull("Normal / Private / Tor tray", torPage); torPage.click();
        click(device, "Private Tor sites");
        assertTrue(device.wait(Until.hasObject(By.text("Private Tor sites")), 10000));
        click(device, "Back");
        click(device, "Private Tor sites");
        String browserPid = device.executeShellCommand("pidof org.openresearchtools.wildbuzzard").trim();
        device.executeShellCommand("pm grant org.openresearchtools.wildbuzzard android.permission.CAMERA");
        click(device, "Scan QR code");
        click(device, "Close scanner");
        assertTrue("Scanner closes back to enrollment", device.wait(Until.hasObject(By.text("Private Tor sites")), 10000));
        click(device, "Scan QR code");
        assertTrue(device.wait(Until.hasObject(By.text("Close scanner")), 10000));
        device.pressBack();
        assertTrue("Android Back closes scanner", device.wait(Until.hasObject(By.text("Private Tor sites")), 10000));
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
        assertTrue(device.wait(Until.hasObject(By.text("Add private Tor site")), 10000));
        device.findObject(By.clazz("android.widget.EditText")).setText("Private Tor fixture");
        click(device, "Save site");
        assertTrue("Imported site is saved with its chosen name",
            device.wait(Until.hasObject(By.text("Private Tor fixture")), 30000));
        assertTrue("File import supplies the onion address without typing",
            device.wait(Until.hasObject(By.desc("Open " + fixture.getString("onion"))), 10000));
        click(device, "Quick access " + fixture.getString("onion"));
        assertTrue("Import created a quick-access shortcut", device.wait(Until.hasObject(By.text("Already in quick access")), 10000));
        device.pressHome();
        device.executeShellCommand("am force-stop org.openresearchtools.wildbuzzard");
        context.startActivity(new Intent().setClassName("org.openresearchtools.wildbuzzard", "org.mozilla.fenix.HomeActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        context.startActivity(new Intent(context, ProbeActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        deadline = SystemClock.elapsedRealtime() + 30000;
        while ((!ProbeActivity.connected || ProbeActivity.active == probe) && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
        assertTrue("Agent reconnects after browser restart", ProbeActivity.connected);
        assertNotSame("Fresh independent probe connection", probe, ProbeActivity.active);
        probe = ProbeActivity.active;
        String privateTab = create(probe, "http://127.0.0.1:8765/", false);
        probe.waitPage(privateTab);
        probe.command("navigate", probe.params(privateTab).put("url", "https://" + fixture.getString("onion")));
        if (fixture.optBoolean("expired")) {
            assertCertError(probe, privateTab, "Expired enrolled onion certificate");
        } else {
            assertFixtureLoaded(probe, privateTab);
            android.util.Log.i("WildBuzzardProbe", "PASS: saved onion key works after browser restart without re-import");
            String otherPrivate = create(probe, "https://" + fixture.getString("otherPrivateOnion"), false);
            assertNavigationError(probe, otherPrivate, false, "Key is not tried on another private onion service");
            assertCertError(probe, create(probe, "https://wrong." + fixture.getString("onion"), true), "Enrolled onion hostname mismatch");
            assertCertError(probe, create(probe, "https://" + fixture.getString("publicOnion"), true), "Unenrolled onion unknown CA");
            assertCertError(probe, create(probe, "https://127.0.0.1:9443/", false), "Clearnet unknown CA");
            String loopback = create(probe, "http://127.0.0.1:8765/", true);
            assertNavigationError(probe, loopback, false, "Tor tab must not bypass its proxy for localhost");
            probe.command("evaluate", probe.params(privateTab).put("code", "document.title = 'Private onion preview'; return true;"));
            probe.send(probe.browser.showTab(privateTab));
            UiObject2 shownCounter = device.wait(Until.findObject(By.desc(java.util.regex.Pattern.compile("(?:Non-private )?Tabs Open:.*"))), 20000);
            assertNotNull("Tor tab keeps normal browser navigation", shownCounter);
            SystemClock.sleep(1500); shownCounter.click();
            assertTrue("Tor session is shown in the Tor page", device.wait(Until.hasObject(By.text("Private onion preview")), 15000));
            assertTrue("Rendered Tor tab has a page thumbnail", device.wait(Until.hasObject(By.desc("Page preview")), 15000));
            UiObject2 normalPage = device.findObject(By.descStartsWith("Normal Tabs Open:"));
            assertNotNull(normalPage); normalPage.click();
            assertFalse("Tor session is absent from Normal", device.wait(Until.hasObject(By.text("Private onion preview")), 1500));
            device.findObject(By.descStartsWith("Tor tabs:")).click();
            assertTrue(device.wait(Until.hasObject(By.text("Private Tor fixture")), 10000));
            File captures = new File(context.getExternalFilesDir(null), "screenshots"); captures.mkdirs();
            assertTrue(device.takeScreenshot(new File(captures, "wildbuzzard-tor-tabs.png")));
            android.util.Log.i("WildBuzzardProbe", "PASS: Tor tray separation, saved quick access and rendered thumbnail");
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
                    else assertNotEquals(label + " must fail before TLS", "ERROR_SECURITY_BAD_CERT", tab.getString("error"));
                    probe.command("tabs.close", probe.params(id));
                    android.util.Log.i("WildBuzzardProbe", "PASS: " + label);
                    return;
                }
            }
            SystemClock.sleep(250);
        } while (SystemClock.elapsedRealtime() < deadline);
        fail(label + ": expected navigation error");
    }

}
