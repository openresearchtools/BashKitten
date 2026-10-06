// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Revocable per-file bearer grants. No directory listing or user-supplied filesystem path. */
final class FileTransfers {
    private final BrowserApp app;
    private final Map<String, Entry> entries = new HashMap<>();
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private ServerSocket server;
    private int generation;
    private static final class Entry {
        final File file;
        final String token, mime;
        final boolean temporary;
        final AgentController.Access access;
        Entry(File file, String mime, boolean temporary, AgentController.Access access) {
            this.file = file; this.mime = mime; this.temporary = temporary; this.access = access;
            token = CommandProtocol.hex(CommandProtocol.random(32));
        }
    }
    FileTransfers(BrowserApp app) { this.app = app; }
    void execute(Runnable work) { workers.execute(work); }
    JSONObject grant(File file, String mime, boolean temporary, AgentController.Access access) throws Exception {
        final int version;
        synchronized (this) { version = generation; }
        access.check.run();
        if (!file.isFile()) throw new IOException("Downloaded file is unavailable");
        prune();
        String id = UUID.randomUUID().toString();
        Entry entry = new Entry(file, mime, temporary, access);
        boolean needsListener;
        synchronized (this) { needsListener = server == null; }
        ServerSocket candidate = needsListener ? new ServerSocket() : null;
        try {
            if (candidate != null) candidate.bind(new InetSocketAddress("127.0.0.1", 0));
            ServerSocket listener;
            boolean start;
            synchronized (this) {
                if (version != generation) throw new SecurityException("File transfers revoked");
                start = server == null;
                if (start && candidate == null) throw new SecurityException("File transfers revoked");
                if (start) { server = candidate; candidate = null; }
                listener = server; entries.put(id, entry);
            }
            if (start) listen(listener);
            String url = "http://127.0.0.1:" + listener.getLocalPort() + "/files/" + id;
            return new JSONObject().put("url", url).put("token", entry.token)
                .put("size", file.length()).put("mimeType", mime)
                .put("wget", "wget --header='Authorization: Bearer " + entry.token + "' -O '" +
                    file.getName().replace("'", "'\\''") + "' '" + url + "'");
        } finally { if (candidate != null) candidate.close(); }
    }
    void revokeAll() {
        final List<Entry> revoked;
        final ServerSocket listener;
        synchronized (this) {
            generation++; revoked = new ArrayList<>(entries.values()); entries.clear();
            listener = server; server = null;
        }
        workers.execute(() -> {
            if (listener != null) try { listener.close(); } catch (IOException ignored) {}
            for (Entry entry : revoked) if (entry.temporary) entry.file.delete();
        });
    }
    private void prune() {
        final Map<String, Entry> snapshot;
        synchronized (this) { snapshot = new HashMap<>(entries); }
        for (Map.Entry<String, Entry> value : snapshot.entrySet()) {
            Entry entry = value.getValue();
            boolean revoked = false;
            try { entry.access.check.run(); } catch (Exception error) { revoked = true; }
            if (revoked) {
                synchronized (this) { entries.remove(value.getKey(), entry); }
                if (entry.temporary) entry.file.delete();
            }
        }
    }
    private void listen(ServerSocket listener) {
        Thread accept = new Thread(() -> {
            while (!listener.isClosed()) try {
                Socket socket = listener.accept();
                try { workers.execute(() -> serve(socket)); } catch (RejectedExecutionException error) { socket.close(); }
            } catch (IOException error) { if (listener.isClosed()) return; }
        }, "BashKitten file transfers");
        accept.setDaemon(true); accept.start();
    }
    private void serve(Socket socket) {
        try (Socket connection = socket) {
            InputStream input = connection.getInputStream(); ByteArrayOutputStream header = new ByteArrayOutputStream();
            int ending = 0;
            while (ending != 0x0d0a0d0a) {
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
            boolean valid = entry != null && bearer != null
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
                    output.write(buffer, 0, count); sent += count;
                }
            }
        } catch (Exception ignored) { /* Interrupted or revoked transfers stop immediately. */ }
    }
}
