// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.net.LocalServerSocket;
import android.net.LocalSocket;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Android's Unix socket peer credentials identify the terminal app, not a supplied package name. */
final class AppCommandGateway {
    static String socketName() { return "org.openresearchtools.wildbuzzard.commands." + android.os.Process.myUid() / 100000; }
    private final BrowserApp app;
    private final ThreadPoolExecutor connections = new ThreadPoolExecutor(0, 16, 30, TimeUnit.SECONDS, new SynchronousQueue<>());
    AppCommandGateway(BrowserApp app) {
        this.app = app;
        Thread listener = new Thread(() -> {
            try (LocalServerSocket server = new LocalServerSocket(socketName())) {
                while (true) {
                    LocalSocket socket = server.accept(); socket.setSoTimeout(5000);
                    try { connections.execute(() -> serve(socket)); }
                    catch (RejectedExecutionException error) { socket.close(); }
                }
            } catch (Exception error) { android.util.Log.e("WildBuzzard", "App command socket unavailable"); }
        }, "Wild Buzzard app commands");
        listener.setDaemon(true); listener.start();
    }
    private void serve(LocalSocket socket) {
        try (LocalSocket connection = socket) {
            int uid = connection.getPeerCredentials().getUid();
            JSONObject request = CommandProtocol.read(connection.getInputStream(), 800000);
            String method = request.optString("method");
            JSONObject response;
            if (method.equals("app.authorize")) {
                try { app.grants.require(uid); response = new JSONObject().put("result", "authorized"); }
                catch (SecurityException error) {
                    response = new JSONObject().put("result", new JSONObject().put("appGrant", app.grants.ticket(uid)));
                }
            } else {
                try {
                    AgentController.Access access = app.controller.forUid(uid, request.optString("session"), true);
                    CompletableFuture<String> result = new CompletableFuture<>();
                    if (method.equals("app.prepare")) {
                        app.main.post(() -> {
                            try {
                                access.check.run();
                                if (!BrowserKeepAliveService.active) app.keepAlive();
                                long deadline = android.os.SystemClock.elapsedRealtime() + 5000;
                                Runnable started = new Runnable() {
                                    @Override public void run() {
                                        if (BrowserKeepAliveService.active) result.complete("{\"result\":{\"foregroundRequired\":false}}");
                                        else if (android.os.SystemClock.elapsedRealtime() >= deadline) result.complete("{\"error\":\"Browser foreground service did not start\"}");
                                        else app.main.postDelayed(this, 25);
                                    }
                                };
                                started.run();
                            } catch (SecurityException error) { result.complete("{\"error\":\"App authorization required\"}"); }
                            catch (IllegalStateException error) { result.complete("{\"result\":{\"foregroundRequired\":true}}"); }
                        });
                    } else app.controller.execute(access, request.toString(), result::complete);
                    response = new JSONObject(result.get(215, TimeUnit.SECONDS));
                } catch (SecurityException error) {
                    response = new JSONObject().put("error", "App authorization required; run --authorize or allow this app in Settings > Agent access");
                }
            }
            CommandProtocol.write(connection.getOutputStream(), response);
        } catch (Exception ignored) { /* A closed or invalid local request has no response. */ }
    }
}
