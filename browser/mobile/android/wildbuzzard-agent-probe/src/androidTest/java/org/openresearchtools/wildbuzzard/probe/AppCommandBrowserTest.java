// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard.probe;

import android.content.*;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.openresearchtools.wildbuzzard.probe.UiNavigation.click;
import static org.openresearchtools.wildbuzzard.probe.UiNavigation.scrollToAndClick;

@RunWith(AndroidJUnit4.class)
public final class AppCommandBrowserTest {
    Context context;
    File directory;
    String apk;
    String scope = "test-" + UUID.randomUUID();
    JSONObject run(boolean success, String... args) throws Exception {
        ArrayList<String> command = new ArrayList<>(Arrays.asList("/system/bin/app_process", "/",
            "org.openresearchtools.wildbuzzard.BrowserCommand", "--no-launch", "--session", scope));
        command.addAll(Arrays.asList(args));
        ProcessBuilder builder = new ProcessBuilder(command).redirectErrorStream(true);
        builder.environment().put("CLASSPATH", apk);
        builder.environment().remove("LD_PRELOAD"); builder.environment().remove("LD_LIBRARY_PATH");
        File output = new File(directory, "output"); builder.redirectOutput(output);
        Process process = builder.start();
        assertTrue("Native command finishes", process.waitFor(60, TimeUnit.SECONDS));
        String text = new String(Files.readAllBytes(output.toPath()), StandardCharsets.UTF_8);
        if (success) assertEquals(text, 0, process.exitValue()); else assertNotEquals(text, 0, process.exitValue());
        return new JSONObject(text);
    }
    Object call(String method, JSONObject params) throws Exception { return run(true, method, params.toString()).get("result"); }
    JSONObject tab(String id) throws Exception { return new JSONObject().put("tabId", id); }
    byte[] transfer(JSONObject grant, String token, boolean origin, int expected) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(grant.getString("url")).openConnection();
        connection.setConnectTimeout(5000); connection.setReadTimeout(10000);
        if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
        if (origin) connection.setRequestProperty("Origin", "https://example.com");
        assertEquals(expected, connection.getResponseCode());
        if (expected != 200) { connection.disconnect(); return new byte[0]; }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = connection.getInputStream()) { byte[] bytes = new byte[8192]; int count;
            while ((count = in.read(bytes)) != -1) out.write(bytes, 0, count);
        } finally { connection.disconnect(); }
        return out.toByteArray();
    }
    @Test public void vendorAppGrantsPrivateFilesAndSessionIsolation() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        directory = new File(context.getFilesDir(), "app-command-" + UUID.randomUUID()); assertTrue(directory.mkdir());
        apk = context.getPackageManager().getApplicationInfo("org.openresearchtools.wildbuzzard", 0).sourceDir;
        context.startActivity(new Intent(context, ProbeActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
        context.startActivity(new Intent().setClassName("org.openresearchtools.wildbuzzard", "org.mozilla.fenix.HomeActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        assertNotNull(device.wait(Until.findObject(By.desc("More options")), 15000));
        device.findObject(By.desc("More options")).click(); scrollToAndClick(device, "Settings"); scrollToAndClick(device, "Revoke agent access"); device.pressBack();
        assertTrue(run(false, "capabilities").getString("error").contains("authorization"));
        JSONObject grant = run(true, "--authorize").getJSONObject("result");
        context.startActivity(new Intent().setClassName("org.openresearchtools.wildbuzzard", "org.openresearchtools.wildbuzzard.CommandAccessActivity")
            .putExtra("appGrant", grant.getString("appGrant")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        click(device, "Allow");
        JSONObject capabilities = (JSONObject) call("capabilities", new JSONObject());
        assertEquals("user-grant", capabilities.getString("authorization"));
        assertFalse(capabilities.getBoolean("debuggable"));
        assertFalse(capabilities.getBoolean("androidAccessibilityService"));
        String first = ((JSONObject) call("tabs.create", new JSONObject().put("url", "http://127.0.0.1:8765/"))).getString("id");
        long deadline = SystemClock.elapsedRealtime() + 30000;
        while (true) {
            try { if (((JSONObject) call("evaluate", tab(first).put("code", "return document.querySelector('h1')?.textContent;"))).getString("value").equals("Agent test page")) break; }
            catch (Exception ignored) {}
            assertTrue("Fixture loads", SystemClock.elapsedRealtime() < deadline); SystemClock.sleep(250);
        }
        JSONObject diagnostics = (JSONObject) call("diagnostics", tab(first));
        assertFalse(diagnostics.getBoolean("devtoolsRemoteEnabled")); assertFalse(diagnostics.getBoolean("marionetteEnabled"));
        assertFalse(diagnostics.getBoolean("remoteAgentEnabled")); assertFalse(diagnostics.getBoolean("webdriver"));
        assertEquals("dom", diagnostics.getString("snapshotBackend"));
        assertTrue(call("snapshot", tab(first)).toString().contains("Agent test page"));
        String originalScope = scope; scope += "-other";
        assertFalse(call("tabs.list", new JSONObject()).toString().contains(first));
        run(false, "tabs.close", tab(first).toString());
        scope = originalScope;
        JSONObject launch = (JSONObject) call("tabs.show", tab(first));
        context.startActivity(new Intent().setClassName("org.openresearchtools.wildbuzzard", "org.openresearchtools.wildbuzzard.CommandAccessActivity")
            .putExtra("launch", launch.getString("launch")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        assertNotNull(device.wait(Until.findObject(By.desc("More options")), 15000));
        File image = new File(directory, "screenshot.png");
        JSONObject saved = run(true, "screenshot", tab(first).toString(), "--output", image.getAbsolutePath()).getJSONObject("result");
        assertEquals(image.getAbsolutePath(), saved.getString("path"));
        new CommandBrowserTest().assertFixturePixels(Files.readAllBytes(image.toPath()));
        assertEquals(0600, android.system.Os.stat(image.getAbsolutePath()).st_mode & 0777);
        String contents = "Wild Buzzard private transfer\n";
        call("evaluate", tab(first).put("code", "const a=document.createElement('a');a.download='wildbuzzard-transfer.txt';a.href=URL.createObjectURL(new Blob(['Wild Buzzard private transfer\\n'.repeat(4096)],{type:'text/plain'}));document.body.append(a);a.click();return true;"));
        JSONObject download = null;
        deadline = SystemClock.elapsedRealtime() + 60000;
        while (SystemClock.elapsedRealtime() < deadline) {
            JSONArray list = (JSONArray) call("downloads.list", new JSONObject());
            for (int i=0;i<list.length();i++) {
                JSONObject item = list.getJSONObject(i);
                if (item.getString("name").startsWith("wildbuzzard-transfer")) {
                    if (item.getString("status").equals("COMPLETED")) download = item;
                    else if (item.getString("status").equals("INITIATED")) {
                        try { call("downloads.accept", tab(first).put("downloadId", item.getString("id"))); } catch (Exception ignored) {}
                    }
                }
            }
            if (download != null) break; SystemClock.sleep(250);
        }
        assertNotNull("Real browser download completes", download);
        JSONObject exported = (JSONObject) call("downloads.get", new JSONObject().put("downloadId", download.getString("id")));
        JSONObject transfer = exported.getJSONObject("transfer");
        transfer(transfer, null, false, 403); transfer(transfer, "invalid", false, 403);
        transfer(transfer, transfer.getString("token"), true, 403);
        byte[] received = transfer(transfer, transfer.getString("token"), false, 200);
        assertEquals(contents.repeat(4096), new String(received, StandardCharsets.UTF_8));
        scope += "-other";
        assertFalse(call("downloads.list", new JSONObject()).toString().contains(download.getString("id")));
        run(false, "downloads.get", new JSONObject().put("downloadId", download.getString("id")).toString()); scope = originalScope;
        device.findObject(By.desc("More options")).click(); scrollToAndClick(device, "Settings"); scrollToAndClick(device, "Agent access");
        scrollToAndClick(device, "Agent access " + context.getPackageName()); click(device, "Revoke");
        run(false, "tabs.list");
        try { transfer(transfer, transfer.getString("token"), false, 403); } catch (ConnectException ignored) {}
        assertNotNull("Revocation does not kill the browser", device.executeShellCommand("pidof org.openresearchtools.wildbuzzard"));
        android.util.Log.i("WildBuzzardProbe", "PASS: native app identity, vendor grant, chat isolation, diagnostics, private screenshot/download transfer and revocation");
        device.pressBack();
    }
}
