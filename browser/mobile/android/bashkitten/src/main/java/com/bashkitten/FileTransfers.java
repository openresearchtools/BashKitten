// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.content.ContentValues;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.WebResponse;

/** Revocable per-file bearer grants. No directory listing or user-supplied filesystem path. */
final class FileTransfers {
    private final BrowserApp app;
    private final Map<String, Entry> entries = new HashMap<>();
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private ServerSocket server;
    private int generation;
    private final List<Download> downloads = new ArrayList<>();
    private final Set<Runnable> downloadListeners = new HashSet<>();
    private boolean watchingDownloads;
    static final class Download {
        final String name, mime;
        final BooleanSupplier current;
        final InputStream input;
        final long expected;
        volatile long received;
        volatile String cancelled;
        String status = "Downloading…";
        Uri saved;
        boolean finished;
        Download(String name, String mime, long expected, GeckoSession session, InputStream input, AgentRuntime agent) {
            this.name = name; this.mime = mime; this.expected = expected;
            this.current = agent.downloadAccess(session); this.input = input;
        }
    }
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

    // Agent downloads keep Gecko's existing authenticated response body. They
    // never issue a second request through Android's public DownloadManager or
    // another transport. A slow encrypted stream has no lifetime/speed deadline.
    void download(GeckoSession source, WebResponse response) {
        // WebResponse otherwise installs a 30-second per-read timeout, including
        // external downloads. Tor can legitimately pause longer between bytes;
        // explicit cancellation, access revocation and stream errors own expiry.
        response.setReadTimeoutMillis(0);
        if (!watchingDownloads) {
            watchingDownloads = true;
            app.agent.observe(() -> {
                for (Download transfer : new ArrayList<>(downloads)) if (!transfer.finished && !current(transfer))
                    cancelDownload(transfer, "The Agent connection changed");
            });
        }
        String name = mozilla.components.support.utils.DownloadUtils.INSTANCE.extractFileNameFromUrl(response.headers.get("Content-Disposition"), response.uri);
        String mime = Objects.toString(response.headers.get("Content-Type"), "application/octet-stream");
        long expected = -1;
        try { expected = Long.parseLong(response.headers.get("Content-Length")); } catch (Exception ignored) {}
        // Gecko exposes decoded bytes when a server applied content encoding.
        String encoding = response.headers.get("Content-Encoding");
        if (encoding != null && !encoding.equalsIgnoreCase("identity")) expected = -1;
        Download transfer = new Download(name, mime, expected, source, response.body, app.agent);
        downloads.add(transfer); downloadsChanged();
        boolean accepted = current(transfer) && (response.statusCode == 200 || response.uri.startsWith("blob:") && response.statusCode == 0);
        execute(() -> saveDownload(transfer, accepted));
    }
    List<Download> downloads() { return new ArrayList<>(downloads); }
    void observeDownloads(Runnable listener) { downloadListeners.add(listener); listener.run(); }
    void detachDownloads(Runnable listener) { downloadListeners.remove(listener); }
    void dismissDownload(Download transfer) { if (transfer.finished) { downloads.remove(transfer); downloadsChanged(); } }
    void cancelDownload(Download transfer, String reason) {
        if (transfer.finished || transfer.cancelled != null) return;
        transfer.cancelled = reason;
        transfer.status = "Cancelling…"; downloadsChanged();
        execute(() -> { try { if (transfer.input != null) transfer.input.close(); } catch (IOException ignored) {} });
    }
    private boolean current(Download transfer) {
        return transfer.current.getAsBoolean();
    }
    private void downloadsChanged() { for (Runnable listener : new ArrayList<>(downloadListeners)) listener.run(); }
    private void saveDownload(Download transfer, boolean accepted) {
        Uri target = null;
        String failure = null;
        try (InputStream input = transfer.input) {
            if (!accepted || input == null) throw new IOException("The download was refused");
            if (transfer.cancelled != null) throw new IOException(transfer.cancelled);
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, transfer.name);
            values.put(MediaStore.Downloads.MIME_TYPE, transfer.mime);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            target = app.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (target == null) throw new IOException("Cannot create the download");
            try (OutputStream output = app.getContentResolver().openOutputStream(target)) {
                if (output == null) throw new IOException("Cannot write the download");
                byte[] bytes = new byte[65536]; int count; long shown = 0;
                while ((count = input.read(bytes)) != -1) {
                    if (transfer.cancelled != null) throw new IOException(transfer.cancelled);
                    output.write(bytes, 0, count); transfer.received += count;
                    long now = SystemClock.elapsedRealtime();
                    if (now - shown >= 250) { shown = now; app.main.post(this::downloadsChanged); }
                }
                if (transfer.cancelled != null) throw new IOException(transfer.cancelled);
                if (transfer.expected >= 0 && transfer.received != transfer.expected) throw new IOException("The download was interrupted before the complete file arrived");
            }
            // Recheck access on the UI owner before publishing a completed file.
            // The worker remains asynchronous; no disk/stream work runs there.
        } catch (Exception error) { failure = error.getMessage() == null ? "Download failed" : error.getMessage(); }
        Uri downloaded = target; String error = failure;
        app.main.post(() -> {
            String refused = transfer.cancelled != null ? transfer.cancelled : !current(transfer) ? "The Agent connection changed" : error;
            execute(() -> {
                String result = refused;
                if (downloaded != null) try {
                    if (result == null) {
                        ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.IS_PENDING, 0);
                        if (app.getContentResolver().update(downloaded, values, null, null) != 1) throw new IOException("Cannot finish the download");
                    } else app.getContentResolver().delete(downloaded, null, null);
                } catch (Exception storageError) {
                    result = "Cannot finish saving the download";
                    try { app.getContentResolver().delete(downloaded, null, null); } catch (Exception ignored) {}
                }
                String outcome = result;
                app.main.post(() -> {
                    String stopped = transfer.cancelled != null ? transfer.cancelled : !current(transfer) ? "The Agent connection changed" : null;
                    if (outcome == null && stopped != null && downloaded != null) {
                        execute(() -> {
                            try { app.getContentResolver().delete(downloaded, null, null); } catch (Exception ignored) {}
                            app.main.post(() -> finishDownload(transfer, null, stopped));
                        });
                    } else finishDownload(transfer, outcome == null ? downloaded : null, outcome);
                });
            });
        });
    }
    private void finishDownload(Download transfer, Uri saved, String error) {
        transfer.finished = true; transfer.saved = saved;
        transfer.status = error == null ? "Saved in Downloads" : error;
        downloadsChanged();
    }
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
