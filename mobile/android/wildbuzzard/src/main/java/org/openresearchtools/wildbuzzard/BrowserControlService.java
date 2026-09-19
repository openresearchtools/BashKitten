// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.*;
import androidx.core.content.FileProvider;
import java.io.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.json.*;
import org.openresearchtools.wildbuzzard.api.*;

public final class BrowserControlService extends Service {
    BrowserApp app;
    final Map<Integer, AtomicInteger> pending = new ConcurrentHashMap<>();
    @Override public void onCreate() {
        super.onCreate(); app = BrowserApp.get(this);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        stopSelf(startId);
        return START_NOT_STICKY;
    }
    private final IAgentBrowser.Stub binder = new IAgentBrowser.Stub() {
        @Override public PendingIntent requestAccess() { return app.grants.request(Binder.getCallingUid()); }
        @Override public PendingIntent showTab(String id) {
            int uid = Binder.getCallingUid(); String owner = app.grants.require(uid);
            // The non-exported activation activity rechecks ownership on the UI thread.
            return PendingIntent.getActivity(BrowserControlService.this, 0,
                new Intent(BrowserControlService.this, ActivateTabActivity.class).setData(Uri.parse("wildbuzzard-tab:" + UUID.randomUUID()))
                    .putExtra("tab", id).putExtra("owner", owner).putExtra("uid", uid),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT);
        }
        @Override public void execute(String json, IAgentCallback callback) {
            int uid = Binder.getCallingUid();
            String owner = app.grants.require(uid);
            if (callback == null || json == null || json.length() > 200000) throw new IllegalArgumentException("Invalid request");
            AtomicInteger count = pending.computeIfAbsent(uid, ignored -> new AtomicInteger());
            if (count.incrementAndGet() > 8) { count.decrementAndGet(); throw new IllegalStateException("Too many requests"); }
            app.main.post(() -> {
                boolean[] completed = {false};
                Consumer<JSONObject> send = result -> {
                    if (completed[0]) return; completed[0] = true; count.decrementAndGet();
                    try {
                        app.grants.require(uid);
                        String response = result.toString();
                        if (response.length() > 200000) response = "{\"error\":\"Result too large; narrow the query\"}";
                        callback.onResult(response);
                    } catch (Exception ignored) {}
                };
                Consumer<String> fail = message -> {
                    try { send.accept(new JSONObject().put("error", message)); } catch (JSONException ignored) {}
                };
                app.main.postDelayed(() -> fail.accept("Request timed out"), 100000);
                try {
                    app.grants.require(uid);
                    run(new JSONObject(json), owner, uid, send, fail);
                } catch (Exception error) { fail.accept(error.getMessage() == null ? "Request failed" : error.getMessage()); }
            });
        }
    };
    @Override public IBinder onBind(Intent intent) { return binder; }
    private void run(JSONObject request, String owner, int uid, Consumer<JSONObject> send, Consumer<String> fail) throws Exception {
        app.refresh();
        String method = request.getString("method");
        JSONObject params = request.optJSONObject("params"); if (params == null) params = new JSONObject();
        if (method.equals("capabilities")) {
            send.accept(new JSONObject().put("result", new JSONObject().put("protocol", 1).put("engine", "gecko")
                .put("methods", new JSONArray(Arrays.asList("tabs.list", "tabs.create", "tabs.close", "navigate", "back", "forward", "reload", "stop", "snapshot", "act", "read", "evaluate", "wait", "console", "clearConsole", "viewport", "screenshot", "tabs.setDesktopMode", "tabs.setAdblocking")))
                .put("foreground", "Call showTab(tabId), then send its PendingIntent")
                .put("source", "https://github.com/openresearchtools/wildbuzzard-android")));
            return;
        }
        if (method.equals("tabs.list")) {
            JSONArray list = new JSONArray();
            for (BrowserApp.Tab tab : app.tabs.values()) if (tab.owner.equals(owner)) list.put(tab.json());
            send.accept(new JSONObject().put("result", list)); return;
        }
        if (method.equals("tabs.create")) {
            String url = params.optString("url", "about:blank");
            if (!url.equals("about:blank")) url = BrowserApp.webUrl(url);
            app.create(owner, params.optBoolean("tor"), url, tab -> {
                try { send.accept(new JSONObject().put("result", tab.json())); } catch (Exception error) { fail.accept("Could not return tab"); }
            }, fail); return;
        }
        BrowserApp.Tab tab = app.owned(params.getString("tabId"), owner);
        params.remove("tabId");
        switch (method) {
            case "tabs.close": app.close(tab); break;
            case "navigate": {
                String url = BrowserApp.webUrl(params.getString("url"));
                if (BrowserApp.onion(url) && !tab.tor) throw new IllegalArgumentException("Create a Tor tab for onion navigation");
                tab.session.loadUri(url); break;
            }
            case "back": tab.session.goBack(); break;
            case "forward": tab.session.goForward(); break;
            case "reload": tab.session.reload(); break;
            case "stop": tab.session.stop(); break;
            case "tabs.setDesktopMode": app.host.desktop(tab.id, params.getBoolean("enabled")); break;
            case "tabs.setAdblocking": app.setAdblock(tab, params.getBoolean("enabled"), send, fail); return;
            case "screenshot": {
                app.host.screenshot(tab.id, bitmap -> {
                    if (bitmap == null) { fail.accept("Show this tab before capturing a screenshot"); return; }
                    try {
                        File directory = new File(getCacheDir(), "agent"); directory.mkdirs();
                        File file = new File(directory, UUID.randomUUID() + ".png");
                        try (FileOutputStream out = new FileOutputStream(file)) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); }
                        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", file);
                        String[] packages = getPackageManager().getPackagesForUid(uid);
                        if (packages != null) for (String name : packages) grantUriPermission(name, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        send.accept(new JSONObject().put("result", new JSONObject().put("uri", uri.toString()).put("mimeType", "image/png")));
                        app.main.postDelayed(() -> { revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); file.delete(); }, 300000);
                    } catch (Exception error) { fail.accept("Screenshot failed"); }
                }); return;
            }
            default:
                if (!Arrays.asList("snapshot", "act", "read", "evaluate", "wait", "console", "clearConsole", "viewport").contains(method)) throw new IllegalArgumentException("Unsupported method");
                app.page(tab, method, params, send, fail); return;
        }
        send.accept(new JSONObject().put("result", true));
    }
}
