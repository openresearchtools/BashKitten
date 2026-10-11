// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.telecom.TelecomManager;
import android.provider.Settings;
import com.bashkitten.telephony.TelephonyRuntime;
import com.bashkitten.BrowserApp;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Typed settings operations. The native settings host authenticates its exact page and section. */
public final class PhoneSettingsAdapter implements AutoCloseable {
    private static final Map<String, Set<String>> METHODS = Map.of(
        "telephone", Set.of("snapshot", "configure", "setup-account", "readiness", "call", "contact", "divert", "clear-voicemail", "microphone-permission", "open-voice-settings"),
        "notifications", Set.of("turn-notification-settings", "snapshot", "configure", "notification-permission", "android-auto", "android-auto-settings"),
        "phone-use", Set.of("snapshot", "set-master", "set-feature", "accessibility-settings", "notification-settings", "location-permission", "add-location", "set-location", "remove-location"));
    private final Activity activity;
    private final Consumer<JSONObject> events;
    private final PhonePolicy policy;
    private final TelephonyRuntime phone;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final CompletableFuture<JSONObject> phoneReady = new CompletableFuture<>();
    private final Consumer<JSONObject> phoneObserver;
    private final Runnable controlsObserver;
    private volatile JSONObject latest;
    private volatile boolean closed;
    private String section = "";
    private boolean observingPhone, observingControls;
    private Runnable openVoiceSettings;
    private CompletableFuture<JSONObject> picker;

    public PhoneSettingsAdapter(Activity activity, Consumer<JSONObject> events) {
        this.activity = activity; this.events = events;
        policy = PhoneControlsRuntime.get(activity).policy; phone = TelephonyRuntime.get(activity);
        phoneObserver = value -> {
            latest = value; phoneReady.complete(value);
            String target = currentSection();
            if (target.equals("telephone") || target.equals("notifications"))
                work(() -> phoneSnapshot(target, value)).thenAccept(snapshot -> emit(target, "phone-state", snapshot));
        };
        controlsObserver = () -> work(this::controlsSnapshot).thenAccept(value -> emit("phone-use", "phone-controls-state", value));
    }
    public void setOpenVoiceSettings(Runnable action) { openVoiceSettings = action; }
    public void refresh() {
        if (closed) return;
        String target = currentSection();
        if (target.equals("phone-use")) controlsObserver.run();
        else if (latest != null && (target.equals("telephone") || target.equals("notifications")))
            work(() -> phoneSnapshot(target, latest)).thenAccept(value -> emit(target, "phone-state", value));
    }
    private synchronized String currentSection() { return section; }
    private synchronized void observe(String target) {
        section = target;
        boolean calling = !target.equals("phone-use");
        if (calling && !observingPhone) { observingPhone = true; phone.observe(phoneObserver); }
        else if (!calling && observingPhone) { observingPhone = false; phone.unobserve(phoneObserver); }
        if (!calling && !observingControls) { observingControls = true; policy.observe(controlsObserver); }
        else if (calling && observingControls) { observingControls = false; policy.unobserve(controlsObserver); }
    }
    private void emit(String target, String type, JSONObject value) {
        activity.runOnUiThread(() -> {
            if (!closed && !activity.isDestroyed() && target.equals(currentSection())) events.accept(TelephonyRuntime.json("type", type, "data", value));
        });
    }
    public CompletableFuture<JSONObject> dispatch(String target, String method, JSONObject args) {
        try {
            requireOpen();
            if (!METHODS.getOrDefault(target, Set.of()).contains(method)) throw new SecurityException("This setting isn't available here.");
            observe(target);
            if (method.equals("snapshot")) {
                keys(args);
                if (target.equals("phone-use")) return work(this::controlsSnapshot);
                JSONObject saved = latest;
                return (saved == null ? phoneReady : CompletableFuture.completedFuture(saved)).thenApplyAsync(value -> {
                    requireOpen(); return phoneSnapshot(target, value);
                }, io);
            }
            if (target.equals("phone-use")) return controls(method, args);
            switch (method) {
                case "configure": return configure(target, args);
                case "turn-notification-settings":
                    keys(args, "enabled", "onlyWhenHidden", "preview");
                    if (args.length() > 0) {
                        bool(args, "enabled");
                        if (args.has("onlyWhenHidden")) bool(args, "onlyWhenHidden");
                        if (args.has("preview")) bool(args, "preview");
                    }
                    return uiResult(() -> BrowserApp.get(activity).agent.notificationSettings(activity, args));
                case "setup-account":
                    keys(args); return phone.setupAccount().thenCompose(value -> ui(() -> activity.startActivity(new Intent(TelecomManager.ACTION_CHANGE_PHONE_ACCOUNTS))));
                case "readiness": keys(args); return phone.readiness().thenApply(this::connectionSnapshot);
                case "call":
                    keys(args, "backendId"); String callBackend = optionalId(args, "backendId");
                    return ui(() -> {
                        if (activity.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED)
                            activity.requestPermissions(new String[]{Manifest.permission.CALL_PHONE}, 7330);
                        else phone.call(callBackend);
                    });
                case "contact":
                    keys(args, "backendId"); return phone.contact(optionalId(args, "backendId")).thenCompose(intent -> ui(() -> activity.startActivity(intent)));
                case "divert":
                    keys(args, "backendId", "enabled"); String backend = id(args, "backendId"); boolean enabled = bool(args, "enabled");
                    return work(() -> { phone.divert(backend, enabled); return requested(); });
                case "clear-voicemail":
                    keys(args, "backendId"); String mailbox = id(args, "backendId");
                    return work(() -> { phone.clearMailbox(mailbox); return requested(); });
                case "microphone-permission": keys(args); return permission(Manifest.permission.RECORD_AUDIO, 7328);
                case "notification-permission": keys(args); return Build.VERSION.SDK_INT >= 33 ? permission(Manifest.permission.POST_NOTIFICATIONS, 7329) : CompletableFuture.completedFuture(requested());
                case "open-voice-settings":
                    keys(args); return ui(() -> { if (openVoiceSettings == null) throw new IllegalStateException("Voice settings aren't available."); openVoiceSettings.run(); });
                case "android-auto": keys(args); return androidAuto();
                case "android-auto-settings":
                    keys(args); return work(() -> {
                        activity.getPackageManager().getPackageInfo("com.google.android.projection.gearhead", 0); return requested();
                    }).thenCompose(value -> ui(() -> activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:com.google.android.projection.gearhead")))));
                default: throw new SecurityException("Unknown phone setting.");
            }
        } catch (Exception error) { return CompletableFuture.failedFuture(error); }
    }
    private CompletableFuture<JSONObject> configure(String target, JSONObject args) throws JSONException {
        keys(args, "patch"); JSONObject patch = args.getJSONObject("patch");
        if (target.equals("telephone")) keys(patch, "telephony", "startup", "ordinaryDefault", "callDefault", "recent", "finish", "silenceSeconds");
        else keys(patch, "messages", "ordinaryDefault");
        CompletableFuture<JSONObject> ready = CompletableFuture.completedFuture(requested());
        if (patch.optBoolean("telephony")) ready = permission(Manifest.permission.RECORD_AUDIO, 7328);
        if (patch.optBoolean("messages") && Build.VERSION.SDK_INT >= 33) ready = permission(Manifest.permission.POST_NOTIFICATIONS, 7329);
        return ready.thenCompose(ignored -> { requireOpen(); return phone.configure(patch); }).thenApplyAsync(value -> { requireOpen(); return phoneSnapshot(target, value); }, io);
    }
    private CompletableFuture<JSONObject> controls(String method, JSONObject args) throws Exception {
        switch (method) {
            case "set-master":
                keys(args, "enabled"); boolean master = bool(args, "enabled");
                return work(() -> { policy.setMaster(master); return controlsSnapshot(); });
            case "set-feature":
                keys(args, "feature", "enabled"); PhonePolicy.Feature feature = PhonePolicy.Feature.valueOf(id(args, "feature")); boolean enabled = bool(args, "enabled");
                return work(() -> {
                    if (enabled && (!policy.master() || feature.accessibility && !policy.unavailable(feature).isEmpty())) throw new IllegalStateException("This action isn't available yet.");
                    policy.setSelected(feature, enabled); return controlsSnapshot();
                });
            case "accessibility-settings": keys(args); return ui(() -> activity.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
            case "notification-settings": keys(args); return ui(() -> activity.startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
            case "location-permission": keys(args); return ui(() -> activity.requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, 8612));
            case "add-location":
                keys(args); synchronized (this) {
                    if (picker != null && !picker.isDone()) throw new IllegalStateException("Choose or cancel the open folder picker first.");
                    picker = PhoneFilesActivity.pick(activity); return picker;
                }
            case "set-location":
                keys(args, "id", "read", "write", "delete"); String location = id(args, "id");
                boolean read = bool(args, "read"), write = bool(args, "write"), delete = bool(args, "delete");
                return work(() -> {
                    synchronized (policy) {
                        JSONArray locations = new PhoneFiles(activity, policy).locations(); boolean found = false;
                        for (int i = 0; i < locations.length(); i++) {
                            JSONObject value = locations.getJSONObject(i); if (!location.equals(value.optString("id"))) continue;
                            value.put("read", read).put("write", write).put("delete", delete); found = true;
                        }
                        if (!found) throw new IllegalStateException("This folder is no longer allowed.");
                        policy.preferences.edit().putString("locations", locations.toString()).apply(); policy.changed();
                    }
                    return controlsSnapshot();
                });
            case "remove-location":
                keys(args, "id"); String remove = id(args, "id");
                return work(() -> {
                    synchronized (policy) {
                        JSONArray current = new PhoneFiles(activity, policy).locations(), next = new JSONArray(); boolean found = false;
                        for (int i = 0; i < current.length(); i++) {
                            JSONObject value = current.getJSONObject(i);
                            if (!remove.equals(value.optString("id"))) { next.put(value); continue; }
                            found = true;
                            try { activity.getContentResolver().releasePersistableUriPermission(Uri.parse(value.getString("uri")), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
                            catch (SecurityException alreadyRemoved) { /* The local policy still needs removing. */ }
                        }
                        if (!found) throw new IllegalStateException("This folder is no longer allowed.");
                        policy.preferences.edit().putString("locations", next.toString()).apply(); policy.changed();
                    }
                    return controlsSnapshot();
                });
            default: throw new SecurityException("Unknown phone control setting.");
        }
    }
    private JSONObject phoneSnapshot(String target, JSONObject value) {
        JSONObject saved = value.optJSONObject("settings"), filtered = new JSONObject();
        List<String> allowed = target.equals("telephone") ? List.of("telephony", "startup", "ordinaryDefault", "callDefault", "recent", "finish", "silenceSeconds") : List.of("messages", "ordinaryDefault");
        if (saved != null) for (String key : allowed) if (saved.has(key)) put(filtered, key, saved.opt(key));
        JSONObject result = TelephonyRuntime.json("settings", filtered, "connected", value.optBoolean("connected"), "error", value.optString("error"),
            "microphone", activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
            "notifications", Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
        if (target.equals("notifications")) {
            try { put(result, "turnNotifications", BrowserApp.get(activity).agent.notificationSettings(null, new JSONObject())); }
            catch (JSONException invalid) { throw new IllegalStateException("Notification settings aren't available.", invalid); }
        }
        if (target.equals("telephone")) {
            put(result, "supported", Build.VERSION.SDK_INT >= 35 && activity.getSystemService(TelecomManager.class) != null && activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELECOM));
            put(result, "backends", value.optJSONObject("backends")); put(result, "mailbox", value.optJSONObject("mailbox"));
        }
        return connectionSnapshot(result);
    }
    private JSONObject connectionSnapshot(JSONObject result) {
        put(result, "connectionState", phone.connectionState());
        put(result, "localOnRequested", BrowserApp.get(activity).agent.localIsOnRequested());
        return result;
    }
    private JSONObject controlsSnapshot() throws JSONException {
        JSONArray features = new JSONArray();
        for (PhonePolicy.Feature feature : PhonePolicy.Feature.values()) features.put(TelephonyRuntime.json("id", feature.name(), "label", feature.label,
            "selected", policy.selected(feature), "accessibility", feature.accessibility, "available", policy.unavailable(feature).isEmpty()));
        JSONArray locations = new PhoneFiles(activity, policy).locations();
        for (int i = 0; i < locations.length(); i++) locations.getJSONObject(i).remove("uri");
        return TelephonyRuntime.json("enabled", policy.master(), "connected", PhoneControlsRuntime.get(activity).connected(), "features", features, "locations", locations);
    }
    private CompletableFuture<JSONObject> androidAuto() {
        return work(() -> {
            String name = "com.google.android.projection.gearhead"; Intent launch = activity.getPackageManager().getLaunchIntentForPackage(name);
            boolean installed;
            try { activity.getPackageManager().getPackageInfo(name, 0); installed = true; }
            catch (PackageManager.NameNotFoundException missing) { installed = false; }
            JSONObject result = TelephonyRuntime.json("installed", installed, "opened", false);
            if (launch != null) {
                try { ui(() -> activity.startActivity(launch)).get(); put(result, "opened", true); }
                catch (ExecutionException unavailable) { /* Return the supported app-settings route. */ }
            }
            return result;
        });
    }
    private CompletableFuture<JSONObject> permission(String permission, int code) {
        return ui(() -> { if (activity.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) activity.requestPermissions(new String[]{permission}, code); });
    }
    private CompletableFuture<JSONObject> ui(Runnable action) { return uiResult(() -> { action.run(); return requested(); }); }
    private CompletableFuture<JSONObject> uiResult(Callable<JSONObject> action) {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        activity.runOnUiThread(() -> {
            try { requireOpen(); result.complete(action.call()); }
            catch (Exception error) { result.completeExceptionally(error); }
        }); return result;
    }
    private CompletableFuture<JSONObject> work(Callable<JSONObject> action) {
        if (closed) return CompletableFuture.failedFuture(new IllegalStateException("Settings closed."));
        try { return CompletableFuture.supplyAsync(() -> {
            requireOpen(); try { JSONObject value = action.call(); requireOpen(); return value; } catch (Exception error) { throw new CompletionException(error); }
        }, io); } catch (RejectedExecutionException closed) { return CompletableFuture.failedFuture(new IllegalStateException("Settings closed.")); }
    }
    private void requireOpen() { if (closed || activity.isDestroyed() || activity.isFinishing()) throw new IllegalStateException("Settings closed."); }
    private static JSONObject requested() { return TelephonyRuntime.json("requested", true); }
    private static void keys(JSONObject value, String... allowed) {
        Set<String> accepted = Set.of(allowed); Iterator<String> keys = value.keys();
        while (keys.hasNext()) if (!accepted.contains(keys.next())) throw new SecurityException("Unknown setting parameter.");
    }
    private static String id(JSONObject value, String key) throws JSONException {
        Object result = value.get(key); if (!(result instanceof String) || ((String) result).isBlank()) throw new IllegalArgumentException("Missing setting value."); return (String) result;
    }
    private static String optionalId(JSONObject value, String key) throws JSONException { return !value.has(key) || value.isNull(key) ? null : id(value, key); }
    private static boolean bool(JSONObject value, String key) throws JSONException {
        Object result = value.get(key); if (!(result instanceof Boolean)) throw new IllegalArgumentException("Invalid switch value."); return (Boolean) result;
    }
    private static void put(JSONObject value, String key, Object item) {
        try { value.put(key, item == null ? JSONObject.NULL : item); } catch (JSONException invalid) { throw new IllegalArgumentException(invalid); }
    }
    @Override public synchronized void close() {
        if (closed) return; closed = true;
        if (observingPhone) phone.unobserve(phoneObserver);
        if (observingControls) policy.unobserve(controlsObserver);
        if (picker != null) picker.cancel(false);
        phoneReady.completeExceptionally(new IllegalStateException("Settings closed.")); io.shutdown();
    }
}
