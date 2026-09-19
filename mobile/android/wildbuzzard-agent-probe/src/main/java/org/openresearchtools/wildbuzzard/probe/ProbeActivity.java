// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard.probe;

import android.app.Activity;
import android.content.*;
import android.os.*;
import android.widget.*;
import java.util.concurrent.*;
import org.json.*;
import org.openresearchtools.wildbuzzard.api.*;

/** Installed separately to exercise the public Binder boundary under another UID. */
public final class ProbeActivity extends Activity {
    IAgentBrowser browser;
    TextView output;
    EditText request;
    static volatile String lastTab;
    public static volatile String testResult;
    public static volatile boolean connected;
    static volatile ProbeActivity active;
    final ExecutorService worker = Executors.newSingleThreadExecutor();
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); connected = false; active = this;
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(20, 65, 20, 20);
        add(root, "Request browser access", () -> { try { send(browser.requestAccess()); } catch (Exception e) { log("Grant request: " + e); } });
        add(root, "Run lifecycle and page tests", () -> { testResult = "RUNNING"; worker.execute(this::tests); });
        add(root, "Show last tab", () -> { try { send(browser.showTab(lastTab)); } catch (Exception e) { log("Show: " + e); } });
        request = new EditText(this); request.setText("{\"method\":\"capabilities\"}"); root.addView(request);
        add(root, "Send JSON request", () -> { String text = request.getText().toString(); worker.execute(() -> { try { log(call(text).toString(2)); } catch (Exception e) { log(e.toString()); } }); });
        ScrollView scroll = new ScrollView(this); output = new TextView(this); output.setTextIsSelectable(true); scroll.addView(output); root.addView(scroll); setContentView(root);
        Intent intent = new Intent("org.openresearchtools.wildbuzzard.BIND_AGENT").setPackage("org.openresearchtools.wildbuzzard");
        if (!bindService(intent, connection, BIND_AUTO_CREATE)) log("FAIL: browser service unavailable");
    }
    final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            browser = IAgentBrowser.Stub.asInterface(binder); connected = true; log("Connected from an independent Android UID");
            worker.execute(() -> {
                try { call("{\"method\":\"tabs.list\"}"); log("Already authorized"); }
                catch (SecurityException e) { log("PASS: unapproved caller denied"); }
                catch (Exception e) { log("Initial check: " + e); }
            });
        }
        @Override public void onServiceDisconnected(ComponentName name) { connected = false; browser = null; log("Service disconnected"); }
    };
    void send(android.app.PendingIntent intent) throws Exception {
        android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
        if (Build.VERSION.SDK_INT >= 36) options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE);
        else if (Build.VERSION.SDK_INT >= 34) options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
        intent.send(this, 0, null, null, null, null, options.toBundle());
    }
    void add(LinearLayout root, String title, Runnable action) { Button b = new Button(this); b.setText(title); b.setOnClickListener(v -> action.run()); root.addView(b); }
    void log(String message) {
        android.util.Log.i("WildBuzzardProbe", message);
        runOnUiThread(() -> output.append(message + "\n"));
    }
    JSONObject call(String json) throws Exception {
        CompletableFuture<String> result = new CompletableFuture<>();
        browser.execute(json, new IAgentCallback.Stub() { @Override public void onResult(String value) { result.complete(value); } });
        return new JSONObject(result.get(220, TimeUnit.SECONDS));
    }
    Object command(String method, JSONObject params) throws Exception {
        JSONObject result = call(new JSONObject().put("method", method).put("params", params).toString());
        if (result.has("error")) throw new IllegalStateException(result.getString("error"));
        return result.get("result");
    }
    JSONObject params(String tab) throws Exception { return new JSONObject().put("tabId", tab); }
    void check(boolean condition, String name) { if (!condition) throw new AssertionError(name); log("PASS: " + name); }
    JSONObject find(Object value, String tag, String name) throws Exception {
        if (value instanceof JSONObject) {
            JSONObject item = (JSONObject) value;
            if (tag.equals(item.optString("tag")) && item.optString("name").contains(name) && item.has("reference")) return item;
            java.util.Iterator<String> keys = item.keys();
            while (keys.hasNext()) { JSONObject found = find(item.get(keys.next()), tag, name); if (found != null) return found; }
        } else if (value instanceof JSONArray) {
            JSONArray items = (JSONArray) value;
            for (int i = 0; i < items.length(); i++) { JSONObject found = find(items.get(i), tag, name); if (found != null) return found; }
        }
        return null;
    }
    Object evaluate(String tab, String code) throws Exception {
        JSONObject result = (JSONObject) command("evaluate", params(tab).put("code", code));
        if (!result.optBoolean("hasValue")) throw new IllegalStateException(result.optString("description"));
        return result.get("value");
    }
    void waitPage(String tab) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 15000;
        do {
            try {
                JSONObject result = (JSONObject) command("wait", params(tab).put("for", "selector").put("value", "#name").put("timeout", 1000));
                if (result.optBoolean("matched")) return;
            } catch (IllegalStateException ignored) {}
            Thread.sleep(150);
        } while (android.os.SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError("Page did not load");
    }
    void waitValue(String tab, String code, String expected) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 15000;
        do {
            try { if (evaluate(tab, code).toString().equals(expected)) return; }
            catch (IllegalStateException ignored) {}
            Thread.sleep(150);
        } while (SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError("Page value did not become " + expected);
    }
    void tests() {
        testResult = "RUNNING";
        try {
            JSONObject a = (JSONObject) command("tabs.create", new JSONObject());
            JSONObject b = (JSONObject) command("tabs.create", new JSONObject());
            String one = a.getString("id"), two = b.getString("id"); lastTab = two;
            check(!one.equals(two), "stable independent tab IDs");
            JSONObject denied = call(new JSONObject().put("method", "tabs.close").put("params", params("not-an-owned-tab")).toString());
            check(denied.has("error"), "unknown tab cannot be closed");
            command("tabs.close", params(one));
            JSONArray tabs = (JSONArray) command("tabs.list", new JSONObject());
            check(tabs.toString().contains(two) && !tabs.toString().contains(one), "closing one tab leaves the other alive");
            command("navigate", params(two).put("url", "http://127.0.0.1:8765/"));
            send(browser.showTab(two));
            waitPage(two);
            waitValue(two, "return document.documentElement.dataset.consent;", "rejected");
            check(true, "cookie banner policy actively rejects consent");
            Object snapshot = command("snapshot", params(two));
            check(snapshot.toString().contains("Agent test page"), "native Gecko page snapshot");
            check(evaluate(two, "return navigator.globalPrivacyControl;").equals(true), "Global Privacy Control is enabled");
            String input = find(snapshot, "input", "Name").getString("reference");
            String button = find(snapshot, "button", "Submit").getString("reference");
            command("act", params(two).put("kind", "fill").put("target", input).put("value", "WildBuzzard").put("clear", true));
            command("act", params(two).put("kind", "click").put("target", button));
            check(evaluate(two, "return document.querySelector('#result').textContent;").toString().contains("Hello WildBuzzard"), "native element input and click");
            command("snapshot", params(two));
            JSONObject stale = call(new JSONObject().put("method", "act").put("params", params(two).put("kind", "click").put("target", button)).toString());
            check(stale.has("error"), "stale element reference rejected");
            waitValue(two, "return document.querySelector('#ad-test').dataset.result;", "blocked");
            check(true, "native adblock blocks bundled-list image fixture");
            evaluate(two, "document.cookie = 'agent_session=shared; Path=/; SameSite=Lax'; localStorage.setItem('agent_session', 'shared'); return true;");
            String isolated = ((JSONObject) command("tabs.create", new JSONObject().put("url", "http://127.0.0.1:8765/"))).getString("id");
            waitPage(isolated);
            waitValue(isolated, "return document.cookie.includes('agent_session=shared') && localStorage.getItem('agent_session') === 'shared';", "true");
            check(true, "same-agent tabs share normal website login storage");
            waitValue(isolated, "return document.querySelector('#ad-test').dataset.result;", "blocked");
            command("tabs.setAdblocking", params(two).put("enabled", false));
            waitPage(two);
            waitValue(two, "return document.querySelector('#ad-test').dataset.result;", "loaded");
            check(true, "per-tab exception permits image fixture after reload");
            waitValue(isolated, "return document.querySelector('#ad-test').dataset.result;", "blocked");
            check(true, "adblock exception does not disable protection in another tab");
            command("tabs.setDesktopMode", params(two).put("enabled", true));
            waitPage(two);
            waitValue(two, "return navigator.userAgent.includes('Mobile');", "false");
            check(true, "agent enables real desktop user agent");
            waitValue(isolated, "return navigator.userAgent.includes('Mobile');", "true");
            check(true, "desktop mode does not change another tab");
            command("tabs.close", params(isolated));
            command("tabs.setDesktopMode", params(two).put("enabled", false));
            command("tabs.setAdblocking", params(two).put("enabled", true));
            waitPage(two);
            JSONArray beforePopup = (JSONArray) command("tabs.list", new JSONObject());
            java.util.Set<String> existing = new java.util.HashSet<>();
            for (int i = 0; i < beforePopup.length(); i++) existing.add(beforePopup.getJSONObject(i).getString("id"));
            JSONObject popup = find(command("snapshot", params(two)), "a", "Open child tab");
            check(popup != null, "child-tab link is exposed to the agent");
            runOnUiThread(() -> startActivity(new Intent(this, ProbeActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP)));
            long focusDeadline = SystemClock.elapsedRealtime() + 10000;
            while (!hasWindowFocus() && SystemClock.elapsedRealtime() < focusDeadline) Thread.sleep(100);
            check(hasWindowFocus(), "external agent app is foreground while the browser is backgrounded");
            command("act", params(two).put("kind", "click").put("target", popup.getString("reference")));
            String child = null;
            long popupDeadline = SystemClock.elapsedRealtime() + 15000;
            while (child == null && SystemClock.elapsedRealtime() < popupDeadline) {
                JSONArray opened = (JSONArray) command("tabs.list", new JSONObject());
                for (int i = 0; i < opened.length(); i++) {
                    String id = opened.getJSONObject(i).getString("id");
                    if (!existing.contains(id)) child = id;
                }
                if (child == null) Thread.sleep(100);
            }
            check(child != null, "page-created child tab inherits agent ownership");
            waitValue(child, "return !!document.querySelector('#frame-button');", "true");
            check(true, "child tab loads through its configured route");
            waitValue(child, "return !!window.opener && window.opener.document.querySelector('h1').textContent;", "Agent test page");
            check(true, "same-origin popup can communicate with its opener");
            command("tabs.close", params(child));
            waitPage(two);
            check(true, "closing child tab preserves the parent");
            JSONObject restricted = call(new JSONObject().put("method", "navigate").put("params", params(two).put("url", "file:///data/system/packages.xml")).toString());
            check(restricted.has("error"), "agent cannot navigate to local files");
            command("tabs.close", params(two));
            command("capabilities", new JSONObject());
            check(true, "browser service survives closing the last owned tab");
            lastTab = ((JSONObject) command("tabs.create", new JSONObject().put("url", "http://127.0.0.1:8765/"))).getString("id");
            testResult = "PASS";
            log("PASS: lifecycle/page suite completed");
        } catch (Throwable error) { testResult = "FAIL: " + error; log(testResult); }
    }
    @Override protected void onDestroy() { if (active == this) { active = null; connected = false; } unbindService(connection); worker.shutdownNow(); super.onDestroy(); }
}
