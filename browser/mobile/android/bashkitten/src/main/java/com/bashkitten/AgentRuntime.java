// SPDX-License-Identifier: GPL-3.0-only
package com.bashkitten;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import java.net.URI;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;
import org.mozilla.geckoview.*;

/** One application-owned Agent session. It is deliberately absent from the browser tab store. */
public final class AgentRuntime {
    public interface Listener { void changed(); }
    final BrowserApp app;
    public final TermuxConnection termux;
    private final SecretStore identities;
    private final Set<Listener> listeners = new HashSet<>();
    private GeckoRuntime engine;
    public GeckoSession session;
    public String state = "off", error = "", url = "", selected = "local";
    public JSONObject status = new JSONObject();
    private boolean launched, desired, busy, polling;
    private int operation;
    public boolean visible;
    java.lang.ref.WeakReference<Activity> activity = new java.lang.ref.WeakReference<>(null);
    private final Map<String, GeckoSession> sessions = new HashMap<>();
    private final Set<String> posted = new LinkedHashSet<>();
    private Runnable remoteAuthorizationCleanup;

    AgentRuntime(BrowserApp app) {
        this.app = app; termux = new TermuxConnection(app); identities = new SecretStore(app, "agent-identities");
        selected = app.policies.getString("agent.selected", "local");
    }
    public void attach(GeckoRuntime engine, Listener listener) {
        this.engine = engine; listeners.add(listener);
        if (!launched) { launched = true; turnOn(); }
        else listener.changed();
    }
    public void detach(Listener listener) { listeners.remove(listener); }
    void changed() { for (Listener listener : new ArrayList<>(listeners)) listener.changed(); }
    public void refresh() {
        if (!desired || busy || !selected.equals("local")) return;
        if (!termux.permissionGranted()) { setup("Allow BashKitten to connect to Termux."); return; }
        final int generation = operation;
        command("status", new JSONObject(), value -> {
            if (generation != operation || !desired) return;
            JSONObject web = value.optJSONObject("web");
            if (web == null || !web.optBoolean("running", !web.optString("url").isEmpty())) {
                fail("The Agent service stopped. Turn on to reconnect."); return;
            }
            acceptStatus(value);
        }, message -> { if (generation == operation) fail(message); });
    }
    public void freshLaunch() { if (!desired && !busy) turnOn(); }
    public void turnOn() {
        if (busy) return;
        desired = true; busy = true; operation++; state = "starting"; error = "";
        app.startForegroundService(new Intent(app, BrowserKeepAliveService.class).setAction(BrowserKeepAliveService.AGENT_ON));
        changed();
        if (!selected.equals("local")) { connectRemote(); return; }
        if (!termux.installed()) { setup("Install Termux to run Agent on this device."); return; }
        if (!termux.permissionGranted()) { setup("Connect Termux to start your local Agent."); return; }
        final int generation = operation;
        termux.probe(value -> {
            if (generation != operation || !desired) return;
            if (!value.optBoolean("packages")) { setup("Install the Agent packages in Termux."); return; }
            command("start", new JSONObject(), result -> {
                if (generation != operation || !desired) return;
                busy = false; acceptStatus(result); poll();
            }, message -> { if (generation == operation) setup(message); });
        }, message -> { if (generation == operation) setup(message); });
    }
    public void turnOff() {
        if (state.equals("stopping")) return;
        desired = false; busy = true; operation++; state = "stopping"; error = "";
        releaseRemoteAuthorization();
        if (session != null) suspendSession(session);
        app.remoteControl.disconnect();
        changed();
        if (!selected.equals("local")) { stopped(); return; }
        command("stop", new JSONObject(), value -> {
            if (value.optJSONObject("web") != null && value.optJSONObject("web").optString("status").equals("stopping")) { busy = false; state = "stopping"; error = "Packages are finishing. Retry when the transaction completes."; changed(); return; }
            stopped();
        }, message -> { busy = false; error = "Shutdown is not confirmed: " + message; state = "stop-failed"; changed(); });
    }
    private void stopped() {
        busy = false; state = "off"; error = ""; releaseWake(); changed();
    }
    private void releaseWake() {
        releaseRemoteAuthorization();
        app.startService(new Intent(app, BrowserKeepAliveService.class).setAction(BrowserKeepAliveService.AGENT_OFF));
    }
    private void releaseRemoteAuthorization() {
        Runnable cleanup = remoteAuthorizationCleanup; remoteAuthorizationCleanup = null;
        if (cleanup != null) cleanup.run();
    }
    private void setup(String message) { busy = false; state = "setup"; error = message; changed(); }
    private void fail(String message) { releaseRemoteAuthorization(); app.remoteControl.disconnect(); busy = false; desired = false; state = "failed"; error = message; releaseWake(); changed(); }
    public void command(String name, JSONObject args, Consumer<JSONObject> done, Consumer<String> fail) {
        try { termux.run(new JSONObject().put("command", name).put("args", args), done, fail); }
        catch (Exception exception) { fail.accept("Unable to send service command."); }
    }
    private void acceptStatus(JSONObject value) {
        try {
            status = value;
            JSONObject web = value.getJSONObject("web");
            String endpoint = web.getString("url");
            URI parsed = URI.create(endpoint);
            if (!parsed.getScheme().equals("https") || !parsed.getHost().equals("127.0.0.1") || parsed.getPort() < 1 || parsed.getUserInfo() != null) throw new SecurityException("Invalid local HTTPS endpoint.");
            JSONObject identity = web.getJSONObject("identity");
            rememberIdentity("local", identity);
            configure(endpoint, identity, false, 0);
            JSONObject auth = web.optJSONObject("auth");
            state = auth != null && (!auth.optBoolean("initialized") || auth.optBoolean("enrollmentRequired")) ? "enroll" : "on";
            busy = false; changed();
        } catch (Exception exception) { fail(exception.getMessage() == null ? "The service identity could not be verified." : exception.getMessage()); }
    }
    private void rememberIdentity(String name, JSONObject identity) throws Exception {
        String pem = identity.getString("caPem");
        byte[] der = java.util.Base64.getMimeDecoder().decode(pem.replace("-----BEGIN CERTIFICATE-----", "").replace("-----END CERTIFICATE-----", ""));
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(der)) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        String hash = hex.toString();
        if (!hash.equalsIgnoreCase(identity.getString("caSha256").replace(":", ""))) throw new SecurityException("The service certificate identity is invalid.");
        JSONObject stored = identities.read();
        JSONObject previous = stored.optJSONObject(name);
        if (previous != null && !hash.equalsIgnoreCase(previous.optString("caSha256").replace(":", ""))) throw new SecurityException("The saved Agent certificate changed. The connection was blocked.");
        stored.put(name, identity); identities.write(stored);
    }
    private void configure(String endpoint, JSONObject identity, boolean tor, int port) throws Exception {
        if (engine == null) throw new IllegalStateException("Browser engine is not ready.");
        GeckoSession next = sessions.get(selected);
        if (next == null) {
            next = new GeckoSession(new GeckoSessionSettings.Builder().contextId("bashkitten-agent-ui-" + selected).build());
            sessions.put(selected, next); next.open(engine);
            final GeckoSession hostSession = next;
            BashKittenController.setHostDelegate(next, (command, args, reply) -> hostCall(hostSession, command, args, reply));
        }
        session = next;
        if (!next.isOpen()) next.open(engine);
        final GeckoSession currentSession = next;
        BashKittenController.setHostDelegate(next, (command, args, reply) -> hostCall(currentSession, command, args, reply));
        JSONObject params = new JSONObject().put("url", endpoint).put("identity", identity).put("tor", tor).put("port", port).put("proxySecret", app.tor.proxySecret()).put("agentOrigin", URI.create(endpoint).getScheme() + "://" + URI.create(endpoint).getRawAuthority());
        final GeckoSession target = next;
        final int generation = operation;
        final String previousUrl = url;
        boolean needsLoad = !endpoint.equals(url) || !state.equals("on") || !target.isOpen();
        String request = new JSONObject().put("method", "agent.configure").put("params", params).toString();
        Runnable connect = () -> BashKittenController.request(target, request).accept(result -> {
            try {
                if (generation != operation || !desired || target != session) return;
                JSONObject reply = new JSONObject(result);
                if (reply.has("error")) throw new IllegalStateException(reply.getString("error"));
                boolean changedUrl = !endpoint.equals(url);
                url = endpoint;
                if (changedUrl || needsLoad) target.loadUri(endpoint);
                changed();
            } catch (Exception exception) { fail("Could not verify Agent connection: " + exception.getMessage()); }
        }, exception -> { if (generation == operation) fail("Could not configure the protected Agent connection."); });
        if (!previousUrl.isEmpty() && !previousUrl.equals(endpoint)) captureDraft(target, connect);
        else connect.run();
    }
    private void captureDraft(GeckoSession target, Runnable done) {
        BashKittenController.request(target, "{\"method\":\"agent.captureDraft\"}")
            .accept(ignored -> done.run(), ignored -> done.run());
    }
    private void suspendSession(GeckoSession target) {
        BashKittenController.setHostDelegate(target, null);
        final int generation = operation;
        captureDraft(target, () -> { if (target.isOpen() && (generation == operation || target != session)) { target.stop(); target.loadUri("about:blank"); } });
    }
    private void signIn() {
        app.remoteControl.disconnect();
        GeckoSession target = session;
        captureDraft(target, () -> { if (target == session && desired) target.loadUri(url + "/login"); });
    }
    public void recoverSession() {
        if (!desired) return;
        url = "";
        if (session != null && !session.isOpen() && engine != null) session.open(engine);
        if (selected.equals("local")) refresh(); else connectRemote();
    }
    public void select(String id) {
        if (selected.equals(id)) {
            if (!id.equals("local")) { busy = false; turnOn(); }
            return;
        }
        operation++; busy = false;
        releaseRemoteAuthorization();
        if (session != null) { suspendSession(session); session.setActive(false); }
        app.remoteControl.disconnect();
        selected = id; url = ""; session = null;
        app.policies.edit().putString("agent.selected", id).apply();
        turnOn();
    }
    public JSONObject remotes() throws Exception { return new SecretStore(app, "agent-remotes").read(); }
    public void saveRemote(JSONObject record) throws Exception {
        URI uri = URI.create(record.getString("url"));
        if (record.optInt("version") != 1 || !record.optString("kind").equals("agent") || !uri.getScheme().equals("https") || uri.getUserInfo() != null || !uri.getHost().matches("[a-z2-7]{56}\\.onion")) throw new IllegalArgumentException("Choose a valid Agent connection file.");
        String id = uri.getHost();
        new OnionKey(id, record.getString("clientAuthorization"));
        // Enrollment without a saved certificate is handled through the authenticated onion enrollment UI.
        if (!record.has("caPem")) throw new IllegalArgumentException("This connection requires its server certificate identity. Import the complete connection file.");
        rememberIdentity(id, record);
        SecretStore store = new SecretStore(app, "agent-remotes"); JSONObject all = store.read(); all.put(id, record); store.write(all);
    }
    public void enrollRemote(JSONObject record, Consumer<JSONObject> done, Consumer<String> failure) {
        try {
            URI endpoint = URI.create(record.getString("url"));
            if (record.optInt("version") != 1 || !record.optString("kind").equals("agent")
                    || !"https".equals(endpoint.getScheme()) || endpoint.getHost() == null
                    || !endpoint.getHost().matches("[a-z2-7]{56}\\.onion") || endpoint.getUserInfo() != null
                    || endpoint.getRawQuery() != null || endpoint.getRawFragment() != null
                    || (endpoint.getRawPath() != null && !endpoint.getRawPath().isEmpty() && !endpoint.getRawPath().equals("/"))
                    || endpoint.getPort() == 0 || endpoint.getPort() > 65535) throw new IllegalArgumentException();
            OnionKey key = new OnionKey(endpoint.getHost(), record.getString("clientAuthorization"));
            if (record.has("caPem")) { saveRemote(record); done.accept(record); return; }
            if (engine == null) throw new IllegalStateException("Open the browser before enrolling a remote Agent.");
            final int generation = operation;
            app.tor.authorizeTemporarily(key, (port, releaseKey) -> {
                if (generation != operation) { releaseKey.run(); failure.accept("Connection selection changed. Retry enrollment."); return; }
                String context = "bashkitten-agent-ui-enroll-" + UUID.randomUUID();
                GeckoSession enrollment = new GeckoSession(new GeckoSessionSettings.Builder().contextId(context).build());
                java.util.concurrent.atomic.AtomicBoolean finished = new java.util.concurrent.atomic.AtomicBoolean();
                Runnable cleanup = () -> {
                    if (enrollment.isOpen()) enrollment.close();
                    engine.getStorageController().clearDataForSessionContext(context);
                    releaseKey.run();
                };
                Runnable timeout = () -> {
                    if (!finished.compareAndSet(false, true)) return;
                    cleanup.run(); failure.accept("Remote identity verification timed out. No direct connection was made.");
                };
                try {
                    enrollment.open(engine);
                    JSONObject params = new JSONObject().put("url", record.getString("url"))
                            .put("caSha256", record.optString("caSha256", ""))
                            .put("tor", true).put("port", port).put("proxySecret", app.tor.proxySecret());
                    app.main.postDelayed(timeout, 60000);
                    BashKittenController.request(enrollment, new JSONObject().put("method", "agent.enroll").put("params", params).toString()).accept(result -> {
                        if (!finished.compareAndSet(false, true)) return;
                        app.main.removeCallbacks(timeout);
                        JSONObject accepted;
                        try {
                            if (generation != operation) throw new IllegalStateException("Connection selection changed. Retry enrollment.");
                            JSONObject reply = new JSONObject(result);
                            if (reply.has("error")) throw new IllegalStateException("The remote Agent identity could not be verified.");
                            JSONObject identity = reply.getJSONObject("result");
                            String expected = record.optString("caSha256", "").replace(":", "");
                            if (!expected.isEmpty() && !expected.equalsIgnoreCase(identity.getString("caSha256").replace(":", ""))) {
                                throw new SecurityException("The remote Agent certificate identity changed.");
                            }
                            accepted = new JSONObject(record.toString())
                                    .put("caPem", identity.getString("caPem")).put("caSha256", identity.getString("caSha256"));
                            if (identity.has("instanceId")) accepted.put("instanceId", identity.getString("instanceId"));
                            saveRemote(accepted);
                        } catch (Exception error) {
                            cleanup.run(); failure.accept("The remote Agent identity could not be verified or saved.");
                            return;
                        }
                        cleanup.run(); done.accept(accepted);
                    }, error -> {
                        if (!finished.compareAndSet(false, true)) return;
                        app.main.removeCallbacks(timeout); cleanup.run();
                        failure.accept("The remote Agent could not be reached securely through Tor.");
                    });
                } catch (Exception error) {
                    if (finished.compareAndSet(false, true)) {
                        app.main.removeCallbacks(timeout); cleanup.run(); failure.accept("Could not start remote Agent enrollment.");
                    }
                }
            }, failure);
        } catch (Exception error) { failure.accept("Choose a valid Agent connection and retry."); }
    }
    public void removeRemote(String id) throws Exception {
        if (id.equals("local")) throw new IllegalArgumentException("Local Agent cannot be removed.");
        SecretStore store = new SecretStore(app, "agent-remotes");
        JSONObject saved = store.read();
        if (!saved.has(id)) return;
        if (selected.equals(id)) {
            operation++; desired = false; busy = false;
            selected = "local"; url = ""; session = null;
            app.policies.edit().putString("agent.selected", "local").apply();
            stopped();
        }
        GeckoSession remote = sessions.remove(id);
        if (remote != null && remote.isOpen()) { remote.stop(); remote.close(); }
        if (engine != null) engine.getStorageController().clearDataForSessionContext("bashkitten-agent-ui-" + id);
        saved.remove(id); store.write(saved);
        JSONObject remembered = identities.read(); remembered.remove(id); identities.write(remembered);
        // The Tor client may also serve an independently enrolled ordinary private site. Removing
        // Agent never deletes that site's saved credential or stops its tabs.
        changed();
    }
    private void connectRemote() {
        releaseRemoteAuthorization();
        final int generation = ++operation;
        try {
            JSONObject record = remotes().getJSONObject(selected);
            URI uri = URI.create(record.getString("url"));
            app.tor.authorizeTemporarily(new OnionKey(uri.getHost(), record.getString("clientAuthorization")), (port, cleanup) -> {
                if (generation != operation || !desired) { cleanup.run(); return; }
                remoteAuthorizationCleanup = cleanup;
                try { configure(record.getString("url"), record, true, port); busy = false; state = "on"; changed(); }
                catch (Exception exception) { fail("Could not connect to remote Agent."); }
            }, message -> { if (generation == operation) fail(message); });
        } catch (Exception exception) { setup("Choose or import an Agent connection."); }
    }
    private void poll() {
        if (polling) return; polling = true;
        app.main.postDelayed(() -> {
            polling = false;
            if (!desired || !selected.equals("local")) return;
            refresh();
            if (app.policies.getBoolean("agent.notifications", false)) command("notifications", new JSONObject(), value -> {
                JSONArray notifications = value.optJSONArray("notifications");
                if (notifications == null) notifications = value.optJSONArray("pending");
                if (notifications == null) return;
                JSONArray keys = new JSONArray();
                for (int i = 0; i < notifications.length(); i++) {
                    JSONObject notification = notifications.optJSONObject(i);
                    if (notification != null && notifyTurn(notification)) keys.put(notification.optString("key", notification.optString("id")));
                }
                if (keys.length() > 0) try { command("notifications-ack", new JSONObject().put("keys", keys), ignored -> {}, ignored -> {}); } catch (JSONException ignored) {}
            }, ignored -> {});
            poll();
        }, visible ? 30000 : 15000);
    }
    private void hostCall(GeckoSession source, String command, String json, Consumer<String> reply) {
        if (source != session || !desired || !state.equals("on")) { reply.accept("{\"error\":\"Agent connection is not active.\"}"); return; }
        try {
            JSONObject args = new JSONObject(json);
            if (command.equals("notify-turn")) { reply.accept(new JSONObject().put("result", notifyTurn(args)).toString()); return; }
            if (command.equals("sign-in")) { signIn(); reply.accept("{\"result\":true}"); return; }
            if (command.equals("import-remote")) {
                Activity current = activity.get();
                if (current == null) throw new IllegalStateException("Open BashKitten to import a remote.");
                current.startActivity(new Intent(current, AgentRemotesActivity.class)); reply.accept("{\"result\":true}"); return;
            }
            if (!command.equals("notification-settings")) throw new SecurityException("Unsupported browser action.");
            if (args.has("enabled")) {
                app.policies.edit().putBoolean("agent.notifications", args.optBoolean("enabled"))
                    .putBoolean("agent.notifications.hidden", args.optBoolean("onlyWhenHidden", true))
                    .putBoolean("agent.notifications.preview", args.optBoolean("preview", true)).apply();
                Activity current = activity.get();
                if (args.optBoolean("enabled") && current != null && Build.VERSION.SDK_INT >= 33) current.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, AgentPanel.NOTIFICATION_PERMISSION);
                if (selected.equals("local")) command("notification-settings", new JSONObject().put("settings", args), ignored -> {}, ignored -> {});
            }
            boolean permitted = Build.VERSION.SDK_INT < 33 || app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            JSONObject result = new JSONObject().put("enabled", permitted && app.policies.getBoolean("agent.notifications", false))
                .put("onlyWhenHidden", app.policies.getBoolean("agent.notifications.hidden", true)).put("preview", app.policies.getBoolean("agent.notifications.preview", true));
            reply.accept(new JSONObject().put("result", result).toString());
        } catch (Exception exception) { try { reply.accept(new JSONObject().put("error", exception.getMessage()).toString()); } catch (JSONException ignored) {} }
    }
    public boolean notifyTurn(JSONObject value) {
        if (!app.policies.getBoolean("agent.notifications", false)) return false;
        if (Build.VERSION.SDK_INT >= 33 && app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        String key = value.optString("key", value.optString("id"));
        if (key.isEmpty()) return false;
        if (posted.contains(key)) return true;
        posted.add(key); if (posted.size() > 512) posted.remove(posted.iterator().next());
        if (visible && app.policies.getBoolean("agent.notifications.hidden", true)) return true;
        NotificationManager manager = app.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("agent-turns", "Agent completed turns", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(app, 5, app.host.launchIntent().putExtra("bashkitten.openAgent", true), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String body = app.policies.getBoolean("agent.notifications.preview", true) ? value.optString("text", value.optString("body", "Turn completed")) : "Turn completed";
        if (body.length() > 500) body = body.substring(0, 500);
        manager.notify(key, 2, new Notification.Builder(app, "agent-turns").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(value.optString("title", "BashKitten")).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setContentIntent(open).setAutoCancel(true).build());
        return true;
    }
}
