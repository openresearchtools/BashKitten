// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import androidx.appcompat.app.AlertDialog;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;

/** Typed adapter for the owned Remote Connections document; no credentials cross it. */
public final class RemoteSettingsAdapter implements AutoCloseable {
    public static final int ENROLLMENT_REQUEST = 6421;
    private final Activity activity;
    private final BrowserApp app;
    private final Consumer<JSONObject> event;
    private final Set<CompletableFuture<JSONObject>> pending = new HashSet<>();
    private final AgentRuntime.Listener listener;
    private CompletableFuture<JSONObject> enrollment;
    private AlertDialog keyDialog;
    private boolean closed;

    public RemoteSettingsAdapter(Activity activity, Consumer<JSONObject> event) {
        this.activity = activity; this.app = BrowserApp.get(activity); this.event = event;
        listener = () -> { if (live()) event.accept(object("type", "remotes.changed")); };
        app.agent.observe(listener);
    }
    private boolean live() { return !closed && !activity.isFinishing() && !activity.isDestroyed(); }
    private static JSONObject object(String key, Object value) {
        try { return new JSONObject().put(key, value); } catch (Exception error) { throw new IllegalArgumentException(error); }
    }
    private void done(CompletableFuture<JSONObject> result, JSONObject value) { if (live()) result.complete(value); }
    private void failed(CompletableFuture<JSONObject> result, String message) { result.completeExceptionally(new IllegalStateException(message)); }
    public CompletableFuture<JSONObject> dispatch(String method, JSONObject args) {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        app.main.post(() -> {
            if (!live()) { failed(result, "Remote settings closed"); return; }
            pending.add(result); result.whenComplete((value, error) -> app.main.post(() -> pending.remove(result)));
            try { handle(method, args, result); } catch (Exception error) { failed(result, error.getMessage()); }
        });
        return result;
    }
    private void handle(String method, JSONObject args, CompletableFuture<JSONObject> result) throws Exception {
        Consumer<String> failure = message -> failed(result, message);
        Consumer<JSONObject> services = value -> { try { done(result, publicServices(value)); } catch (Exception error) { failure.accept(error.getMessage()); } };
        String id = args.optString("id");
        switch (method) {
            case "remotes.list":
                app.agent.remotes(saved -> {
                    if (!live()) return;
                    try {
                        ArrayList<String> ids = new ArrayList<>(); saved.keys().forEachRemaining(ids::add);
                        ids.sort(Comparator.comparing(value -> saved.optJSONObject(value).optString("name", value), String.CASE_INSENSITIVE_ORDER));
                        JSONArray records = new JSONArray();
                        for (String key : ids) {
                            JSONObject record = saved.getJSONObject(key);
                            String state = app.agent.remoteConnected(key) ? "ready" : app.agent.selected.equals(key) && app.agent.isOnRequested() ? app.agent.state : "disconnected";
                            records.put(new JSONObject().put("id", key).put("name", record.optString("name", key)).put("state", state)
                                .put("error", app.agent.selected.equals(key) ? app.agent.error : app.agent.startupError("remote:" + key))
                                .put("autostart", record.optBoolean("autostart")).put("migrationRequired", record.optInt("version") != 2));
                        }
                        done(result, new JSONObject().put("remotes", records).put("selected", app.agent.selected).put("localLabel", "This device · Termux")
                            .put("localAutostart", app.agent.localAutostart())
                            .put("capabilities", new JSONObject().put("scan", true).put("browserControl", false)));
                    } catch (Exception error) { failure.accept(error.getMessage()); }
                }, failure); return;
            case "remotes.local-autostart":
                if (args.length() != 1 || !(args.get("enabled") instanceof Boolean)) throw new IllegalArgumentException("Choose whether Local starts automatically");
                app.agent.setLocalAutostart(args.getBoolean("enabled")); done(result, object("ok", true)); return;
            case "remotes.enroll":
                if (enrollment != null) throw new IllegalStateException("Connection import is already open");
                String methodName = args.getString("method");
                if (!methodName.equals("scan") && !methodName.equals("image")) throw new IllegalArgumentException("Choose Scan QR or Upload QR image");
                enrollment = result;
                try { activity.startActivityForResult(new Intent(activity, AgentRemotesActivity.class).putExtra("method", methodName), ENROLLMENT_REQUEST); }
                catch (Exception error) { enrollment = null; throw error; }
                return;
            case "remotes.share-local":
                // The settings owner intercepts this navigation and opens its Share section.
                throw new IllegalArgumentException("Share Local is a native settings navigation");
            case "remotes.connect":
                if (id.equals("local")) { app.agent.select(id); openAgent(); done(result, object("ok", true)); return; }
                break;
            default: break;
        }
        // Resolve against saved native identities, never addresses supplied by the page.
        app.agent.remotes(saved -> {
            if (!live()) return;
            if (id.isEmpty() || id.equals("local") || saved.optJSONObject(id) == null) { failure.accept("Choose a saved remote connection"); return; }
            try {
                JSONObject record = saved.getJSONObject(id);
                String serviceId = args.optString("serviceId");
                switch (method) {
                    case "remotes.autostart":
                        if (args.length() != 2 || !(args.get("enabled") instanceof Boolean)) throw new IllegalArgumentException("Choose whether this remote connects automatically");
                        app.agent.setRemoteAutostart(id, args.getBoolean("enabled"), () -> done(result, object("ok", true)), failure); return;
                    case "remotes.connect": app.agent.select(id); openAgent(); done(result, object("ok", true)); return;
                    case "remotes.disconnect": app.agent.disconnectRemote(id); done(result, object("ok", true)); return;
                    case "remotes.remove": app.agent.removeRemote(id, () -> done(result, object("ok", true)), failure); return;
                    case "remotes.rename": app.agent.renameRemote(id, args.getString("name"), () -> done(result, object("ok", true)), failure); return;
                    case "remotes.services": app.agent.remoteServices(id, services, failure); return;
                    case "remotes.save-mapping": {
                        JSONObject choice = record.getJSONObject("mappings").getJSONObject(serviceId);
                        Object rawPort = args.get("port");
                        if (!(rawPort instanceof Number) || ((Number) rawPort).doubleValue() != ((Number) rawPort).intValue()) throw new IllegalArgumentException("Choose Automatic or a port from 1 to 65535");
                        app.agent.saveRemoteMapping(id, serviceId, args.getBoolean("enabled"), ((Number) rawPort).intValue(), args.getBoolean("importToPi"), choice.optString("apiKey"), services, failure); return;
                    }
                    case "remotes.service-key": promptKey(id, serviceId, result); return;
                    case "remotes.service-action": {
                        String action = args.getString("action");
                        if (!action.equals("start") && !action.equals("stop") && !action.equals("reload")) throw new IllegalArgumentException("Unknown service action");
                        app.agent.remoteServiceAction(id, serviceId, action, services, failure); return;
                    }
                    case "remotes.open-service": app.agent.openRemoteService(id, serviceId, () -> done(result, object("ok", true)), failure); return;
                    case "remotes.copy-service": app.agent.remoteServices(id, value -> {
                        if (!live()) return;
                        try {
                            JSONObject service = findService(value, serviceId);
                            String url = service.getString("url"); if (url.isEmpty()) throw new IllegalStateException("Enable local access first");
                            activity.getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("Service URL", url));
                            done(result, object("ok", true));
                        } catch (Exception error) { failure.accept(error.getMessage()); }
                    }, failure); return;
                    default: throw new SecurityException("Unsupported remote settings operation");
                }
            } catch (Exception error) { failure.accept(error.getMessage()); }
        }, failure);
    }
    private void openAgent() { app.startActivity(app.host.launchIntent().putExtra("bashkitten.openAgent", true)); }
    private static JSONObject findService(JSONObject value, String id) throws Exception {
        JSONArray services = value.getJSONArray("services");
        for (int i = 0; i < services.length(); i++) if (services.getJSONObject(i).getString("id").equals(id)) return services.getJSONObject(i);
        throw new IllegalStateException("Refresh published services first");
    }
    private static JSONObject publicServices(JSONObject value) throws Exception {
        JSONArray services = value.getJSONArray("services"), clean = new JSONArray();
        for (int i = 0; i < services.length(); i++) {
            JSONObject original = services.getJSONObject(i), service = new JSONObject();
            for (String key : new String[]{"id", "name", "kind", "state", "reachable", "error", "actions", "url", "importState", "mappingError"}) if (original.has(key)) service.put(key, original.get(key));
            JSONObject choice = original.optJSONObject("choice");
            if (choice != null) {
                JSONObject fields = new JSONObject();
                for (String key : new String[]{"enabled", "port", "importToPi", "error", "importState"}) if (choice.has(key)) fields.put(key, choice.get(key));
                fields.put("hasKey", !choice.optString("apiKey").isEmpty()); service.put("choice", fields);
            }
            JSONObject mapping = original.optJSONObject("mapping");
            if (mapping != null) {
                JSONObject fields = new JSONObject();
                for (String key : new String[]{"port", "error"}) if (mapping.has(key)) fields.put(key, mapping.get(key));
                service.put("mapping", fields);
            }
            clean.put(service);
        }
        return object("services", clean);
    }
    private void promptKey(String id, String serviceId, CompletableFuture<JSONObject> result) {
        if (keyDialog != null) { failed(result, "A service key prompt is already open"); return; }
        app.agent.remoteServices(id, value -> {
            if (!live()) return;
            try {
                if (!findService(value, serviceId).optString("kind").equals("llama")) throw new IllegalArgumentException("Select an inference service");
                EditText input = new EditText(activity); input.setSingleLine();
                input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
                input.setSaveEnabled(false); input.setFreezesText(false); input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
                keyDialog = new MaterialAlertDialogBuilder(activity, R.style.BashKittenSidecarDialogTheme).setTitle("Service API key")
                    .setMessage("Enter a replacement key. Save an empty value to clear the saved key.").setView(input)
                    .setNegativeButton("Cancel", (dialog, which) -> done(result, object("cancelled", true)))
                    .setPositiveButton("Save", (dialog, which) -> {
                        String key = input.getText().toString(); input.setText("");
                        if (!live()) return;
                        app.agent.remotes(saved -> {
                            if (!live()) return;
                            try {
                                JSONObject choice = saved.getJSONObject(id).getJSONObject("mappings").getJSONObject(serviceId);
                                app.agent.saveRemoteMapping(id, serviceId, choice.optBoolean("enabled"), choice.optInt("port"), choice.optBoolean("importToPi"), key,
                                    current -> { try { done(result, publicServices(current)); } catch (Exception error) { failed(result, error.getMessage()); } }, message -> failed(result, message));
                            } catch (Exception error) { failed(result, error.getMessage()); }
                        }, message -> failed(result, message));
                    }).create();
                keyDialog.setOnCancelListener(dialog -> done(result, object("cancelled", true)));
                keyDialog.setOnDismissListener(dialog -> { input.setText(""); keyDialog = null; }); keyDialog.show();
            } catch (Exception error) { failed(result, error.getMessage()); }
        }, message -> failed(result, message));
    }
    public boolean onActivityResult(int request, int result, Intent data) {
        if (request != ENROLLMENT_REQUEST) return false;
        CompletableFuture<JSONObject> current = enrollment; enrollment = null;
        if (current != null && live()) {
            if (data != null && data.hasExtra("error")) failed(current, data.getStringExtra("error"));
            else { done(current, object("cancelled", result != Activity.RESULT_OK)); if (result == Activity.RESULT_OK) openAgent(); }
        }
        return true;
    }
    @Override public void close() {
        if (closed) return; closed = true; app.agent.detach(listener);
        if (keyDialog != null) { keyDialog.dismiss(); keyDialog = null; }
        if (enrollment != null) { activity.finishActivity(ENROLLMENT_REQUEST); enrollment = null; }
        for (CompletableFuture<JSONObject> result : new ArrayList<>(pending)) failed(result, "Remote settings closed");
        pending.clear();
    }
}
