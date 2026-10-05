// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.content.Context;
import android.os.Handler;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

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
    private NativeRemote client;
    private boolean closed;

    RemoteAgentConnection(Handler main, JSONObject bundle,
            int proxyPort, TorGateway.AgentRoute route, Runnable releaseKey, Listener listener) throws Exception {
        this.host = bundle.getString("onion"); this.owner = bundle.getString("owner");
        this.main = main; this.proxyPort = proxyPort; this.route = route;
        this.releaseKey = releaseKey; this.listener = listener;
        // The caller registers this owner before invoking start; callbacks are
        // delivered only through main, never during construction.
    }

    void start(Context context, JSONObject bundle, String socket) {
        io.execute(() -> {
            try {
                NativeRemote opened = new NativeRemote(context, bundle, socket);
                synchronized (this) {
                    if (closed) { opened.close(); return; }
                    client = opened;
                }
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

    void complete(String callback) {
        if (!awaitingCallback || isClosed()) return;
        awaitingCallback = false;
        io.execute(() -> {
            try {
                NativeRemote current;
                synchronized (this) { if (closed) return; current = client; }
                current.completeLogin(callback);
                activate(current, current.browserIdentity());
            } catch (Exception error) { failed(error); }
        });
    }

    private void activate(NativeRemote current, JSONObject enrollment) throws Exception {
        JSONObject mapping = current.map("agent", 0);
        int port = mapping.getInt("port");
        main.post(() -> {
            if (isClosed()) return;
            try {
                route.useTunnel(port);
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

    void forget() throws Exception {
        NativeRemote current;
        synchronized (this) { current = client; }
        close();
        if (current != null) current.forget();
    }

    @Override public void close() {
        NativeRemote current;
        synchronized (this) {
            if (closed) return;
            closed = true; current = client; client = null;
        }
        // Close the browser route before releasing its port, so a later local
        // listener cannot receive an old protected Agent connection.
        route.close();
        if (current != null) current.close();
        releaseKey.run();
        io.shutdownNow();
        identity = null; ready = false; awaitingCallback = false;
    }
}
