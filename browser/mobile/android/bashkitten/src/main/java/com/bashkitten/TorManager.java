// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.content.*;
import android.os.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import java.util.function.BiConsumer;
import org.json.JSONObject;
import org.torproject.jni.TorService;

final class TorManager {
    private final BrowserApp app;
    private final SecretStore keys;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile TorService service;
    private volatile TorGateway gateway;
    private final Set<String> installed = ConcurrentHashMap.newKeySet();
    private boolean starting, connecting;
    private static final class Waiting {
        final Consumer<Integer> success;
        final Consumer<String> failure;
        Waiting(Consumer<Integer> success, Consumer<String> failure) { this.success = success; this.failure = failure; }
    }
    private final List<Waiting> waiting = new ArrayList<>();
    private volatile boolean restored;
    TorManager(BrowserApp app) { this.app = app; keys = new SecretStore(app, "onion-keys"); }
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((TorService.LocalBinder) binder).getService();
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            service = null; restored = false;
            app.main.post(() -> { installed.clear(); app.refreshTor(0, new ArrayList<>()); });
        }
    };
    void ready(Consumer<Integer> success, Consumer<String> failure) {
        waiting.add(new Waiting(success, failure));
        if (connecting) return;
        connecting = true;
        boolean start = !starting;
        if (start) {
            try { app.keepAlive(); }
            catch (Exception error) { finishConnecting(0, "Could not start Tor"); return; }
            starting = true;
        }
        io.execute(() -> {
            try {
                if (start) {
                    try {
                        java.io.File directory = new java.io.File(app.getNoBackupFilesDir(), "tor");
                        Files.createDirectories(directory.toPath());
                        android.system.Os.chmod(directory.getAbsolutePath(), 0700);
                        String socket = new java.io.File(directory, "socks").getAbsolutePath();
                        if (gateway == null) gateway = new TorGateway(socket);
                        Files.write(TorService.getTorrc(app).toPath(),
                            ("SocksPort unix:" + socket + " IsolateSOCKSAuth\nHTTPTunnelPort 0\nDisableNetwork 1\nSafeSocks 1\nTestSocks 0\nClientOnly 1\n").getBytes(StandardCharsets.UTF_8));
                        if (!app.bindService(new Intent(app, TorService.class), connection, Context.BIND_AUTO_CREATE)) throw new IllegalStateException();
                    } catch (Exception error) {
                        app.main.post(() -> { starting = false; finishConnecting(0, "Could not start Tor"); });
                        return;
                    }
                }
                long deadline = SystemClock.elapsedRealtime() + 180000;
                TorService current;
                while ((current = service) == null || current.getTorControlConnection() == null) {
                    if (SystemClock.elapsedRealtime() > deadline) throw new IllegalStateException();
                    Thread.sleep(100);
                }
                if (!restored) {
                    // SETCONF replaces Tor's in-memory client-auth map; install credentials afterwards.
                    current.getTorControlConnection().setConf("DisableNetwork", "0");
                    JSONObject stored = keys.read();
                    List<String> enrolled = new ArrayList<>();
                    for (Iterator<String> it = stored.keys(); it.hasNext();) {
                        String host = it.next();
                        current.getTorControlConnection().onionClientAuthAdd(host.substring(0, 56), new OnionKey(host, stored.getString(host)).controlKey());
                        enrolled.add(host);
                    }
                    installed.clear(); installed.addAll(enrolled);
                    restored = true;
                }
                while (true) {
                    String status = current.getTorControlConnection().getInfo("status/bootstrap-phase");
                    if (status.contains("PROGRESS=100")) break;
                    if (SystemClock.elapsedRealtime() > deadline) throw new IllegalStateException();
                    Thread.sleep(250);
                }
                int port = gateway.port();
                if (port < 1) throw new IllegalStateException();
                app.main.post(() -> finishConnecting(port, null));
            } catch (Exception error) {
                app.main.post(() -> finishConnecting(0, "Tor is unavailable; no direct connection was made. Retry when connected."));
            }
        });
    }
    private void finishConnecting(int port, String error) {
        connecting = false;
        List<Waiting> completed = new ArrayList<>(waiting); waiting.clear();
        app.refreshTor(port, port == 0 ? Collections.emptyList() : identities());
        for (Waiting request : completed) {
            if (error == null) request.success.accept(port);
            else request.failure.accept(error);
        }
    }
    String proxySecret() { return gateway == null ? "" : gateway.secret; }
    List<String> identities() { return new ArrayList<>(installed); }
    /** Install a credential only for native Agent enrollment; do not enroll ordinary tab trust. */
    void authorizeTemporarily(OnionKey key, BiConsumer<Integer, Runnable> success, Consumer<String> failure) {
        ready(port -> io.execute(() -> {
            try {
                TorService current = service;
                if (current == null || current.getTorControlConnection() == null) throw new IllegalStateException();
                current.getTorControlConnection().onionClientAuthAdd(key.host.substring(0, 56), key.controlKey());
                java.util.concurrent.atomic.AtomicBoolean closed = new java.util.concurrent.atomic.AtomicBoolean();
                Runnable restore = () -> {
                    if (!closed.compareAndSet(false, true)) return;
                    io.execute(() -> {
                        try {
                            TorService active = service;
                            if (active == null || active.getTorControlConnection() == null) return;
                            String previous = keys.read().optString(key.host, "");
                            if (previous.isEmpty()) active.getTorControlConnection().onionClientAuthRemove(key.host.substring(0, 56));
                            else active.getTorControlConnection().onionClientAuthAdd(key.host.substring(0, 56), new OnionKey(key.host, previous).controlKey());
                        } catch (Exception ignored) { restored = false; }
                    });
                };
                app.main.post(() -> success.accept(port, restore));
            } catch (Exception error) { app.main.post(() -> failure.accept("The remote Agent could not be reached through Tor.")); }
        }), failure);
    }
    void save(OnionKey key, Runnable saved, Consumer<String> complete) {
        io.execute(() -> {
            try {
                JSONObject stored = keys.read();
                if (!stored.has(key.host) && stored.length() >= 64) throw new IllegalStateException("Key limit reached");
                stored.put(key.host, key.key); keys.write(stored);
                app.main.post(() -> { saved.run(); ready(port -> io.execute(() -> {
                    try {
                        service.getTorControlConnection().onionClientAuthAdd(key.host.substring(0, 56), key.controlKey());
                        installed.add(key.host);
                        app.main.post(() -> { app.refreshTor(port, identities()); complete.accept("Onion key imported"); });
                    } catch (Exception error) {
                        app.main.post(() -> complete.accept("Key saved; Tor is unavailable. Retry when connected."));
                    }
                }), ignored -> complete.accept("Key saved; Tor is unavailable. Retry when connected.")); });
            } catch (Exception error) { app.main.post(() -> complete.accept("Could not save onion key")); }
        });
    }
    void list(Consumer<List<String>> result) {
        io.execute(() -> {
            List<String> hosts = new ArrayList<>();
            try { keys.read().keys().forEachRemaining(hosts::add); } catch (Exception ignored) {}
            app.main.post(() -> result.accept(hosts));
        });
    }
    void remove(String host, Consumer<String> complete) {
        installed.remove(host);
        app.refreshTorTrust(identities());
        io.execute(() -> {
            try {
                JSONObject stored = keys.read(); stored.remove(host); keys.write(stored);
                if (service != null && service.getTorControlConnection() != null) service.getTorControlConnection().onionClientAuthRemove(host.substring(0, 56));
                installed.remove(host);
                app.main.post(() -> { app.refreshTorTrust(identities()); complete.accept("Onion key removed"); });
            } catch (Exception error) { app.main.post(() -> complete.accept("Key removal failed; retry")); }
        });
    }
}
