// SPDX-License-Identifier: AGPL-3.0-only
package com.taskarian;

import android.content.Context;
import android.os.Handler;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.CompletableFuture;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Consumer;

/** Owns one enrollment's native client independently of the displayed Agent. */
final class RemoteAgentConnection implements AutoCloseable {
    interface Listener {
        void login(RemoteAgentConnection connection, String address);
        void ready(RemoteAgentConnection connection);
        void transportLogin(RemoteAgentConnection connection, String address, String state);
        void failed(RemoteAgentConnection connection, String error);
    }

    final String host;
    final int proxyPort;
    final TorGateway.AgentRoute route;
    JSONObject identity;
    boolean ready, awaitingCallback, awaitingTransport;
    private final Handler main;
    private final Runnable releaseKey;
    private final Listener listener;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final CompletableFuture<Void> previousClosed;
    private final CompletableFuture<Void> nativeClosed = new CompletableFuture<>();
    private NativeRemote client;
    private boolean closed;
    private enum CloseMode { DISCONNECT, FORGET, LOGOUT }

    interface Work { JSONObject run(NativeRemote client) throws Exception; }
    void request(Work work, Consumer<JSONObject> done, Consumer<String> failure) {
        if (isClosed() || !ready) { failure.accept("Connect and finish sign-in to view services."); return; }
        try { io.execute(() -> {
            try {
                NativeRemote current;
                synchronized (this) { if (closed) throw new IllegalStateException("Remote connection closed."); current = client; }
                JSONObject result = work.run(current);
                main.post(() -> { if (isClosed()) failure.accept("Remote connection closed."); else done.accept(result); });
            } catch (Exception error) {
                main.post(() -> failure.accept(error.getMessage() == null ? "Remote service request failed." : error.getMessage()));
            }
        }); } catch (java.util.concurrent.RejectedExecutionException error) { failure.accept("Remote connection closed."); }
    }

    /** Work runs on the same native-client executor; UI/state writes stay on main. */
    JSONObject mapServices(NativeRemote current, JSONObject catalogue, JSONObject choices) throws Exception {
        JSONArray services = catalogue.getJSONArray("services");
        Set<String> offered = new HashSet<>();
        for (int i = 0; i < services.length(); i++) offered.add(services.getJSONObject(i).getString("id"));
        JSONArray mapped = current.mappings();
        for (int i = 0; i < mapped.length(); i++) {
            String id = mapped.getJSONObject(i).getString("id");
            if (!id.equals("agent") && !offered.contains(id)) current.unmap(id);
        }
        for (int i = 0; i < services.length(); i++) {
            JSONObject service = services.getJSONObject(i); String id = service.getString("id");
            if (id.equals("agent")) continue;
            JSONObject choice = choices.getJSONObject(id); service.put("choice", choice);
            try {
                if (choice.getBoolean("enabled")) current.map(id, choice.getInt("port"));
                else current.unmap(id);
            } catch (Exception error) { service.put("mappingError", error.getMessage()); }
        }
        mapped = current.mappings();
        for (int i = 0; i < services.length(); i++) {
            JSONObject service = services.getJSONObject(i); String id = service.getString("id");
            if (id.equals("agent")) continue;
            for (int j = 0; j < mapped.length(); j++) if (mapped.getJSONObject(j).getString("id").equals(id)) {
                JSONObject mapping = mapped.getJSONObject(j);
                service.put("mapping", mapping)
                    .put("url", service.getString("scheme") + "://127.0.0.1:" + mapping.getInt("port") + service.getString("openPath"));
            }
        }
        return catalogue;
    }

    RemoteAgentConnection(Handler main, JSONObject bundle,
            int proxyPort, TorGateway.AgentRoute route, Runnable releaseKey, Listener listener,
            RemoteAgentConnection previous) throws Exception {
        this.host = NativeRemote.host(bundle);
        this.main = main; this.proxyPort = proxyPort; this.route = route;
        this.releaseKey = releaseKey; this.listener = listener;
        this.previousClosed = previous == null ? null : previous.nativeClosed;
        // The caller registers this owner before invoking start; callbacks are
        // delivered only through main, never during construction.
    }

    void start(Context context, JSONObject bundle, String socket) {
        io.execute(() -> {
            try {
                if (previousClosed != null) previousClosed.join();
                if (isClosed()) return;
                NativeRemote opened = new NativeRemote(context, bundle, socket);
                boolean cancelled;
                synchronized (this) {
                    cancelled = closed;
                    if (!cancelled) client = opened;
                }
                // UI callers also take this monitor to inspect/close the owner.
                // Do not hold it while the native client shuts down TLS.
                if (cancelled) { opened.close(); return; }
                JSONObject enrollment = opened.browserIdentity();
                if (bundle.optInt("version") == 3) route.useTunnel(opened.loginPort());
                authenticate(opened, enrollment);
            } catch (Exception error) { failed(error); }
        });
    }

    void resumeTransport() {
        if (isClosed() || !awaitingTransport) return;
        awaitingTransport = false;
        io.execute(() -> {
            try {
                NativeRemote current;
                synchronized (this) { if (closed) return; current = client; }
                authenticate(current, current.browserIdentity());
            } catch (Exception error) { failed(error); }
        });
    }

    private void authenticate(NativeRemote current, JSONObject enrollment) throws Exception {
        JSONObject status = current.transportStatus();
        if (status.optString("kind").equals("tailscale") && !status.optString("state").equals("ready")) {
            if (status.optString("state").equals("login") && status.optString("login_url").isEmpty()) {
                current.beginTransportLogin(); status = current.transportStatus();
            }
            final String address = status.optString("login_url"), state = status.optString("state");
            main.post(() -> {
                if (isClosed()) return;
                identity = enrollment; awaitingTransport = true;
                listener.transportLogin(this, address, state);
            }); return;
        }
        if (current.authorize()) activate(current, enrollment);
        else {
            String address = current.beginLogin();
            main.post(() -> {
                if (isClosed()) return;
                identity = enrollment; awaitingCallback = true;
                listener.login(this, address);
            });
        }
    }

    void complete(String callback, String form) {
        if (!awaitingCallback || isClosed()) return;
        awaitingCallback = false;
        io.execute(() -> {
            try {
                NativeRemote current;
                synchronized (this) { if (closed) throw new IllegalStateException("Remote connection closed."); current = client; }
                current.completeLogin(callback, form);
                activate(current, current.browserIdentity());
            } catch (Exception error) { failed(error); }
        });
    }

    private void activate(NativeRemote current, JSONObject enrollment) throws Exception {
        JSONObject mapping = current.map("agent", 0);
        int port = mapping.getInt("port");
        route.useTunnel(port);
        current.closeLoginRoute();
        main.post(() -> {
            if (isClosed()) return;
            try {
                identity = enrollment; ready = true;
                listener.ready(this);
            } catch (Exception error) { failed(error); }
        });
    }

    private void failed(Exception error) {
        main.post(() -> {
            if (isClosed()) return;
            listener.failed(this, error.getMessage() == null ? "Remote connection failed" : error.getMessage());
        });
    }

    synchronized boolean isClosed() { return closed; }

    /** Completion runs on the close worker so token deletion can finish there. */
    void forget(Runnable done, Consumer<String> failure) { close(CloseMode.FORGET, null, done, failure); }

    void logout(CompletableFuture<Void> cookieLogout, Runnable done, Consumer<String> failure) {
        close(CloseMode.LOGOUT, cookieLogout, done, failure);
    }

    @Override public void close() { close(CloseMode.DISCONNECT, null, null, null); }

    private void close(CloseMode mode, CompletableFuture<Void> cookieLogout, Runnable done, Consumer<String> failure) {
        NativeRemote current;
        synchronized (this) {
            if (closed) {
                if (mode == CloseMode.FORGET) new Thread(() -> {
                    nativeClosed.join(); done.run();
                }, "agent-remote-forget").start();
                else if (mode == CloseMode.LOGOUT) failure.accept("Remote connection closed before sign-out.");
                return;
            }
            closed = true; current = client; client = null;
        }
        // Revoke immediately; drain sockets on the close worker before releasing
        // the native port, without blocking Android's main thread.
        // The cookie logout uses this captured Agent route. Keep it only until
        // that request settles; the closed owner already rejects other work.
        if (cookieLogout == null) route.revoke();
        identity = null; ready = false; awaitingCallback = false; awaitingTransport = false;
        // Go's TLS close can write close_notify. It must not block Android's
        // main thread or queue behind the request that shutdown must cancel.
        new Thread(() -> {
            try {
                if (cookieLogout != null) { cookieLogout.join(); route.revoke(); }
                route.close();
                if (previousClosed != null) previousClosed.join();
                if (mode == CloseMode.FORGET) {
                    try { if (current != null) current.forget(); }
                    catch (Exception error) {
                        main.post(() -> failure.accept("The connection could not be forgotten. Retry removal."));
                        return;
                    }
                } else if (mode == CloseMode.LOGOUT) {
                    try {
                        if (current == null) throw new IllegalStateException("Remote connection closed before sign-out.");
                        current.logout();
                    } catch (Exception error) {
                        main.post(() -> failure.accept(error.getMessage() == null ? "Remote sign-out failed." : error.getMessage()));
                        return;
                    }
                } else if (current != null) current.close();
            } finally { releaseKey.run(); nativeClosed.complete(null); }
            if (done != null) done.run();
        }, "agent-remote-close").start();
        // Drain queued requests so each caller receives its closed-connection error.
        io.shutdown();
    }
}
