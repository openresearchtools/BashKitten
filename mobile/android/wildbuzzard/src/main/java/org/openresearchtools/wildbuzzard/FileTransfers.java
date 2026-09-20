// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Short-lived, per-file bearer grants. No directory listing or user-supplied filesystem path. */
final class FileTransfers {
    private final BrowserApp app;
    private final Map<String, Entry> entries = new HashMap<>();
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(0, 8, 30, TimeUnit.SECONDS, new SynchronousQueue<>());
    private ServerSocket server;
    private static final class Entry {
        final File file;
        final String token, mime;
        final boolean temporary;
        final AgentController.Access access;
        final long deadline = android.os.SystemClock.elapsedRealtime() + 300000;
        Entry(File file, String mime, boolean temporary, AgentController.Access access) {
            this.file = file; this.mime = mime; this.temporary = temporary; this.access = access;
            token = CommandProtocol.hex(CommandProtocol.random(32));
        }
    }
    FileTransfers(BrowserApp app) { this.app = app; }
    synchronized JSONObject grant(File file, String mime, boolean temporary, AgentController.Access access) throws Exception {
        access.check.run();
        if (!file.isFile()) throw new IOException("Downloaded file is unavailable");
        prune();
        if (entries.size() >= 64) throw new IOException("Too many active file transfers");
        if (server == null) listen();
        String id = UUID.randomUUID().toString();
        Entry entry = new Entry(file, mime, temporary, access); entries.put(id, entry);
        app.main.postDelayed(this::prune, 300100);
        String url = "http://127.0.0.1:" + server.getLocalPort() + "/files/" + id;
        return new JSONObject().put("url", url).put("token", entry.token).put("expiresInSeconds", 300)
            .put("size", file.length()).put("mimeType", mime)
            .put("wget", "wget --header='Authorization: Bearer " + entry.token + "' -O '" +
                file.getName().replace("'", "'\\''") + "' '" + url + "'");
    }
    synchronized void revokeAll() {
        for (Entry entry : entries.values()) if (entry.temporary) entry.file.delete();
        entries.clear(); closeIdle();
    }
    private synchronized void prune() {
        entries.entrySet().removeIf(value -> {
            Entry entry = value.getValue();
            boolean expired = entry.deadline <= android.os.SystemClock.elapsedRealtime();
            try { entry.access.check.run(); } catch (Exception error) { expired = true; }
            if (expired && entry.temporary) entry.file.delete();
            return expired;
        });
        closeIdle();
    }
    private void closeIdle() {
        if (entries.isEmpty() && server != null) {
            try { server.close(); } catch (IOException ignored) {}
            server = null;
        }
    }
    private void listen() throws IOException {
        ServerSocket listener = new ServerSocket();
        listener.bind(new InetSocketAddress("127.0.0.1", 0), 8); server = listener;
        Thread accept = new Thread(() -> {
            while (!listener.isClosed()) try {
                Socket socket = listener.accept(); socket.setSoTimeout(5000);
                try { workers.execute(() -> serve(socket)); } catch (RejectedExecutionException error) { socket.close(); }
            } catch (IOException error) { if (listener.isClosed()) return; }
        }, "Wild Buzzard file transfers");
        accept.setDaemon(true); accept.start();
    }
    private void serve(Socket socket) {
        try (Socket connection = socket) {
            InputStream input = connection.getInputStream(); ByteArrayOutputStream header = new ByteArrayOutputStream();
            int ending = 0;
            while (header.size() < 8192 && ending != 0x0d0a0d0a) {
                int value = input.read(); if (value < 0) return;
                header.write(value); ending = (ending << 8) | value;
            }
            if (ending != 0x0d0a0d0a) return;
            String[] lines = header.toString("US-ASCII").split("\r\n");
            String[] request = lines[0].split(" ");
            String bearer = null; boolean origin = false;
            for (int i = 1; i < lines.length; i++) {
                int separator = lines[i].indexOf(':'); if (separator < 1) continue;
                String name = lines[i].substring(0, separator).trim().toLowerCase(Locale.ROOT);
                if (name.equals("origin")) origin = true;
                if (name.equals("authorization")) {
                    if (bearer != null) return;
                    bearer = lines[i].substring(separator + 1).trim();
                }
            }
            Entry entry = null;
            if (request.length == 3 && request[0].equals("GET") && request[1].matches("/files/[a-f0-9-]{36}") && !origin) {
                synchronized (this) { entry = entries.get(request[1].substring(7)); }
            }
            boolean valid = entry != null && entry.deadline > android.os.SystemClock.elapsedRealtime() && bearer != null
                && MessageDigest.isEqual(("Bearer " + entry.token).getBytes(StandardCharsets.US_ASCII), bearer.getBytes(StandardCharsets.US_ASCII));
            if (valid) try { entry.access.check.run(); } catch (Exception error) { valid = false; }
            OutputStream output = connection.getOutputStream();
            if (!valid) { output.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII)); return; }
            try (InputStream file = new FileInputStream(entry.file)) {
                String mime = entry.mime.matches("[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+") ? entry.mime : "application/octet-stream";
                long length = entry.file.length();
                output.write(("HTTP/1.1 200 OK\r\nContent-Length: " + length + "\r\nContent-Type: " + mime + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                byte[] buffer = new byte[65536]; int count; long sent = 0;
                while (sent < length && (count = file.read(buffer, 0, (int)Math.min(buffer.length, length - sent))) != -1) {
                    entry.access.check.run();
                    if (entry.deadline <= android.os.SystemClock.elapsedRealtime()) return;
                    output.write(buffer, 0, count); sent += count;
                }
            }
        } catch (Exception ignored) { /* Interrupted, expired or revoked transfers stop immediately. */ }
    }
}
