// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.net.Uri;
import java.io.*;
import java.net.URI;
import java.nio.file.Files;
import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.json.JSONObject;
import org.mozilla.geckoview.*;

/** Prepared documents cross into ordinary tabs as files, never as Agent sessions. */
final class DocumentPreviews {
    private final BrowserApp app;
    private final File root;
    private final Set<Transfer> pending = new HashSet<>();
    private final Map<String, Transfer> opened = new HashMap<>();
    private static final class Transfer {
        final BooleanSupplier current;
        final String context = "bashkitten-preview-" + UUID.randomUUID();
        volatile boolean cancelled;
        volatile InputStream input;
        volatile File directory;
        GeckoResult<WebResponse> request;
        BrowserApp.Tab tab;
        Transfer(BooleanSupplier current) { this.current = current; }
        void cancel() {
            cancelled = true;
            if (request != null) request.cancel();
            try { if (input != null) input.close(); } catch (IOException ignored) {}
        }
    }
    DocumentPreviews(BrowserApp app) {
        this.app = app;
        File parent = new File(app.getCacheDir(), "document-previews");
        root = new File(parent, UUID.randomUUID().toString());
        // A killed Android process cannot run shutdown hooks. Its private files
        // are removed when the application starts again; preview tabs are private.
        app.transfers.execute(() -> {
            File[] stale = parent.listFiles();
            if (stale != null) for (File file : stale) if (!file.equals(root)) remove(file);
        });
        app.agent.observe(() -> {
            for (Transfer transfer : new ArrayList<>(pending)) if (!transfer.current.getAsBoolean()) transfer.cancel();
        });
    }
    void open(GeckoSession source, String value, BooleanSupplier current, Consumer<String> reply) throws Exception {
        URI own = URI.create(app.agent.url), target = own.resolve(value);
        if (!current.getAsBoolean() || !"https".equals(target.getScheme()) ||
                !Objects.equals(own.getScheme(), target.getScheme()) || !Objects.equals(own.getHost(), target.getHost()) || own.getPort() != target.getPort() ||
                target.getRawUserInfo() != null || target.getRawQuery() != null || target.getRawFragment() != null ||
                !target.getRawPath().matches("/api/files/previews/[a-f0-9-]{36}/content")) throw new SecurityException("Invalid prepared document");
        Transfer transfer = new Transfer(current); pending.add(transfer);
        WebRequest request = new WebRequest.Builder(target.toASCIIString())
            .contextId(source.getSettings().getContextId()).cacheMode(WebRequest.CACHE_MODE_NO_STORE)
            .header("Origin", own.getScheme() + "://" + own.getRawAuthority()).header("Accept-Encoding", "identity").build();
        try {
            transfer.request = new GeckoWebExecutor(app.host.runtime()).fetch(request,
                GeckoWebExecutor.FETCH_FLAGS_NO_REDIRECTS | GeckoWebExecutor.FETCH_FLAGS_SAVE_AS_DOWNLOAD);
        } catch (Exception error) { pending.remove(transfer); throw error; }
        transfer.request.accept(response -> {
            transfer.input = response.body;
            if (transfer.cancelled || !current.getAsBoolean()) transfer.cancel();
            app.transfers.execute(() -> {
                File file = null; Exception failure = null;
                try (InputStream input = response.body) {
                    if (transfer.cancelled || response.statusCode != 200 || response.redirected || !target.toASCIIString().equals(response.uri) || input == null) throw new IOException("The document request was cancelled or refused");
                    String mime = Objects.toString(response.headers.get("Content-Type"), "").split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
                    if (!mime.equals("application/pdf") && !mime.equals("text/html")) throw new IOException("The server did not return a prepared PDF or document");
                    long expected = Long.parseLong(Objects.toString(response.headers.get("Content-Length"), "-1"));
                    if (expected < 0) throw new IOException("The prepared document has no complete file length");
                    if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create temporary document folder");
                    transfer.directory = Files.createTempDirectory(root.toPath(), "preview-").toFile();
                    file = new File(transfer.directory, mime.equals("application/pdf") ? "document.pdf" : "document.html");
                    try (OutputStream output = new FileOutputStream(file)) {
                        byte[] bytes = new byte[65536]; int count; long received = 0;
                        while ((count = input.read(bytes)) != -1) {
                            if (transfer.cancelled) throw new IOException("The selected Agent changed");
                            output.write(bytes, 0, count); received += count;
                        }
                        if (received != expected) throw new IOException("The document transfer was interrupted");
                    }
                } catch (Exception error) { failure = error; }
                File document = file; Exception error = failure;
                app.main.post(() -> {
                    if (error != null || transfer.cancelled || !current.getAsBoolean()) { finish(transfer, reply, error == null ? "The selected Agent changed" : error.getMessage()); return; }
                    try {
                        BrowserApp.Tab tab = app.host.create(BrowserApp.USER, transfer.context);
                        transfer.tab = tab; app.tabs.put(tab.id, tab);
                        app.ensure(tab, () -> {
                            try {
                                if (transfer.cancelled || !current.getAsBoolean() || !app.host.refresh(tab)) throw new IOException("The selected Agent or document tab changed");
                                tab.session.loadUri(Uri.fromFile(document).toString()); app.show(tab);
                                pending.remove(transfer); opened.put(tab.id, transfer);
                                reply.accept("{\"result\":{\"ok\":true}}");
                            } catch (Exception setupError) { finish(transfer, reply, setupError.getMessage()); }
                        }, message -> finish(transfer, reply, message));
                    } catch (Exception setupError) { finish(transfer, reply, setupError.getMessage()); }
                });
            });
        }, error -> finish(transfer, reply, "The document request failed"));
    }
    private void finish(Transfer transfer, Consumer<String> reply, String error) {
        pending.remove(transfer); transfer.cancel();
        if (transfer.tab != null) {
            opened.remove(transfer.tab.id);
            try { app.close(transfer.tab); } catch (Exception ignored) {}
        }
        cleanup(transfer);
        try { reply.accept(new JSONObject().put("error", error == null ? "Document unavailable" : error).toString()); }
        catch (Exception ignored) {}
    }
    void tabsChanged(Set<String> tabs) {
        for (String id : new ArrayList<>(opened.keySet())) if (!tabs.contains(id)) cleanup(opened.remove(id));
    }
    void close() {
        for (Transfer transfer : new ArrayList<>(pending)) transfer.cancel();
        for (Transfer transfer : opened.values()) cleanup(transfer);
        opened.clear();
    }
    private void cleanup(Transfer transfer) {
        app.host.runtime().getStorageController().clearDataForSessionContext(transfer.context);
        app.transfers.execute(() -> remove(transfer.directory));
    }
    private static void remove(File file) {
        if (file == null) return;
        File[] children = file.listFiles(); if (children != null) for (File child : children) remove(child);
        file.delete();
    }
}
