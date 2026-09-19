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
    String lastTab;
    final ExecutorService worker = Executors.newSingleThreadExecutor();
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(20, 65, 20, 20);
        add(root, "Request browser access", () -> { try { browser.requestAccess().send(); } catch (Exception e) { log("Grant request: " + e); } });
        add(root, "Run lifecycle and page tests", () -> worker.execute(this::tests));
        add(root, "Show last tab", () -> { try { browser.showTab(lastTab).send(); } catch (Exception e) { log("Show: " + e); } });
        request = new EditText(this); request.setText("{\"method\":\"capabilities\"}"); root.addView(request);
        add(root, "Send JSON request", () -> { String text = request.getText().toString(); worker.execute(() -> { try { log(call(text).toString(2)); } catch (Exception e) { log(e.toString()); } }); });
        ScrollView scroll = new ScrollView(this); output = new TextView(this); output.setTextIsSelectable(true); scroll.addView(output); root.addView(scroll); setContentView(root);
        Intent intent = new Intent("org.openresearchtools.wildbuzzard.BIND_AGENT").setPackage("org.openresearchtools.wildbuzzard");
        if (!bindService(intent, connection, BIND_AUTO_CREATE)) log("FAIL: browser service unavailable");
    }
    final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            browser = IAgentBrowser.Stub.asInterface(binder); log("Connected from an independent Android UID");
            worker.execute(() -> {
                try { call("{\"method\":\"tabs.list\"}"); log("Already authorized"); }
                catch (SecurityException e) { log("PASS: unapproved caller denied"); }
                catch (Exception e) { log("Initial check: " + e); }
            });
        }
        @Override public void onServiceDisconnected(ComponentName name) { browser = null; log("Service disconnected"); }
    };
    void add(LinearLayout root, String title, Runnable action) { Button b = new Button(this); b.setText(title); b.setOnClickListener(v -> action.run()); root.addView(b); }
    void log(String message) {
        android.util.Log.i("WildBuzzardProbe", message);
        runOnUiThread(() -> output.append(message + "\n"));
    }
    JSONObject call(String json) throws Exception {
        CompletableFuture<String> result = new CompletableFuture<>();
        browser.execute(json, new IAgentCallback.Stub() { @Override public void onResult(String value) { result.complete(value); } });
        return new JSONObject(result.get(105, TimeUnit.SECONDS));
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
    Object evaluate(String tab, String code) throws Exception { return command("evaluate", params(tab).put("code", code)); }
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
    void tests() {
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
            browser.showTab(two).send();
            waitPage(two);
            Object snapshot = command("snapshot", params(two));
            check(snapshot.toString().contains("Agent test page"), "native Gecko page snapshot");
            String input = find(snapshot, "input", "Name").getString("reference");
            String button = find(snapshot, "button", "Submit").getString("reference");
            command("act", params(two).put("kind", "fill").put("target", input).put("value", "WildBuzzard").put("clear", true));
            command("act", params(two).put("kind", "click").put("target", button));
            check(evaluate(two, "return document.querySelector('#result').textContent;").toString().contains("Hello WildBuzzard"), "native element input and click");
            command("snapshot", params(two));
            JSONObject stale = call(new JSONObject().put("method", "act").put("params", params(two).put("kind", "click").put("target", button)).toString());
            check(stale.has("error"), "stale element reference rejected");
            check(evaluate(two, "return document.querySelector('#ad-test').dataset.result;").toString().contains("blocked"), "native adblock blocks bundled-list image fixture");
            command("tabs.setAdblocking", params(two).put("enabled", false));
            waitPage(two);
            check(evaluate(two, "return document.querySelector('#ad-test').dataset.result;").toString().contains("loaded"), "per-tab exception permits image fixture after reload");
            command("tabs.setDesktopMode", params(two).put("enabled", true));
            waitPage(two);
            check(!evaluate(two, "return navigator.userAgent;").toString().contains("Mobile"), "agent enables real desktop user agent");
            command("tabs.setDesktopMode", params(two).put("enabled", false));
            command("tabs.setAdblocking", params(two).put("enabled", true));
            waitPage(two);
            JSONObject restricted = call(new JSONObject().put("method", "navigate").put("params", params(two).put("url", "file:///data/system/packages.xml")).toString());
            check(restricted.has("error"), "agent cannot navigate to local files");
            command("tabs.close", params(two));
            command("capabilities", new JSONObject());
            check(true, "browser service survives closing the last owned tab");
            lastTab = ((JSONObject) command("tabs.create", new JSONObject().put("url", "http://127.0.0.1:8765/"))).getString("id");
            log("PASS: lifecycle/page suite completed");
        } catch (Throwable error) { log("FAIL: " + error); }
    }
    @Override protected void onDestroy() { unbindService(connection); worker.shutdownNow(); super.onDestroy(); }
}
