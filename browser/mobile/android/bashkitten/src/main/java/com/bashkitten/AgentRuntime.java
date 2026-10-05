// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;
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
    private boolean launched, desired, busy, polling, localControlRequested, termuxSetupAttempted;
    private int operation;
    public boolean visible;
    public String setupStep = "";
    public boolean permissionPromptPending;
    public boolean permissionRequestInFlight;
    public boolean batteryPromptPending;
    public String batteryPackage = "", batteryRequestInFlight = "";
    private final Set<String> batteryDeferred = new HashSet<>();
    java.lang.ref.WeakReference<Activity> activity = new java.lang.ref.WeakReference<>(null);
    private final Map<String, GeckoSession> sessions = new HashMap<>();
    private final Set<String> posted = new LinkedHashSet<>();
    private Runnable remoteAuthorizationCleanup;
    private final Map<String, RemoteAgentConnection> remoteConnections = new HashMap<>();
    private final Map<String, JSONObject> serviceSnapshots = new HashMap<>();
    private char[] remotePassword;
    private String remotePasswordHost = "";
    private JSONObject localSession;
    private boolean localSessionPending;
    private boolean reloadOnConnect;

    AgentRuntime(BrowserApp app) {
        this.app = app; termux = new TermuxConnection(app); identities = new SecretStore(app, "agent-identities");
        selected = app.policies.getString("agent.selected", "local");
        boolean previousIdentity;
        try { previousIdentity = identities.read().has("local"); }
        catch (Exception error) { previousIdentity = true; }
        localControlRequested = app.policies.getBoolean("agent.localControlRequested", previousIdentity);
        termuxSetupAttempted = app.policies.getBoolean("agent.termuxSetupAttempted", previousIdentity);
    }
    public void attach(GeckoRuntime engine, Listener listener) {
        this.engine = engine; listeners.add(listener);
        if (!launched) { launched = true; turnOn(); }
        else listener.changed();
    }
    public void observe(Listener listener) { listeners.add(listener); }
    public void detach(Listener listener) { listeners.remove(listener); }
    void changed() { for (Listener listener : new ArrayList<>(listeners)) listener.changed(); }
    public void refresh() {
        if (!desired || busy || !selected.equals("local")) return;
        if (!termux.installationId().equals(app.policies.getString("agent.termuxInstallation", ""))) { turnOn(); return; }
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
    public boolean isOnRequested() { return desired; }
    private void recordLocalControl(boolean requested) {
        localControlRequested = requested;
        app.policies.edit().putBoolean("agent.localControlRequested", requested).apply();
    }
    public void freshLaunch(Intent intent) {
        if (intent.getBooleanExtra(TermuxConnection.SETUP_COMPLETE, false)) {
            // This only requests a real bridge probe. It never grants permission
            // or accepts a command, account or service identity from the intent.
            termuxSetupAttempted = true;
            app.policies.edit().putBoolean("agent.termuxSetupAttempted", true).apply();
        }
        if (!busy && (!desired || state.equals("setup"))) turnOn();
    }
    public void turnOn() {
        if (busy) return;
        if (!desired) batteryDeferred.clear();
        // Turn off suspends the protected document at about:blank. Its saved
        // endpoint can stay unchanged when the verified service starts again.
        reloadOnConnect = true;
        desired = true; busy = true; operation++; state = "starting"; error = "";
        app.startForegroundService(new Intent(app, BrowserKeepAliveService.class).setAction(BrowserKeepAliveService.AGENT_ON));
        changed();
        if (!selected.equals("local")) { if (!needsBatteryPermission()) connectRemote(); return; }
        final int generation = operation;
        String installation = termux.installationId();
        String previous = app.policies.getString("agent.termuxInstallation", "");
        Runnable proceed = () -> {
            if (generation != operation || !desired || !selected.equals("local")) return;
            app.policies.edit().putString("agent.termuxInstallation", installation).apply();
            startLocal(generation);
        };
        // Only OS installation state and a real bridge probe can reset Local.
        // An exported setup-complete intent alone must never replace its TLS pin.
        if (installation.isEmpty() || !termuxSetupAttempted
                || (!previous.isEmpty() && !previous.equals(installation))) resetLocalSetup(proceed);
        // Older versions did not bind their saved Local connection to an OS
        // installation. Re-enroll once through the permission-checked Termux
        // bridge, including when Termux was reinstalled before this APK update.
        else if (previous.isEmpty()) resetLocalConnection(proceed);
        else proceed.run();
    }
    private void startLocal(int generation) {
        if (!termux.installed()) {
            recordLocalControl(false); termuxSetupAttempted = false;
            app.policies.edit().remove("agent.termuxSetupAttempted").apply();
            setup("termux", "Install Termux to run Agent on this device."); return;
        }
        if (!termuxSetupAttempted) { setup("connection", "Set up Agent in Termux with the command below."); return; }
        if (!termux.permissionGranted()) { permissionPromptPending = true; setup("permission", "Allow BashKitten to run your Agent in Termux."); return; }
        termux.probe(value -> {
            if (generation != operation || !desired) return;
            if (!value.optBoolean("packages")) {
                resetLocalSetup(() -> {
                    if (generation == operation && desired) setup("connection", "Install Agent with the command below in Termux.");
                });
                return;
            }
            if (needsBatteryPermission()) return;
            recordLocalControl(true);
            command("start", new JSONObject(), result -> {
                if (generation != operation || !desired) return;
                busy = false; acceptStatus(result); poll();
            }, message -> { if (generation == operation) setup(message); });
        }, message -> { if (generation == operation) setup("connection", message); });
    }
    private void resetLocalSetup(Runnable done) {
        resetLocalConnection(() -> {
            recordLocalControl(false); termuxSetupAttempted = false;
            app.policies.edit().remove("agent.termuxSetupAttempted").remove("agent.termuxSetupPending").apply();
            done.run();
        });
    }
    private void resetLocalConnection(Runnable done) {
        try {
            JSONObject remembered = identities.read(); remembered.remove("local"); identities.write(remembered);

            app.remoteControl.disconnect();
            GeckoSession local = sessions.remove("local");
            if (session == local) { session = null; url = ""; }
            if (local != null && local.isOpen()) { local.stop(); local.close(); }
            localSession = null; localSessionPending = false; status = new JSONObject();
            if (engine != null) engine.getStorageController().clearDataForSessionContext("bashkitten-agent-ui-local");
            done.run();
        } catch (Exception failure) { fail("Could not reset the previous local connection. Turn on to retry."); }
    }
    public boolean batteryExempt(String packageName) {
        return app.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(packageName);
    }
    private boolean needsBatteryPermission() {
        String[] packages = selected.equals("local")
            ? new String[]{app.getPackageName(), TermuxConnection.PACKAGE}
            : new String[]{app.getPackageName()};
        for (String packageName : packages) {
            if (batteryDeferred.contains(packageName) || batteryExempt(packageName)) continue;
            batteryPackage = packageName;
            batteryPromptPending = batteryRequestInFlight.isEmpty();
            setup("battery", "Allow " + (packageName.equals(TermuxConnection.PACKAGE) ? "Termux" : "BashKitten")
                + " to run in the background so Agent can keep working when the screen is off. Android will ask for approval.");
            return true;
        }
        batteryPackage = ""; batteryPromptPending = false;
        return false;
    }
    public void batteryPermissionReturned() {
        String requested = batteryRequestInFlight; batteryRequestInFlight = "";
        if (requested.isEmpty() || !desired || !state.equals("setup") || !setupStep.equals("battery")) return;
        if (!requested.equals(batteryPackage) || batteryExempt(requested)) { turnOn(); return; }
        batteryPermissionFailed("Background battery access was not allowed. Allow it to keep Agent working with the screen off, or continue with Android's battery restrictions.");
    }
    public void batteryPermissionFailed(String message) {
        batteryRequestInFlight = ""; batteryPromptPending = false;
        if (desired && state.equals("setup") && setupStep.equals("battery")) setup("battery", message);
    }
    public void retryBatteryPermission() {
        if (!desired || !state.equals("setup") || !setupStep.equals("battery") || !batteryRequestInFlight.isEmpty()) return;
        batteryPromptPending = true; changed();
    }
    public void deferBatteryPermission() {
        if (!desired || !state.equals("setup") || !setupStep.equals("battery") || !batteryRequestInFlight.isEmpty()) return;
        batteryDeferred.add(batteryPackage); turnOn();
    }
    public void turnOff() {
        if (state.equals("stopping")) return;
        boolean termuxInstalled = termux.installed();
        if (!termuxInstalled) recordLocalControl(false);
        boolean setupWithoutService = state.equals("setup") && (!termuxInstalled || !localControlRequested);
        desired = false; busy = true; operation++; state = "stopping"; error = "";
        closeRemoteConnections();
        releaseRemoteAuthorization();

        if (session != null) suspendSession(session);
        app.remoteControl.disconnect();
        changed();
        if ((!selected.equals("local") && !localControlRequested) || setupWithoutService || !termuxInstalled) { stopped(); return; }
        requestStop(operation);
    }
    private void requestStop(int generation) {
        command("stop", new JSONObject(), value -> stopStatus(generation, value), message -> stopFailed(generation, message));
    }
    private void stopStatus(int generation, JSONObject value) {
        if (generation != operation || desired || !state.equals("stopping")) return;
        status = value;
        JSONObject web = value.optJSONObject("web");
        if (web == null) { stopFailed(generation, "The service returned no shutdown status."); return; }
        String webState = web.optString("status");
        if (webState.equals("stopped") || webState.equals("error")) {
            recordLocalControl(false);
            stopped();
            return;
        }
        error = webState.equals("stopping") ? "Finishing the current package transaction before stopping…" : "Stopping Agent…";
        changed();
        // One callback chain observes the durable controller transaction. Never terminate dpkg.
        app.main.postDelayed(() -> {
            if (generation != operation || desired || !state.equals("stopping")) return;
            requestStop(generation);
        }, 2000);
    }
    private void stopFailed(int generation, String message) {
        if (generation != operation || desired) return;
        busy = false; error = "Shutdown is not confirmed: " + message; state = "stop-failed"; changed();
    }
    private void stopped() {
        busy = false; state = "off"; error = ""; releaseWake(); changed();
    }
    private void releaseWake() {
        closeRemoteConnections();
        releaseRemoteAuthorization();
        app.startService(new Intent(app, BrowserKeepAliveService.class).setAction(BrowserKeepAliveService.AGENT_OFF));
    }
    private void releaseRemoteAuthorization() {
        Runnable cleanup = remoteAuthorizationCleanup; remoteAuthorizationCleanup = null;
        if (cleanup != null) cleanup.run();
    }
    private void setup(String message) { setup("retry", message); }
    private void setup(String step, String message) { busy = false; state = "setup"; setupStep = step; error = message; changed(); }
    private void fail(String message) {
        releaseRemoteAuthorization(); app.remoteControl.disconnect();
        // A failed Local startup must not take away another enrollment's
        // service ports while Local Pi/setup is selected.
        if (selected.equals("local") && !remoteConnections.isEmpty()) { setup("retry", message); return; }
        busy = false; desired = false; state = "failed"; error = message; releaseWake(); changed();
    }
    public void command(String name, JSONObject args, Consumer<JSONObject> done, Consumer<String> fail) {
        try { termux.run(new JSONObject().put("command", name).put("args", args), done, fail); }
        catch (Exception exception) { fail.accept("Unable to send service command."); }
    }
    boolean shareNeedsSetup() {
        if (!desired || !termuxSetupAttempted || !termux.permissionGranted()
            || !termux.installationId().equals(app.policies.getString("agent.termuxInstallation", ""))) return true;
        for (String name : new String[]{app.getPackageName(), TermuxConnection.PACKAGE}) {
            if (!batteryDeferred.contains(name) && !batteryExempt(name)) return true;
        }
        return false;
    }
    // Native Share Local can adopt this phone's host without switching an active
    // remote document. Missing permissions/setup use the existing Local flow.
    void startShareLocal(Runnable done, Consumer<String> failure) {
        if (shareNeedsSetup()) { failure.accept("Complete Local setup before publishing this device."); return; }
        final int generation = operation;
        recordLocalControl(true);
        command("start", new JSONObject(), result -> {
            if (generation != operation || !desired) { failure.accept("Agent changed while starting Share Local. Retry from its current state."); return; }
            try {
                JSONObject web = result.getJSONObject("web");
                if (!web.getJSONObject("auth").optString("mode").equals("native-local"))
                    throw new IllegalStateException("Update BashKitten packages in Termux to use account-free Local and Share Local.");
                rememberIdentity("local", web.getJSONObject("identity"));
                if (selected.equals("local")) { acceptStatus(result); poll(); }
                done.run();
            } catch (Exception error) { failure.accept(error.getMessage()); }
        }, failure);
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
            JSONObject auth = web.optJSONObject("auth");
            if (auth != null && auth.optString("mode").equals("native-local")) {
                String sessionGeneration = auth.getString("generation");
                if (localSession == null || !localSession.optString("generation").equals(sessionGeneration)) {
                    if (localSessionPending) return;
                    localSessionPending = true;
                    final int requestedOperation = operation;
                    command("local-session", new JSONObject(), result -> {
                        localSessionPending = false;
                        if (requestedOperation != operation || !desired || !selected.equals("local")) return;
                        try {
                            JSONObject actualIdentity = result.getJSONObject("identity");
                            JSONObject cookie = result.getJSONObject("cookie");
                            String expectedName = "__Host-bashkitten_local_" + identity.getString("instanceId").replace("-", "");
                            if (!result.getString("url").equals(endpoint) || !result.getString("generation").equals(sessionGeneration)
                                || !actualIdentity.getString("caSha256").equals(identity.getString("caSha256"))
                                || !actualIdentity.getString("instanceId").equals(identity.getString("instanceId"))
                                || !cookie.getString("name").equals(expectedName) || !cookie.getString("value").matches("[a-f0-9]{64}")) {
                                throw new SecurityException("The local Agent changed while connecting. Turn on to retry.");
                            }
                            localSession = result;
                            reloadOnConnect = true;
                            acceptStatus(value);
                        } catch (Exception failure) { fail("Could not verify the local Agent session. Turn on to retry."); }
                    }, message -> {
                        localSessionPending = false;
                        if (requestedOperation == operation && desired) fail(message);
                    });
                    return;
                }
                state = "on";
            } else {
                localSession = null;
                throw new IllegalStateException("Update BashKitten packages in Termux to use account-free Local.");
            }
            configure(endpoint, identity, false, 0);
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
        configure(endpoint, identity, tor, port, null, null);
    }
    private void configure(String endpoint, JSONObject identity, boolean tor, int port,
            RemoteAgentConnection remote, Runnable configured) throws Exception {
        if (engine == null) throw new IllegalStateException("Browser engine is not ready.");
        String sessionKey = selected;
        GeckoSession next = sessions.get(sessionKey);
        if (next == null) {
            next = new GeckoSession(new GeckoSessionSettings.Builder().contextId("bashkitten-agent-ui-" + sessionKey).build());
            sessions.put(sessionKey, next); next.open(engine);
            final GeckoSession hostSession = next;
            BashKittenController.setHostDelegate(next, (command, args, reply) -> hostCall(hostSession, command, args, reply));
        }
        session = next;
        if (!next.isOpen()) next.open(engine);
        final GeckoSession currentSession = next;
        BashKittenController.setHostDelegate(next, (command, args, reply) -> hostCall(currentSession, command, args, reply));
        JSONObject params = new JSONObject().put("url", endpoint).put("identity", identity).put("tor", tor).put("port", port)
            .put("proxySecret", remote == null ? app.tor.proxySecret() : remote.route.secret)
            .put("agentOrigin", URI.create(endpoint).getScheme() + "://" + URI.create(endpoint).getRawAuthority());
        if (remote != null) params.put("clientCertificate", remote.identity.getJSONObject("clientCertificate"));
        if (sessionKey.equals("local") && !tor && localSession != null) params.put("localSession", localSession);
        final GeckoSession target = next;
        final int generation = operation;
        final String previousUrl = url;
        boolean needsLoad = reloadOnConnect || !endpoint.equals(url) || !state.equals("on") || !target.isOpen();
        String request = new JSONObject().put("method", "agent.configure").put("params", params).toString();
        Runnable connect = () -> BashKittenController.request(target, request).accept(result -> {
            try {
                if (generation != operation || !desired || target != session) return;
                JSONObject reply = new JSONObject(result);
                if (reply.has("error")) throw new IllegalStateException(reply.getString("error"));
                boolean changedUrl = !endpoint.equals(url);
                url = endpoint;
                if (configured != null) { changed(); configured.run(); return; }
                if (changedUrl || needsLoad) {
                    // Attach the panel's delegates before the first navigation events.
                    changed();
                    target.loadUri(endpoint);
                    reloadOnConnect = false;
                }
                changed();
            } catch (Exception exception) {
                if (remote != null) remoteFailed(remote, "Could not verify Agent connection: " + exception.getMessage());
                else fail("Could not verify Agent connection: " + exception.getMessage());
            }
        }, exception -> {
            if (generation != operation) return;
            if (remote != null) remoteFailed(remote, "Could not configure the protected Agent connection.");
            else fail("Could not configure the protected Agent connection.");
        });
        if (!previousUrl.isEmpty() && (needsLoad || !previousUrl.equals(endpoint))) captureDraft(target, connect);
        else connect.run();
    }
    private void captureDraft(GeckoSession target, Runnable done) {
        BashKittenController.request(target, "{\"method\":\"agent.captureDraft\"}")
            .accept(ignored -> done.run(), ignored -> done.run());
    }
    private void suspendSession(GeckoSession target) {
        BashKittenController.request(target, "{\"method\":\"agent.cancel\"}").accept(ignored -> {}, ignored -> {});
        BashKittenController.setHostDelegate(target, null);
        final int generation = operation;
        captureDraft(target, () -> {
            if (!target.isOpen() || (generation != operation && target == session)) return;
            BashKittenController.request(target, "{\"method\":\"agent.disconnect\"}").accept(ignored -> {}, ignored -> {});
            target.stop(); target.loadUri("about:blank");
        });
    }
    private void signIn() {
        if (selected.equals("local") && localSession != null) {
            localSession = null; reloadOnConnect = true; refresh(); return;
        }
        app.remoteControl.disconnect();
        GeckoSession target = session;
        captureDraft(target, () -> { if (target == session && desired) target.loadUri(url + "/login"); });
    }
    public void recoverSession() {
        if (!desired) return;
        url = "";
        if (session != null && !session.isOpen() && engine != null) session.open(engine);
        if (selected.equals("local")) refresh();
        else {
            RemoteAgentConnection connection = remoteConnections.remove(selected);
            app.closeServiceRoutes(selected); serviceSnapshots.remove(selected);
            if (connection != null) connection.close();
            busy = false; turnOn();
        }
    }
    public void select(String id) {
        RemoteAgentConnection previousRemote = remoteConnections.get(selected);
        if (previousRemote != null && !previousRemote.ready) {
            remoteConnections.remove(selected); previousRemote.close();
        }
        if (!id.equals(remotePasswordHost)) clearRemotePassword();
        if (selected.equals(id)) {
            if (!id.equals("local")) { busy = false; turnOn(); }
            return;
        }
        operation++; busy = false;
        releaseRemoteAuthorization();
        if (session != null) { suspendSession(session); session.setActive(false); }

        app.remoteControl.disconnect();
        if (!selected.equals("local")) app.policies.edit().putString("agent.lastRemote", selected).apply();
        selected = id; url = ""; session = null;
        app.policies.edit().putString("agent.selected", id).apply();
        turnOn();
    }
    public JSONObject remotes() throws Exception { return new SecretStore(app, "agent-remotes").read(); }
    /** Called only after native TK2 decryption; no plaintext/legacy enrollment fallback. */
    public void importRemote(JSONObject bundle, String password) throws Exception {
        JSONObject enrollment = NativeRemote.browserIdentity(app, bundle);
        String id = bundle.getString("onion");
        rememberIdentity(id, enrollment.getJSONObject("identity"));
        JSONObject record = new JSONObject().put("version", 2).put("kind", "agent")
            .put("name", bundle.getString("name")).put("bundle", bundle);
        SecretStore store = new SecretStore(app, "agent-remotes");
        JSONObject saved = store.read(), old = saved.optJSONObject(id);
        if (old != null && old.has("mappings")) record.put("mappings", old.getJSONObject("mappings"));
        saved.put(id, record); store.write(saved);
        RemoteAgentConnection previous = remoteConnections.remove(id);
        app.closeServiceRoutes(id); serviceSnapshots.remove(id);
        if (previous != null) previous.close();
        clearRemotePassword(); remotePassword = password.toCharArray(); remotePasswordHost = id;
        select(id);
    }
    private void clearRemotePassword() {
        if (remotePassword != null) Arrays.fill(remotePassword, '\0');
        remotePassword = null; remotePasswordHost = "";
    }
    private void closeRemoteConnections() {
        clearRemotePassword();
        for (RemoteAgentConnection connection : remoteConnections.values()) { app.closeServiceRoutes(connection.host); connection.close(); }
        remoteConnections.clear();
        serviceSnapshots.clear();
    }
    public boolean remoteConnected(String id) {
        RemoteAgentConnection connection = remoteConnections.get(id);
        return connection != null && connection.ready && !connection.isClosed();
    }
    public void disconnectRemote(String id) {
        RemoteAgentConnection connection = remoteConnections.remove(id);
        app.closeServiceRoutes(id); serviceSnapshots.remove(id);
        if (connection != null) connection.close();
        if (selected.equals(id)) {
            operation++; busy = false; app.remoteControl.disconnect();
            if (session != null) suspendSession(session);
            state = "off"; error = ""; desired = false;
        }
        changed();
    }
    public void remoteServices(String id, Consumer<JSONObject> done, Consumer<String> failure) {
        RemoteAgentConnection connection = remoteConnections.get(id);
        if (!remoteConnected(id)) { failure.accept("Connect and finish sign-in to view services."); return; }
        connection.request(NativeRemote::services, catalogue -> {
            if (remoteConnections.get(id) != connection) { failure.accept("Remote connection changed. Refresh services."); return; }
            try {
                SecretStore store = new SecretStore(app, "agent-remotes");
                JSONObject saved = store.read(), record = saved.getJSONObject(id);
                JSONObject choices = record.optJSONObject("mappings");
                if (choices == null) { choices = new JSONObject(); record.put("mappings", choices); }
                JSONArray services = catalogue.getJSONArray("services");
                for (int i = 0; i < services.length(); i++) {
                    String serviceId = services.getJSONObject(i).getString("id");
                    if (!serviceId.equals("agent") && !choices.has(serviceId)) choices.put(serviceId, new JSONObject()
                        .put("enabled", true).put("port", 0).put("context", "bashkitten-service-" + UUID.randomUUID()));
                }
                store.write(saved);
                final JSONObject mappingChoices = new JSONObject(choices.toString());
                connection.request(client -> connection.mapServices(client, catalogue, mappingChoices), result -> {
                    if (remoteConnections.get(id) != connection) { failure.accept("Remote connection changed. Refresh services."); return; }
                    try {
                        app.serviceRoutes(id, result);
                        serviceSnapshots.put(id, result); importRemotePi(id, connection, result, 0, done, failure);
                    } catch (Exception error) { failure.accept(error.getMessage()); }
                }, failure);
            } catch (Exception error) { failure.accept(error.getMessage()); }
        }, failure);
    }
    public void saveRemoteMapping(String id, String serviceId, boolean enabled, int port, boolean importToPi, String apiKey,
            Consumer<JSONObject> done, Consumer<String> failure) {
        try {
            if (!remoteConnected(id)) throw new IllegalStateException("Connect first.");
            if (port < 0 || port > 65535 || serviceId.equals("agent")) throw new IllegalArgumentException("Choose Automatic or a port from 1 to 65535.");
            SecretStore store = new SecretStore(app, "agent-remotes");
            JSONObject saved = store.read(), choice = saved.getJSONObject(id).getJSONObject("mappings").getJSONObject(serviceId);
            if (apiKey.indexOf('\n') >= 0 || apiKey.indexOf('\r') >= 0 || apiKey.indexOf('\0') >= 0) throw new IllegalArgumentException("Invalid service API key.");
            choice.put("enabled", enabled).put("port", port).put("importToPi", importToPi).put("apiKey", apiKey); store.write(saved);
            remoteServices(id, done, failure);
        } catch (Exception error) { failure.accept(error.getMessage()); }
    }
    private void importRemotePi(String id, RemoteAgentConnection connection, JSONObject result, int index,
            Consumer<JSONObject> done, Consumer<String> failure) {
        if (remoteConnections.get(id) != connection || connection.isClosed()) { failure.accept("Remote connection closed."); return; }
        try {
            JSONArray services = result.getJSONArray("services");
            if (index >= services.length()) { done.accept(result); return; }
            JSONObject service = services.getJSONObject(index), choice = service.optJSONObject("choice");
            Runnable next = () -> importRemotePi(id, connection, result, index + 1, done, failure);
            if (!service.optString("kind").equals("llama") || choice == null || !choice.optBoolean("importToPi")) { next.run(); return; }
            if (!choice.optBoolean("enabled") || !service.has("mapping") || !service.optBoolean("reachable") ||
                    !service.optString("mappingError").isEmpty() || !service.getJSONObject("mapping").optString("error").isEmpty()) {
                service.put("importState", "Pi import pending: local access and the host service must be working."); next.run(); return;
            }
            if (!termuxSetupAttempted || !termux.permissionGranted() || !termux.installationId().equals(app.policies.getString("agent.termuxInstallation", ""))) {
                service.put("importState", "Set up Local Pi first. Remote access remains connected."); next.run(); return;
            }
            JSONObject record = remotes().getJSONObject(id);
            JSONObject currentChoice = record.getJSONObject("mappings").getJSONObject(service.getString("id"));
            if (!currentChoice.optBoolean("importToPi")) { next.run(); return; }
            if (!currentChoice.optBoolean("enabled") || currentChoice.optInt("port") != choice.optInt("port") ||
                    !currentChoice.optString("apiKey").equals(choice.optString("apiKey"))) {
                service.put("importState", "Settings changed. Refresh services to import the saved configuration."); next.run(); return;
            }
            String endpoint = service.getString("scheme") + "://127.0.0.1:" + service.getJSONObject("mapping").getInt("port") + "/v1";
            JSONObject request = new JSONObject().put("enabled", true).put("bundle", record.getJSONObject("bundle").getString("id"))
                .put("service", service.getString("id")).put("name", record.getString("name") + " · " + service.getString("name"))
                .put("baseUrl", endpoint).put("apiKey", choice.optString("apiKey"));
            Consumer<String> finish = message -> {
                try { service.put("importState", message); next.run(); }
                catch (Exception error) { failure.accept(error.getMessage()); }
            };
            command("remote-pi-import", request, value -> {
                String message = value.optString("message");
                if (message.isEmpty() || !Arrays.asList("imported", "pending").contains(value.optString("state")))
                    finish.accept("Pi import returned an invalid result. Refresh services to retry.");
                else finish.accept(message);
            }, message -> finish.accept("Pi import failed: " + message));
        } catch (Exception error) { failure.accept(error.getMessage()); }
    }
    public void remoteServiceAction(String id, String serviceId, String action, Consumer<JSONObject> done, Consumer<String> failure) {
        RemoteAgentConnection connection = remoteConnections.get(id);
        if (!remoteConnected(id)) { failure.accept("Connect first."); return; }
        connection.request(client -> client.serviceAction(serviceId, action), ignored -> {
            if (remoteConnections.get(id) != connection) { failure.accept("Remote connection changed. Refresh services."); return; }
            remoteServices(id, done, failure);
        }, failure);
    }
    public void openRemoteService(String id, String serviceId, Runnable done, Consumer<String> failure) {
        try {
            if (!remoteConnected(id)) throw new IllegalStateException("Connect first.");
            if (serviceId.equals("agent")) { select(id); app.startActivity(app.host.launchIntent().putExtra("bashkitten.openAgent", true)); done.run(); return; }
            JSONObject snapshot = serviceSnapshots.get(id);
            if (snapshot == null) throw new IllegalStateException("Refresh services first.");
            JSONArray services = snapshot.getJSONArray("services");
            for (int i = 0; i < services.length(); i++) {
                JSONObject service = services.getJSONObject(i);
                if (!service.getString("id").equals(serviceId)) continue;
                if (!service.has("mapping")) throw new IllegalStateException("Enable local access first.");
                app.createService(service.getJSONObject("choice").getString("context"), service.getString("url"), done, failure);
                return;
            }
            throw new IllegalStateException("Refresh services first.");
        } catch (Exception error) { failure.accept(error.getMessage()); }
    }
    public void removeRemote(String id) throws Exception {
        if (id.equals("local")) throw new IllegalArgumentException("Local Agent cannot be removed.");
        SecretStore store = new SecretStore(app, "agent-remotes");
        JSONObject saved = store.read();
        if (!saved.has(id)) return;
        RemoteAgentConnection connection = remoteConnections.remove(id);
        app.closeServiceRoutes(id); serviceSnapshots.remove(id);
        if (connection != null) connection.forget();
        JSONObject bundle = saved.getJSONObject(id).optJSONObject("bundle");
        if (bundle != null) NativeRemote.forgetSaved(app, bundle.getString("id"));
        if (id.equals(remotePasswordHost)) clearRemotePassword();
        boolean wasSelected = selected.equals(id);
        GeckoSession remote = sessions.remove(id);
        if (remote != null && remote.isOpen()) { remote.stop(); remote.close(); }
        if (engine != null) {
            engine.getStorageController().clearDataForSessionContext("bashkitten-agent-ui-" + id);
            JSONObject mappings = saved.getJSONObject(id).optJSONObject("mappings");
            if (mappings != null) for (java.util.Iterator<String> keys = mappings.keys(); keys.hasNext();) {
                engine.getStorageController().clearDataForSessionContext(mappings.getJSONObject(keys.next()).getString("context"));
            }
        }
        saved.remove(id); store.write(saved);
        JSONObject remembered = identities.read(); remembered.remove(id); identities.write(remembered);
        // The Tor client may also serve an independently enrolled ordinary private site. Removing
        // Agent never deletes that site's saved credential or stops its tabs.
        if (id.equals(app.policies.getString("agent.lastRemote", ""))) app.policies.edit().remove("agent.lastRemote").apply();
        if (wasSelected) {
            app.remoteControl.disconnect(); session = null; url = ""; selected = "local"; busy = false;
            app.policies.edit().putString("agent.selected", "local").apply();
            turnOn();
        } else changed();
    }
    private boolean selectedRemote(RemoteAgentConnection connection) {
        return desired && selected.equals(connection.host) && remoteConnections.get(connection.host) == connection && !connection.isClosed();
    }
    private void remoteFailed(RemoteAgentConnection connection, String message) {
        if (remoteConnections.get(connection.host) != connection) return;
        remoteConnections.remove(connection.host); app.closeServiceRoutes(connection.host); serviceSnapshots.remove(connection.host); connection.close();
        if (!selected.equals(connection.host)) return;
        clearRemotePassword();
        if (session != null) suspendSession(session);
        app.remoteControl.disconnect();
        setup("remote", message);
    }
    private void remoteReady(RemoteAgentConnection connection) {
        remoteServices(connection.host, ignored -> {}, message -> app.message("Services: " + message));
        if (!selectedRemote(connection)) return;
        clearRemotePassword();
        try {
            configure(connection.identity.getString("url"), connection.identity.getJSONObject("identity"),
                true, connection.proxyPort, connection, () -> {
                    if (!selectedRemote(connection)) return;
                    busy = false; state = "on"; error = ""; changed();
                    session.loadUri(url); reloadOnConnect = false;
                });
        } catch (Exception error) { remoteFailed(connection, "Could not configure the enrolled Agent tunnel."); }
    }
    private void remoteLogin(RemoteAgentConnection connection, String address) {
        if (!selectedRemote(connection)) return;
        try {
            configure(connection.identity.getString("url"), connection.identity.getJSONObject("identity"),
                true, connection.proxyPort, connection, () -> {
                    if (!selectedRemote(connection)) return;
                    GeckoSession target = session;
                    Runnable openLogin = () -> {
                        if (!selectedRemote(connection) || session != target) return;
                        busy = false; state = "login"; error = ""; changed();
                        target.loadUri(address);
                    };
                    if (remotePassword == null || !remotePasswordHost.equals(connection.host)) { openLogin.run(); return; }
                    try {
                        JSONObject params = new JSONObject().put("username", connection.owner)
                            .put("password", new String(remotePassword));
                        clearRemotePassword();
                        String request = new JSONObject().put("method", "agent.firstFactor").put("params", params).toString();
                        BashKittenController.request(target, request).accept(value -> {
                            if (!selectedRemote(connection) || session != target) return;
                            try {
                                JSONObject result = new JSONObject(value);
                                if (result.has("error")) throw new IllegalStateException(result.getString("error"));
                                openLogin.run();
                            } catch (Exception error) { remoteFailed(connection, "Remote sign-in failed: " + error.getMessage()); }
                        }, error -> { if (selectedRemote(connection)) remoteFailed(connection, "Remote sign-in could not complete."); });
                    } catch (Exception error) { remoteFailed(connection, "Could not start the remote sign-in."); }
                });
        } catch (Exception error) { remoteFailed(connection, "Could not configure the protected remote sign-in."); }
    }
    /** Consume the native OAuth callback before Gecko loads or records it. */
    boolean remoteCallback(GeckoSession source, String address) {
        URI callback;
        try { callback = URI.create(address); } catch (Exception error) { return false; }
        if (!"http".equals(callback.getScheme()) || !"127.0.0.1".equals(callback.getHost())
            || !"/oauth/callback".equals(callback.getPath())) return false;
        // Always block this reserved callback in Agent, including stale/invalid
        // responses. Only the selected protected login may deliver it to Go.
        RemoteAgentConnection connection = remoteConnections.get(selected);
        if (connection == null || !selectedRemote(connection) || source != session || !connection.awaitingCallback) return true;
        // The native flow checks the exact callback, issuer and single-use
        // state. Gecko's triggerUri can be absent for an HTTP redirect.
        busy = true; state = "starting"; changed();
        connection.complete(address);
        return true;
    }
    private void connectRemote() {
        releaseRemoteAuthorization();
        final int generation = ++operation;
        RemoteAgentConnection active = remoteConnections.get(selected);
        if (active != null && active.ready && !active.isClosed()) { remoteReady(active); return; }
        if (active != null) { remoteConnections.remove(selected); app.closeServiceRoutes(selected); serviceSnapshots.remove(selected); active.close(); }
        try {
            JSONObject record = remotes().getJSONObject(selected);
            if (record.optInt("version") != 2 || !record.optString("kind").equals("agent")) {
                clearRemotePassword();
                setup("remote", "This saved connection needs a new encrypted QR from the host’s Share Local page."); return;
            }
            JSONObject bundle = record.getJSONObject("bundle");
            String host = bundle.getString("onion");
            if (!selected.equals(host)) throw new SecurityException("Remote identity does not match its saved connection.");
            app.tor.authorizeTemporarily(new OnionKey(host, bundle.getString("tor_private")), (port, cleanup) -> {
                if (generation != operation || !desired) { cleanup.run(); return; }
                TorGateway.AgentRoute route = null;
                try {
                    String socket = app.tor.socksPath();
                    route = app.tor.agentRoute(host);
                    RemoteAgentConnection connection = new RemoteAgentConnection(app.main, bundle, port, route, cleanup,
                        new RemoteAgentConnection.Listener() {
                            @Override public void login(RemoteAgentConnection value, String address) { remoteLogin(value, address); }
                            @Override public void ready(RemoteAgentConnection value) { remoteReady(value); }
                            @Override public void failed(RemoteAgentConnection value, String message) { remoteFailed(value, message); }
                        });
                    remoteConnections.put(host, connection);
                    connection.start(app, bundle, socket);
                } catch (Exception error) {
                    if (route != null) route.close(); cleanup.run(); clearRemotePassword();
                    setup("remote", "Could not start the native remote connection.");
                }
            }, message -> { if (generation == operation) { clearRemotePassword(); setup("remote", message); } });
        } catch (Exception error) { clearRemotePassword(); setup("remote", "Choose a valid encrypted Agent connection."); }
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
    void agentPageReady(GeckoSession source, String address) {
        if (source == session && desired && state.equals("on") && selected.equals("local")) {
            try {
                if ("/".equals(URI.create(address).getPath()))
                    app.remoteControl.connectLocal(activity.get(), source, url, false);
            } catch (IllegalArgumentException ignored) { }
        }
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
