// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** One application-owned updater. Settings views observe it without owning APT. */
public final class UpdatesController {
    private final BrowserApp app;
    private final AgentRuntime runtime;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Set<Runnable> listeners = new HashSet<>();
    private final CompletableFuture<JSONObject> target = new CompletableFuture<>();
    private String script, preparer, version = "", availableUrl, checkError = "", matchingError = "";
    private String channel;
    private long versionCode, statusUnavailableSince;
    private JSONObject available;
    private boolean checking, checked, matching, polling, presented, attempted;
    private String installation = "";
    private CompletableFuture<Void> readiness;
    private JSONObject packageStatus = new JSONObject();

    UpdatesController(BrowserApp app, AgentRuntime runtime) {
        this.app = app; this.runtime = runtime;
        channel = "nightly".equals(app.policies.getString("updates.channel", "stable")) ? "nightly" : "stable";
        io.execute(() -> {
            try {
                android.content.pm.PackageInfo info = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
                JSONObject manifest;
                try (InputStream input = app.getAssets().open("termux-update.json")) {
                    manifest = new JSONObject(new String(input.readAllBytes(), StandardCharsets.UTF_8));
                }
                byte[] bootstrap;
                try (InputStream input = app.getAssets().open("updates-bootstrap.mjs")) { bootstrap = input.readAllBytes(); }
                StringBuilder hash = new StringBuilder();
                for (byte item : MessageDigest.getInstance("SHA-256").digest(bootstrap)) hash.append(String.format(java.util.Locale.ROOT, "%02x", item & 255));
                if (!hash.toString().equals(manifest.getString("bootstrapSha256"))) throw new IllegalStateException("This app’s update helper is invalid.");
                String source = new String(bootstrap, StandardCharsets.UTF_8);
                String preparation;
                try (InputStream input = app.getAssets().open("updates-prepare.py")) { preparation = new String(input.readAllBytes(), StandardCharsets.UTF_8); }
                if (manifest.getInt("schema") != 1 || !manifest.getString("productVersion").equals(info.versionName) ||
                    !manifest.getString("apkAbi").equals(TermuxConnection.downloadAbi()) || !manifest.getString("sourceCommit").matches("[a-f0-9]{40}"))
                    throw new IllegalStateException("This app's Termux update manifest is invalid.");
                app.main.post(() -> { version = info.versionName; versionCode = info.getLongVersionCode(); script = source; preparer = preparation; target.complete(manifest); changed(); });
            } catch (Exception error) { app.main.post(() -> { target.completeExceptionally(error); changed(); }); }
        });
    }
    void observe(Runnable listener) { listeners.add(listener); }
    void removeObserver(Runnable listener) { listeners.remove(listener); }
    private void changed() { for (Runnable listener : new HashSet<>(listeners)) listener.run(); runtime.changed(); }
    private static JSONObject object(Object... values) { return AgentSettingsActivity.object(values); }
    private static String message(Throwable error) {
        while (error.getCause() != null) error = error.getCause();
        return error.getMessage() == null ? "The update could not be completed." : error.getMessage();
    }
    private void authorized(String expectedInstallation) {
        if (!runtime.localSetupReady() || !expectedInstallation.equals(runtime.termux.installationId()))
            throw new SecurityException("Complete Local setup and allow BashKitten to use Termux.");
    }
    private CompletableFuture<JSONObject> request(String mode, String kind, boolean retry) {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        String requestedChannel = channel;
        target.whenComplete((manifest, error) -> app.main.post(() -> {
            if (error != null) { result.completeExceptionally(error); return; }
            String expected = runtime.termux.installationId();
            try {
                authorized(expected);
                JSONObject input = object("mode", mode, "target", manifest, "channel", requestedChannel);
                if (kind != null) input.put("kind", kind);
                if (retry) input.put("retry", true);
                runtime.termux.updates(script, preparer, input, value -> {
                    try {
                        authorized(expected);
                        if (!mode.equals("inventory")) {
                            packageStatus = value;
                            if (value.optBoolean("matched")) matchingError = "";
                        }
                        result.complete(value);
                        // A read must not emit another read-triggering event.
                        if (mode.equals("start") || mode.equals("cancel")) changed();
                    }
                    catch (Exception failure) { result.completeExceptionally(failure); }
                }, failure -> result.completeExceptionally(new IllegalStateException(failure)));
            } catch (Exception failure) { result.completeExceptionally(failure); }
        }));
        return result;
    }
    /** Coalesced before native Termux startup, including when Local is saved Off. */
    CompletableFuture<Void> ensureMatching() {
        String current = runtime.termux.installationId();
        if (!installation.equals(current)) { readiness = null; attempted = false; presented = false; }
        if (readiness != null && !readiness.isCompletedExceptionally()) return readiness;
        boolean mayStart = !attempted; attempted = true;
        installation = current; statusUnavailableSince = 0; readiness = new CompletableFuture<>();
        CompletableFuture<Void> result = readiness;
        matchingError = "";
        request("status", null, false).whenComplete((value, error) -> app.main.post(() -> {
            if (result != readiness) return;
            if (error != null) { finishMatching(result, error); return; }
            if (jobActive(value)) { matching = true; presentProgress(); waitForMatching(result); return; }
            if (value.optBoolean("matched")) { finishMatching(result, null); return; }
            if (!mayStart) { finishMatching(result, new IllegalStateException("Retry the package update in Configuration → Updates.")); return; }
            matching = true; presentProgress(); changed();
            request("start", "match-packages", false).whenComplete((started, failure) -> app.main.post(() -> {
                if (result != readiness) return;
                if (failure != null) finishMatching(result, failure); else waitForMatching(result);
            }));
        }));
        return result;
    }
    private static boolean jobActive(JSONObject value) {
        JSONObject job = value.optJSONObject("job");
        return job != null && Set.of("running", "waiting").contains(job.optString("status"));
    }
    private void presentProgress() {
        Activity activity = runtime.activity.get();
        if (presented || activity == null || activity.isFinishing() || activity.isDestroyed()) return;
        presented = true; AgentSettingsActivity.open(activity, "updates");
    }
    private void finishMatching(CompletableFuture<Void> owner, Throwable error) {
        if (owner != readiness) return;
        matching = false;
        if (error == null) owner.complete(null);
        else { matchingError = message(error); owner.completeExceptionally(error); presentProgress(); }
        changed();
    }
    private void waitForMatching(CompletableFuture<Void> owner) {
        if (owner != readiness || owner.isDone()) return;
        if (polling) return;
        polling = true;
        request("status", null, false).whenComplete((value, error) -> app.main.post(() -> {
            polling = false;
            if (owner != readiness || owner.isDone()) return;
            if (error != null) {
                // dpkg briefly replaces Node/modules underneath the independent
                // updater. Retain its known job, without starting another one.
                long now = android.os.SystemClock.elapsedRealtime();
                if (statusUnavailableSince == 0) statusUnavailableSince = now;
                if (jobActive(packageStatus) && runtime.localSetupReady() && installation.equals(runtime.termux.installationId()) && now - statusUnavailableSince < 60000) {
                    matchingError = "Waiting for updater status: " + message(error); changed();
                    app.main.postDelayed(() -> waitForMatching(owner), 1500); return;
                }
                finishMatching(owner, error); return;
            }
            statusUnavailableSince = 0; matchingError = "";
            JSONObject job = value.optJSONObject("job");
            String state = job == null ? "" : job.optString("status");
            if (!jobActive(value)) {
                if (value.optBoolean("matched") && (state.isEmpty() || state.equals("complete"))) { finishMatching(owner, null); return; }
                finishMatching(owner, new IllegalStateException(job == null ? "The required Termux packages are unavailable." : job.optString("error", "The required Termux packages have not been installed."))); return;
            }
            changed();
            app.main.postDelayed(() -> waitForMatching(owner), 1500);
        }));
    }
    CompletableFuture<JSONObject> snapshot() {
        if (!runtime.localSetupReady()) return CompletableFuture.completedFuture(view());
        return request("status", null, false).handle((value, error) -> {
            if (error != null) matchingError = message(error);
            return view();
        });
    }
    private JSONObject view() {
        return object("browser", object("version", version, "versionCode", versionCode, "available", available, "channel", channel,
            "checking", checking, "checked", checked, "error", checkError),
            "termux", object("needsSetup", !runtime.localSetupReady(), "matching", packageStatus.optBoolean("matched"),
                "updating", matching, "error", matchingError), "packages", packageStatus);
    }
    CompletableFuture<JSONObject> packages(String kind, boolean retry) {
        if (!Set.of("check-packages", "update-packages", "match-packages", "refresh-lists", "recover-packages", "update-pi", "rollback-pi").contains(kind))
            return CompletableFuture.failedFuture(new IllegalArgumentException("Unknown package operation."));
        if (kind.equals("match-packages")) {
            if (readiness == null || readiness.isDone()) {
                readiness = null; attempted = false; matchingError = "";
                Runnable restore = runtime.afterPackageUpdate();
                ensureMatching().thenRun(() -> app.main.post(restore));
            }
            return CompletableFuture.completedFuture(view());
        }
        if (kind.equals("update-pi") || kind.equals("rollback-pi")) return request("start", kind, retry);
        if (matching || readiness != null && !readiness.isDone()) return CompletableFuture.failedFuture(new IllegalStateException("A package update is already running."));
        installation = runtime.termux.installationId(); statusUnavailableSince = 0; attempted = true;
        CompletableFuture<Void> owner = readiness = new CompletableFuture<>();
        matching = true; matchingError = ""; changed();
        Runnable restore = runtime.afterPackageUpdate();
        CompletableFuture<JSONObject> started = request("start", kind, retry);
        started.whenComplete((value, error) -> app.main.post(() -> {
            if (owner != readiness) return;
            if (error != null) { finishMatching(owner, error); return; }
            if (kind.equals("update-packages") || kind.equals("recover-packages")) {
                owner.thenRun(() -> app.main.post(restore));
            }
            waitForMatching(owner);
        }));
        return started;
    }
    CompletableFuture<JSONObject> cancel() { return request("cancel", null, false); }
    CompletableFuture<JSONObject> inventory() { return request("inventory", null, false); }
    CompletableFuture<JSONObject> channel(String value) {
        if (!Set.of("stable", "nightly").contains(value)) return CompletableFuture.failedFuture(new IllegalArgumentException("Unknown update channel."));
        if (checking || matching || jobActive(packageStatus)) return CompletableFuture.failedFuture(new IllegalStateException("Wait for the current update operation before changing channel."));
        if (!channel.equals(value)) {
            channel = value;
            app.policies.edit().putString("updates.channel", value).apply();
            checked = false; available = null; availableUrl = null; checkError = "";
            JSONObject sources = packageStatus.optJSONObject("sources");
            if (sources != null) sources.remove("apt");
            changed();
        }
        return CompletableFuture.completedFuture(view());
    }
    CompletableFuture<JSONObject> check() {
        if (checking) return CompletableFuture.completedFuture(view());
        checking = true; checkError = ""; changed();
        String requestedChannel = channel;
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        target.whenComplete((manifest, error) -> {
            if (error != null) { app.main.post(() -> { checking = false; checkError = message(error); changed(); result.completeExceptionally(error); }); return; }
            io.execute(() -> {
                try {
                    long newest = versionCode; JSONObject found = null; String link = null;
                    for (int page = 1; ; page++) {
                        JSONArray releases = new JSONArray(metadata("https://api.github.com/repos/openresearchtools/bashkitten/releases?per_page=100&page=" + page));
                        for (int i = 0; i < releases.length(); i++) {
                            JSONObject release = releases.getJSONObject(i);
                            if (release.optBoolean("draft") || requestedChannel.equals("stable") && release.getBoolean("prerelease")) continue;
                            Map<String, String> assets = new HashMap<>(); JSONArray list = release.getJSONArray("assets");
                            for (int j = 0; j < list.length(); j++) { JSONObject asset = list.getJSONObject(j); assets.put(asset.getString("name"), asset.getString("browser_download_url")); }
                            if (!assets.containsKey("release.json")) continue;
                            JSONArray apps = new JSONObject(metadata(assets.get("release.json"))).getJSONArray("apps");
                            for (int j = 0; j < apps.length(); j++) {
                                JSONObject candidate = apps.getJSONObject(j);
                                if (!candidate.getString("packageId").equals(app.getPackageName()) || !candidate.getString("abi").equals(manifest.getString("apkAbi")) || candidate.getLong("versionCode") <= newest) continue;
                                String asset = candidate.getString("asset");
                                if (!asset.endsWith(".apk") || !assets.containsKey(asset)) throw new IllegalStateException("The published release is missing its matching APK.");
                                newest = candidate.getLong("versionCode"); link = assets.get(asset);
                                found = object("version", candidate.getString("versionName"), "versionCode", newest);
                            }
                        }
                        if (releases.length() < 100) break;
                    }
                    JSONObject candidate = found; String download = link;
                    app.main.post(() -> {
                        checking = false; checked = true; available = candidate; availableUrl = download; changed();
                        if (runtime.localSetupReady()) packages("check-packages", false).whenComplete((value, failure) -> {
                            if (failure == null) result.complete(view()); else result.completeExceptionally(failure);
                        }); else result.complete(view());
                    });
                } catch (Exception failure) { app.main.post(() -> { checking = false; checkError = message(failure); changed(); result.completeExceptionally(failure); }); }
            });
        });
        return result;
    }
    CompletableFuture<JSONObject> download(Activity activity) {
        if (availableUrl == null || available == null) return CompletableFuture.failedFuture(new IllegalStateException("Check for an app update first."));
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        app.create(BrowserApp.USER, false, availableUrl, tab -> {
            app.show(tab); activity.startActivity(app.host.launchIntent()); result.complete(new JSONObject());
        }, error -> result.completeExceptionally(new IllegalStateException(error)));
        return result;
    }
    private static String metadata(String url) throws Exception {
        URL address = new URL(url);
        if (!address.getProtocol().equals("https")) throw new IllegalArgumentException("Update metadata must use HTTPS.");
        HttpURLConnection connection = (HttpURLConnection)address.openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(15000); connection.setRequestProperty("Accept", "application/vnd.github+json");
        try (InputStream input = connection.getInputStream()) { return new String(input.readAllBytes(), StandardCharsets.UTF_8); }
        finally { connection.disconnect(); }
    }
}
