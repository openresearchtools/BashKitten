// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.content.*;
import android.graphics.Bitmap;
import android.net.Uri;
import androidx.core.content.FileProvider;
import java.io.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.json.*;

/** One dispatcher and ownership boundary for Android apps and shell programs. */
final class AgentController extends ContextWrapper {
    final BrowserApp app;
    final Map<String, AtomicInteger> pending = new ConcurrentHashMap<>();
    static final class Access {
        final String owner;
        final int uid;
        final Runnable check;
        final boolean shell;
        Access(String owner, int uid, Runnable check) { this(owner, uid, check, uid < 0); }
        Access(String owner, int uid, Runnable check, boolean shell) { this.owner = owner; this.uid = uid; this.check = check; this.shell = shell; }
    }
    AgentController(BrowserApp app) { super(app); this.app = app; }
    Access forUid(int uid) { return forUid(uid, "", false); }
    Access forUid(int uid, String session, boolean shell) {
        if (session.length() > 128 || (!session.isEmpty() && !session.matches("[A-Za-z0-9_.:-]+")))
            throw new IllegalArgumentException("Invalid session identifier");
        String identity = app.grants.require(uid);
        int generation = app.grants.generation.get(), revision = app.grants.revision(identity);
        String owner = identity + (session.isEmpty() ? "" : "\nsession:" + session);
        return new Access(owner, uid, () -> {
            if (generation != app.grants.generation.get() || revision != app.grants.revision(identity) ||
                !identity.equals(app.grants.require(uid))) throw new SecurityException("Caller changed or access revoked");
        }, shell);
    }
    void execute(Access access, String json, Consumer<String> callback) {
        access.check.run();
        if (callback == null || json == null || json.length() > 200000) throw new IllegalArgumentException("Invalid request");
        AtomicInteger count = pending.computeIfAbsent(access.owner, ignored -> new AtomicInteger());
        if (count.incrementAndGet() > 8) { count.decrementAndGet(); throw new IllegalStateException("Too many requests"); }
        app.main.post(() -> {
            boolean[] completed = {false};
            Runnable[] timeout = {null};
            Consumer<JSONObject> send = result -> {
                if (completed[0]) return;
                completed[0] = true; count.decrementAndGet();
                app.main.removeCallbacks(timeout[0]);
                String response;
                try { access.check.run(); response = result.toString(); }
                catch (SecurityException error) { response = "{\"error\":\"Access revoked\"}"; }
                if (response.length() > 200000) response = "{\"error\":\"Result too large; narrow the query\"}";
                callback.accept(response);
            };
            Consumer<String> fail = message -> {
                try { send.accept(new JSONObject().put("error", message)); } catch (JSONException ignored) {}
            };
            timeout[0] = () -> fail.accept("Request timed out");
            app.main.postDelayed(timeout[0], 210000);
            try { access.check.run(); run(new JSONObject(json), access, send, fail); }
            catch (Exception error) { fail.accept(error.getMessage() == null ? "Request failed" : error.getMessage()); }
        });
    }
    private void run(JSONObject request, Access access, Consumer<JSONObject> send, Consumer<String> fail) throws Exception {
        String owner = access.owner;
        int uid = access.uid;
        app.refresh();
        String method = request.getString("method");
        JSONObject params = request.optJSONObject("params"); if (params == null) params = new JSONObject();
        if (method.equals("capabilities")) {
            JSONArray methods = new JSONArray(Arrays.asList("tabs.list", "tabs.create", "tabs.close", "navigate", "back", "forward", "reload", "stop", "snapshot", "act", "read", "evaluate", "wait", "console", "clearConsole", "viewport", "screenshot", "tabs.setDesktopMode", "tabs.setAdblocking", "tabs.show", "diagnostics", "downloads.list", "downloads.accept", "downloads.get"));
            send.accept(new JSONObject().put("result", new JSONObject().put("protocol", 2).put("engine", "gecko")
                .put("authorization", uid < 0 ? "command-key" : app.grants.samePublisher(uid) ? "publisher-signature" : "user-grant")
                .put("androidAccessibilityService", false).put("debuggable", (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
                .put("methods", methods)
                .put("foreground", access.shell ? "tabs.show" : "Call showTab(tabId), then send its PendingIntent")
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
        if (method.equals("downloads.list") || method.equals("downloads.get")) {
            JSONArray list = new JSONArray();
            for (BrowserApp.Download download : app.host.downloads()) {
                app.rememberDownload(download.id, download.tabId);
                if (!app.ownsDownload(download.id, owner)) continue;
                if (method.equals("downloads.list")) list.put(download.json());
                else if (download.id.equals(params.getString("downloadId"))) {
                    if (!download.status.equals("COMPLETED")) throw new IllegalStateException("Download is not complete");
                    send.accept(new JSONObject().put("result", download.json().put("transfer",
                        app.transfers.grant(download.file, download.mime, false, access)))); return;
                }
            }
            if (method.equals("downloads.get")) throw new SecurityException("Download is not owned by this app/session");
            send.accept(new JSONObject().put("result", list)); return;
        }
        BrowserApp.Tab tab = app.owned(params.getString("tabId"), owner);
        if (!method.equals("tabs.close") && (tab.session == null || !tab.session.isOpen() || !tab.ready)) {
            app.ensure(tab, () -> {
                try { access.check.run(); run(request, access, send, fail); }
                catch (Exception error) { fail.accept("Restored tab is unavailable"); }
            }, fail);
            return;
        }
        params.remove("tabId");
        switch (method) {
            case "tabs.close": app.close(tab); break;
            case "tabs.show": send.accept(new JSONObject().put("result", new JSONObject().put("launch", app.commands.launch(access, tab.id)))); return;
            case "downloads.accept": app.host.acceptDownload(tab.id, params.getString("downloadId")); break;
            case "navigate": {
                String url = BrowserApp.webUrl(params.getString("url"));
                tab.session.loadUri(url); break;
            }
            case "back": tab.session.goBack(); break;
            case "forward": tab.session.goForward(); break;
            case "reload": tab.session.reload(); break;
            case "stop": tab.session.stop(); break;
            case "tabs.setDesktopMode": app.host.desktop(tab.id, params.getBoolean("enabled")); break;
            case "tabs.setAdblocking": app.setAdblock(tab, params.getBoolean("enabled"), send, fail); return;
            case "screenshot": {
                final boolean transfer = params.optBoolean("transfer");
                app.host.screenshot(tab.id, bitmap -> {
                    if (bitmap == null) { fail.accept("Show this tab before capturing a screenshot"); return; }
                    try {
                        access.check.run();
                        if (transfer) {
                            File directory = new File(getCacheDir(), "agent"); directory.mkdirs();
                            File file = new File(directory, UUID.randomUUID() + ".png");
                            try {
                                try (FileOutputStream out = new FileOutputStream(file)) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); }
                                send.accept(new JSONObject().put("result", new JSONObject().put("mimeType", "image/png")
                                    .put("width", bitmap.getWidth()).put("height", bitmap.getHeight())
                                    .put("transfer", app.transfers.grant(file, "image/png", true, access))));
                            } catch (Exception error) { file.delete(); throw error; }
                            return;
                        }
                        if (access.shell) {
                            ByteArrayOutputStream out = new ByteArrayOutputStream();
                            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
                            send.accept(new JSONObject().put("result", new JSONObject()
                                .put("base64", android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP))
                                .put("mimeType", "image/png")));
                            return;
                        }
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
                if (!Arrays.asList("snapshot", "act", "read", "evaluate", "wait", "console", "clearConsole", "viewport", "diagnostics").contains(method)) throw new IllegalArgumentException("Unsupported method");
                app.page(tab, method, params, send, fail); return;
        }
        send.accept(new JSONObject().put("result", true));
    }
}
