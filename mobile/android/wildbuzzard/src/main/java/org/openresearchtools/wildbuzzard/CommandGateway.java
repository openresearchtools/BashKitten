// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.json.JSONObject;

/** Browser-owned local command transport, using the same tab dispatcher as Binder. */
final class CommandGateway {
    final BrowserApp app;
    final SecretStore store;
    final ExecutorService storage = Executors.newSingleThreadExecutor();
    final ThreadPoolExecutor connections = new ThreadPoolExecutor(0, 16, 30, TimeUnit.SECONDS, new SynchronousQueue<>());
    final AtomicInteger generation = new AtomicInteger();
    volatile Map<String, byte[]> keys = Collections.emptyMap();
    private ServerSocket server;
    private final Map<String, Launch> launches = new HashMap<>();
    static final class Launch {
        final AgentController.Access access;
        final String tab;
        final long expires = android.os.SystemClock.elapsedRealtime() + 30000;
        Launch(AgentController.Access access, String tab) { this.access = access; this.tab = tab; }
    }
    CommandGateway(BrowserApp app) {
        this.app = app; store = new SecretStore(app, "command-access");
        int version = generation.get();
        storage.execute(() -> {
            try {
                JSONObject saved = store.read(); Map<String, byte[]> loaded = new HashMap<>();
                Iterator<String> names = saved.keys();
                while (names.hasNext()) { String id = names.next(); byte[] key = CommandProtocol.key(saved.getString(id));
                    if (!CommandProtocol.id(key).equals(id)) throw new SecurityException("Invalid saved command identity");
                    loaded.put(id, key);
                }
                if (generation.get() == version) keys = Collections.unmodifiableMap(loaded);
                if (!keys.isEmpty()) listen();
            } catch (Exception error) { android.util.Log.e("WildBuzzard", "Command access could not be restored"); }
        });
    }
    void authorize(String text, Runnable done, Consumer<String> fail) {
        final byte[] key = CommandProtocol.key(text);
        final int version = generation.get();
        storage.execute(() -> {
            try {
                String id = CommandProtocol.id(key);
                Map<String, byte[]> next = new HashMap<>(keys);
                if (!next.containsKey(id) && next.size() >= 32) throw new IllegalStateException("Revoke old command access first");
                next.put(id, key);
                JSONObject saved = new JSONObject();
                for (Map.Entry<String, byte[]> entry : next.entrySet()) saved.put(entry.getKey(), CommandProtocol.hex(entry.getValue()));
                store.write(saved);
                if (generation.get() != version) throw new SecurityException("Access was revoked");
                keys = Collections.unmodifiableMap(next); listen();
                app.main.post(done);
            } catch (Exception error) { app.main.post(() -> fail.accept("Could not enable command access: " + error.getMessage())); }
        });
    }
    void revokeAll() {
        generation.incrementAndGet(); keys = Collections.emptyMap();
        synchronized (launches) { launches.clear(); }
        storage.execute(() -> {
            try { store.write(new JSONObject()); }
            catch (Exception error) { app.main.post(() -> app.message("Command access could not be erased from storage")); }
        });
    }
    private synchronized void listen() throws Exception {
        if (server != null) return;
        ServerSocket socket = new ServerSocket();
        try { socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), CommandProtocol.PORT), 16); }
        catch (Exception error) { socket.close(); throw error; }
        server = socket;
        Thread accept = new Thread(() -> {
            while (!socket.isClosed()) {
                try {
                    Socket connection = socket.accept(); connection.setSoTimeout(5000);
                    try { connections.execute(() -> serve(connection)); }
                    catch (RejectedExecutionException error) { connection.close(); }
                } catch (Exception error) { if (socket.isClosed()) return; }
            }
        }, "WildBuzzard commands");
        accept.setDaemon(true); accept.start();
    }
    private AgentController.Access access(String id, byte[] key) {
        return new AgentController.Access("command:" + id, -1, () -> {
            if (keys.get(id) != key) throw new SecurityException("Command access revoked");
        });
    }
    private void serve(Socket socket) {
        try (Socket connection = socket) {
            JSONObject hello = CommandProtocol.read(connection.getInputStream(), 4096);
            String id = hello.getString("keyId"), client = hello.getString("nonce");
            if (hello.getInt("protocol") != 1 || !client.matches("[0-9a-f]{64}")) return;
            byte[] key = keys.get(id); if (key == null) return;
            String serverNonce = CommandProtocol.hex(CommandProtocol.random(32));
            String transcript = client + "\n" + serverNonce;
            CommandProtocol.write(connection.getOutputStream(), new JSONObject().put("nonce", serverNonce)
                .put("proof", CommandProtocol.hex(CommandProtocol.mac(key, "server\n" + transcript))));
            String request = CommandProtocol.decrypt(key, "request\n" + transcript,
                CommandProtocol.read(connection.getInputStream(), 1200000));
            AgentController.Access access = access(id, key); access.check.run();
            CompletableFuture<String> result = new CompletableFuture<>();
            if (request.length() > 200000) throw new IllegalArgumentException("Request too large");
            JSONObject command = new JSONObject(request);
            if (command.optString("method").equals("tabs.show")) {
                String tab = command.getJSONObject("params").getString("tabId");
                app.main.post(() -> {
                    try {
                        access.check.run(); app.owned(tab, access.owner);
                        String nonce = launch(access, tab);
                        result.complete(new JSONObject().put("result", new JSONObject().put("launch", nonce)).toString());
                    } catch (Exception error) { result.complete("{\"error\":\"Cannot show this tab\"}"); }
                });
            } else app.controller.execute(access, request, result::complete);
            String response = result.get(215, TimeUnit.SECONDS);
            CommandProtocol.write(connection.getOutputStream(), CommandProtocol.encrypt(key, "response\n" + transcript, response));
        } catch (Exception ignored) { /* Invalid or abandoned connections receive no unauthenticated data. */ }
    }
    String launch(AgentController.Access access, String tab) {
        access.check.run(); app.owned(tab, access.owner);
        String nonce = UUID.randomUUID().toString();
        synchronized (launches) {
            launches.entrySet().removeIf(entry -> entry.getValue().expires < android.os.SystemClock.elapsedRealtime());
            if (launches.size() >= 32) throw new IllegalStateException("Too many launch requests");
            launches.put(nonce, new Launch(access, tab));
        }
        return nonce;
    }
    void show(String nonce) {
        Launch launch;
        synchronized (launches) { launch = launches.remove(nonce); }
        if (launch == null || launch.expires < android.os.SystemClock.elapsedRealtime()) throw new SecurityException("Launch expired");
        launch.access.check.run(); app.show(app.owned(launch.tab, launch.access.owner));
    }
}
