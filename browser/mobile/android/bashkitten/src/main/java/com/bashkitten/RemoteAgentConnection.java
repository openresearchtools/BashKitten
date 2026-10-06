// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

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
        void failed(RemoteAgentConnection connection, String error);
    }

    final String host, owner;
    final int proxyPort;
    final TorGateway.AgentRoute route;
    JSONObject identity;
    boolean ready, awaitingCallback;
    private final Handler main;
    private final Runnable releaseKey;
    private final Listener listener;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final CompletableFuture<Void> previousClosed;
    private final CompletableFuture<Void> nativeClosed = new CompletableFuture<>();
    private NativeRemote client;
    private boolean closed;

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
        this.host = bundle.getString("onion"); this.owner = bundle.getString("owner");
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
                if (opened.authorize()) activate(opened, enrollment);
                else {
                    String address = opened.beginLogin();
                    main.post(() -> {
                        if (isClosed()) return;
                        identity = enrollment; awaitingCallback = true;
                        listener.login(this, address);
                    });
                }
            } catch (Exception error) { failed(error); }
        });
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
    void forget(Runnable done, Consumer<String> failure) { close(true, done, failure); }

    @Override public void close() { close(false, null, null); }

    private void close(boolean forget, Runnable done, Consumer<String> failure) {
        NativeRemote current;
        synchronized (this) {
            if (closed) {
                if (forget) new Thread(() -> {
                    nativeClosed.join(); done.run();
                }, "agent-remote-forget").start();
                return;
            }
            closed = true; current = client; client = null;
        }
        // Revoke immediately; drain sockets on the close worker before releasing
        // the native port, without blocking Android's main thread.
        route.revoke();
        identity = null; ready = false; awaitingCallback = false;
        // Go's TLS close can write close_notify. It must not block Android's
        // main thread or queue behind the request that shutdown must cancel.
        new Thread(() -> {
            try {
                route.close();
                if (previousClosed != null) previousClosed.join();
                if (forget) {
                    try { if (current != null) current.forget(); }
                    catch (Exception error) {
                        main.post(() -> failure.accept("The connection could not be forgotten. Retry removal."));
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
