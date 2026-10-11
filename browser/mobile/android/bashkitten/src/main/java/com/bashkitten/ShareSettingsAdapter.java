// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.json.JSONObject;

/** Local-only host operations; never forwards administration over a remote route. */
public final class ShareSettingsAdapter {
    private static final int SAVE_QR = 4821;
    private static final Set<String> COMMANDS = Set.of("share-status", "share-setup", "share-reissue", "share-confirm", "share-cancel", "share-publish", "share-startup", "share-files", "service-status", "service-save", "service-remove", "service-action", "localai-share");
    private final Activity activity;
    private final AgentRuntime runtime;
    private final String installation;
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private final Set<CompletableFuture<JSONObject>> requests = new HashSet<>();
    private JSONObject pendingSetup;
    private String connectionQr = "", exportQr;
    private CompletableFuture<JSONObject> exportResult;
    private boolean closed, busy;

    public ShareSettingsAdapter(Activity activity, Consumer<JSONObject> events) {
        this.activity = activity; runtime = BrowserApp.get(activity).agent;
        installation = runtime.termux.installationId();
    }
    private boolean sameInstallation() {
        return installation.equals(runtime.termux.installationId()) && runtime.termux.permissionGranted()
            && installation.equals(runtime.app.policies.getString("agent.termuxInstallation", ""));
    }
    private void authorize() {
        if (closed || activity.isDestroyed()) throw new IllegalStateException("Share Local settings closed");
        if (!sameInstallation() || runtime.shareNeedsSetup()) throw new SecurityException("Complete Local setup before changing Share Local.");
    }
    public CompletableFuture<JSONObject> dispatch(String method, JSONObject args) {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        activity.runOnUiThread(() -> {
            if (closed) { result.completeExceptionally(new IllegalStateException("Share Local settings closed")); return; }
            if (busy) { result.completeExceptionally(new IllegalStateException("Wait for the current Share Local operation.")); return; }
            busy = true; requests.add(result);
            result.whenComplete((value, error) -> { requests.remove(result); busy = false; });
            try {
                if (method.equals("share-local-setup")) {
                    if (runtime.selected.equals("local")) runtime.turnOn(); else runtime.select("local");
                    BrowserApp app = BrowserApp.get(activity);
                    activity.startActivity(app.host.launchIntent().putExtra("bashkitten.openAgent", true));
                    result.complete(new JSONObject()); app.main.post(activity::finish); return;
                }
                if (method.equals("share-status") && runtime.shareNeedsSetup()) { result.complete(object("needsSetup", true)); return; }
                authorize();
                if (method.equals("share-save-qr")) { saveQr(result); return; }
                if (method.equals("share-open-authenticator")) {
                    requireSetup(args);
                    Uri uri = Uri.parse(pendingSetup.optString("otpauthUrl"));
                    if (!"otpauth".equals(uri.getScheme()) || !"totp".equals(uri.getHost())) throw new SecurityException("Invalid authenticator setup address.");
                    try { activity.startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException error) { throw new IllegalStateException("No authenticator app is installed. Scan the QR with an authenticator on another device."); }
                    result.complete(new JSONObject()); return;
                }
                if (method.equals("share-open-localai")) { AgentSettingsActivity.open(activity, "localai"); result.complete(new JSONObject()); return; }
                if (!COMMANDS.contains(method)) throw new SecurityException("Unsupported Share Local operation");
                if (method.equals("share-startup") && (args.length() != 1 || !(args.get("enabled") instanceof Boolean))) throw new IllegalArgumentException("Choose whether publishing starts automatically");
                if (method.equals("share-confirm") || method.equals("share-cancel")) requireSetup(args);
                if ((method.equals("share-setup") || method.equals("share-reissue")) && pendingSetup != null) throw new IllegalStateException("Finish or cancel the current authenticator setup first.");
                if (method.equals("service-action") && !Set.of("start", "stop", "reload").contains(args.optString("action"))) throw new IllegalArgumentException("Unsupported service action");
                JSONObject input = new JSONObject(args.toString());
                boolean start = method.equals("share-setup") || method.equals("share-reissue")
                    || method.equals("share-publish") && input.optBoolean("enabled")
                    || method.equals("service-action") && !input.optString("action").equals("stop");
                Runnable send = () -> {
                    try {
                        authorize();
                        runtime.command(method, input, value -> {
                            if (closed) { cancel(value); return; }
                            try {
                                authorize();
                                if (method.equals("share-setup") || method.equals("share-reissue")) pendingSetup = value;
                                if (method.equals("share-confirm") || method.equals("share-cancel")) pendingSetup = null;
                                if (value.optString("phase").equals("ready")) connectionQr = value.optString("qrDataUrl");
                                result.complete(value);
                            } catch (Exception error) { cancel(value); result.completeExceptionally(error); }
                        }, error -> result.completeExceptionally(new IllegalStateException(error)));
                    } catch (Exception error) { result.completeExceptionally(error); }
                    finally { input.remove("password"); input.remove("code"); }
                };
                if (method.equals("share-status")) runtime.termux.probe(value -> {
                    if (!value.optBoolean("packages")) result.complete(object("needsSetup", true)); else send.run();
                }, error -> result.completeExceptionally(new IllegalStateException(error)));
                else if (start) runtime.startShareLocal(send, error -> { input.remove("password"); input.remove("code"); result.completeExceptionally(new IllegalStateException(error)); });
                else send.run();
            } catch (Exception error) { result.completeExceptionally(error); }
        });
        return result;
    }
    private void requireSetup(JSONObject args) {
        if (pendingSetup == null || !pendingSetup.optString("setupId").equals(args.optString("setupId"))) throw new SecurityException("Authenticator setup expired. Start again from Share Local.");
    }
    private static byte[] png(String value) {
        if (value == null || !value.matches("data:image/png;base64,[a-zA-Z0-9+/=]+")) throw new IllegalArgumentException("No valid connection QR is available.");
        return Base64.decode(value.substring("data:image/png;base64,".length()), Base64.NO_WRAP);
    }
    private void saveQr(CompletableFuture<JSONObject> result) {
        if (connectionQr.isEmpty()) throw new IllegalStateException("Refresh Share Local before exporting the connection QR.");
        exportQr = connectionQr; exportResult = result;
        try { activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("image/png").putExtra(Intent.EXTRA_TITLE, "bashkitten-connection.png"), SAVE_QR); }
        catch (ActivityNotFoundException error) { exportQr = null; exportResult = null; throw new IllegalStateException("Android could not open the save picker."); }
    }
    public boolean onActivityResult(int request, int result, Intent data) {
        if (request != SAVE_QR) return false;
        CompletableFuture<JSONObject> completion = exportResult; String encoded = exportQr;
        exportResult = null; exportQr = null;
        if (completion == null || closed) return true;
        if (result != Activity.RESULT_OK || data == null || data.getData() == null) { completion.complete(object("cancelled", true)); return true; }
        try { authorize(); } catch (Exception error) { completion.completeExceptionally(error); return true; }
        Uri target = data.getData();
        files.execute(() -> {
            byte[] bytes = null;
            try {
                bytes = png(encoded);
                try (OutputStream output = activity.getContentResolver().openOutputStream(target, "wt")) {
                    if (output == null) throw new IllegalStateException("The selected location is not writable.");
                    output.write(bytes);
                }
                runtime.app.main.post(() -> completion.complete(object("saved", true)));
            } catch (Exception error) { runtime.app.main.post(() -> completion.completeExceptionally(new IllegalStateException("The QR image could not be saved. Choose a writable location and retry."))); }
            finally { if (bytes != null) Arrays.fill(bytes, (byte)0); }
        });
        return true;
    }
    private void cancel(JSONObject value) {
        if (value == null || !value.has("setupId") || !sameInstallation()) return;
        runtime.command("share-cancel", object("setupId", value.optString("setupId")), ignored -> {}, ignored -> {});
    }
    private static JSONObject object(String key, Object value) {
        try { return new JSONObject().put(key, value); } catch (Exception error) { throw new IllegalArgumentException(error); }
    }
    public void close() {
        if (closed) return;
        closed = true; cancel(pendingSetup); pendingSetup = null; connectionQr = ""; exportQr = null; exportResult = null;
        for (CompletableFuture<JSONObject> request : new HashSet<>(requests)) request.completeExceptionally(new IllegalStateException("Share Local settings closed"));
        requests.clear(); files.shutdownNow();
    }
}
