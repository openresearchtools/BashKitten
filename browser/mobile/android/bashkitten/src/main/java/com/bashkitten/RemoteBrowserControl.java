// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.app.Activity;
import androidx.appcompat.app.AlertDialog;
import java.net.URI;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.BashKittenController;

/** User-approved outbound control over the selected Agent's authenticated HTTPS context. */
final class RemoteBrowserControl {
    private final BrowserApp app;
    private final java.util.concurrent.ExecutorService files = java.util.concurrent.Executors.newSingleThreadExecutor();
    private final Set<String> completed = new HashSet<>();
    private GeckoSession session;
    private String origin, csrf, channel;
    private volatile int generation;
    private volatile boolean active;
    private AgentController.Access access;
    RemoteBrowserControl(BrowserApp app) { this.app = app; }
    boolean active() { return active; }
    void authorize(Activity activity, GeckoSession selected, String address, String name) {
        disconnect();
        try {
            URI endpoint = URI.create(address);
            if (!"https".equals(endpoint.getScheme()) || endpoint.getUserInfo() != null ||
                    selected == null || !selected.isOpen() || selected.getSettings().getContextId() == null ||
                    !selected.getSettings().getContextId().startsWith("bashkitten-agent-ui-"))
                throw new IllegalArgumentException("Select an enrolled Agent server first");
            String serverOrigin = new URI(endpoint.getScheme(), null, endpoint.getHost(), endpoint.getPort(), null, null, null).toString();
            int version = generation;
            new AlertDialog.Builder(activity).setTitle("Allow this Agent to control your browser?")
                .setMessage(name + " (" + serverOrigin + ") can read and act in ordinary browsing tabs, including signed-in pages. Agent and login views remain protected. Disconnecting, signing out or switching servers revokes this connection.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Allow", (dialog, which) -> {
                    if (version != generation) return;
                    session = selected; origin = serverOrigin; active = true;
                    access = new AgentController.Access("remote:" + serverOrigin, -1, () -> {
                        if (!active || version != generation || session != selected || !selected.isOpen())
                            throw new SecurityException("Remote browser access revoked");
                    }, true);
                    connect(version, name);
                }).show();
        } catch (Exception error) { app.message(error.getMessage()); }
    }
    private void connect(int version, String name) {
        request(version, "/api/bootstrap", null, bootstrap -> {
            try {
                if (!bootstrap.optBoolean("authenticated")) throw new IllegalStateException("Sign in to the selected Agent first");
                csrf = bootstrap.getString("csrf");
                app.controller.execute(access, "{\"method\":\"capabilities\"}", reply -> {
                    try {
                        JSONObject capabilities = new JSONObject(reply).getJSONObject("result");
                        String client = app.policies.getString("remote-control-client", null);
                        if (client == null) {
                            client = UUID.randomUUID().toString();
                            app.policies.edit().putString("remote-control-client", client).apply();
                        }
                        JSONObject body = new JSONObject().put("clientId", client).put("name", "BashKitten Android")
                            .put("platform", "android").put("capabilities", capabilities);
                        request(version, "/api/browser-channel/open", body, result -> {
                            try { channel = result.getString("channelId"); poll(version); }
                            catch (Exception error) { failed(version, "Agent did not open a browser connection"); }
                        });
                    } catch (Exception error) { failed(version, "Browser capabilities are unavailable"); }
                });
            } catch (Exception error) { failed(version, error.getMessage()); }
        });
    }
    private void poll(int version) {
        try {
            request(version, "/api/browser-channel/poll", new JSONObject().put("channelId", channel), result -> {
                try {
                    JSONArray commands = result.getJSONArray("commands");
                    if (commands.length() > 8) throw new IllegalArgumentException("Too many remote browser commands");
                    next(version, commands, 0);
                } catch (Exception error) { failed(version, "Invalid Agent browser command"); }
            });
        } catch (Exception error) { failed(version, "Agent browser connection closed"); }
    }
    private void next(int version, JSONArray commands, int index) {
        if (!active || version != generation) return;
        if (index == commands.length()) { poll(version); return; }
        try {
            JSONObject command = commands.getJSONObject(index);
            String id = command.getString("id");
            if (id.length() > 128 || !completed.add(id) || completed.size() > 4096)
                throw new IllegalArgumentException("Duplicate or excessive Agent command");
            JSONObject request = new JSONObject().put("method", command.getString("method"))
                .put("params", command.optJSONObject("params") == null ? new JSONObject() : command.getJSONObject("params"));
            if (request.getString("method").equals("screenshot")) request.getJSONObject("params").remove("transfer");
            app.controller.execute(access, request.toString(), response -> {
                if (!active || version != generation) return;
                try {
                    JSONObject value = new JSONObject(response);
                    JSONObject result = value.optJSONObject("result");
                    if (result != null && result.has("launch")) {
                        app.commands.show(result.getString("launch")); value.put("result", true);
                    }
                    if (result != null && result.has("transfer")) {
                        exportFile(version, result, exported -> {
                            try { value.put("result", exported); reply(version, id, value, commands, index); }
                            catch (Exception error) { failed(version, "Agent file response failed"); }
                        }, error -> {
                            try { reply(version, id, new JSONObject().put("error", error), commands, index); }
                            catch (Exception invalid) { failed(version, "Agent file response failed"); }
                        });
                    } else reply(version, id, value, commands, index);
                } catch (Exception error) { failed(version, "Agent browser response failed"); }
            });
        } catch (Exception error) { failed(version, error.getMessage()); }
    }
    private void reply(int version, String id, JSONObject value, JSONArray commands, int index) throws Exception {
        value.put("channelId", channel).put("id", id);
        request(version, "/api/browser-channel/result", value, ignored -> next(version, commands, index + 1));
    }
    private void exportFile(int version, JSONObject result, Consumer<JSONObject> done, Consumer<String> fail) {
        files.execute(() -> {
            java.net.HttpURLConnection connection = null;
            try {
                JSONObject transfer = result.getJSONObject("transfer");
                URI endpoint = URI.create(transfer.getString("url"));
                String token = transfer.getString("token");
                if (!"http".equals(endpoint.getScheme()) || !"127.0.0.1".equals(endpoint.getHost()) ||
                        endpoint.getPort() < 1 || endpoint.getUserInfo() != null || endpoint.getQuery() != null || endpoint.getFragment() != null ||
                        !endpoint.getPath().matches("/files/[a-f0-9-]{36}") || !token.matches("[a-f0-9]{64}"))
                    throw new SecurityException("Invalid browser file transfer");
                long limit = 23L * 1024 * 1024;
                if (transfer.getLong("size") > limit) throw new IllegalArgumentException("File exceeds the 23 MiB remote transfer limit; download it on this device");
                connection = (java.net.HttpURLConnection) endpoint.toURL().openConnection();
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(5000); connection.setReadTimeout(30000);
                connection.setRequestProperty("Authorization", "Bearer " + token);
                if (!active || version != generation || connection.getResponseCode() != 200) throw new SecurityException("Browser file transfer revoked");
                try (java.io.InputStream input = connection.getInputStream(); java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (!active || version != generation) throw new SecurityException("Browser control revoked");
                        if ((long) output.size() + count > limit) throw new IllegalArgumentException("File exceeds the 23 MiB remote transfer limit");
                        output.write(buffer, 0, count);
                    }
                    if (output.size() != transfer.getLong("size")) throw new java.io.IOException("Incomplete browser file transfer");
                    JSONObject file = new JSONObject().put("data", android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP))
                        .put("mimeType", transfer.getString("mimeType")).put("name", result.optString("name", "download"))
                        .put("size", output.size());
                    app.main.post(() -> { if (active && version == generation) done.accept(file); });
                }
            } catch (Exception error) {
                String message = error.getMessage() == null ? "Browser file transfer failed" : error.getMessage();
                app.main.post(() -> { if (active && version == generation) fail.accept(message); });
            } finally { if (connection != null) connection.disconnect(); }
        });
    }
    private void request(int version, String path, JSONObject body, Consumer<JSONObject> done) {
        if (!active || version != generation) return;
        send(session, origin, csrf, path, body, result -> {
            if (!active || version != generation) return;
            try { access.check.run(); done.accept(result); }
            catch (Exception error) { failed(version, error.getMessage()); }
        }, message -> failed(version, message));
    }
    private void send(GeckoSession view, String endpoint, String token, String path, JSONObject body,
            Consumer<JSONObject> done, Consumer<String> fail) {
        try {
            JSONObject params = new JSONObject().put("origin", endpoint).put("path", path);
            if (body != null) params.put("body", body);
            if (token != null) params.put("csrf", token);
            BashKittenController.request(view, new JSONObject().put("method", "agent.request").put("params", params).toString())
                .accept(text -> {
                    try {
                        JSONObject response = new JSONObject(text);
                        if (response.has("error")) { fail.accept(response.getString("error")); return; }
                        done.accept(response.getJSONObject("result"));
                    } catch (Exception error) { fail.accept("Invalid Agent channel response"); }
                }, error -> fail.accept("Agent browser connection closed"));
        } catch (Exception error) { fail.accept("Agent browser connection closed"); }
    }
    private void failed(int version, String message) {
        if (version != generation || !active) return;
        disconnect();
        app.message((message == null ? "Agent connection closed" : message) + ". Browser control is off; allow it again to reconnect.");
    }
    void disconnect() {
        GeckoSession previous = session;
        String previousOrigin = origin, previousToken = csrf, previousChannel = channel;
        generation++; active = false; session = null; origin = csrf = channel = null; access = null; completed.clear();
        if (previous == null || !previous.isOpen()) return;
        try {
            BashKittenController.request(previous, "{\"method\":\"agent.cancel\"}").accept(ignored -> {
                if (previousChannel == null || !previous.isOpen()) return;
                try { send(previous, previousOrigin, previousToken, "/api/browser-channel/close",
                    new JSONObject().put("channelId", previousChannel), result -> {}, error -> {}); }
                catch (Exception ignoredError) { }
            }, error -> {});
        } catch (Exception ignored) { }
    }
}
