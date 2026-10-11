// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import com.bashkitten.telephony.TelephonyRuntime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;

/** Saved startup choices, resolved by their existing native/local owners. */
public final class AutostartSettingsAdapter implements AutoCloseable {
    private final Activity activity;
    private final BrowserApp app;
    private final AgentRuntime runtime;
    private final String installation;
    private final Set<CompletableFuture<JSONObject>> pending = new HashSet<>();
    private boolean closed;

    public AutostartSettingsAdapter(Activity activity, Consumer<JSONObject> events) {
        this.activity = activity; app = BrowserApp.get(activity); runtime = app.agent;
        installation = runtime.termux.installationId();
    }
    private void live() {
        if (closed || activity.isFinishing() || activity.isDestroyed()) throw new IllegalStateException("Autostart settings closed");
    }
    private void authorizeLocal() {
        live();
        if (!runtime.localSetupReady() || !installation.equals(runtime.termux.installationId()))
            throw new SecurityException("Complete Local setup before changing Termux startup settings.");
    }
    private static JSONObject object(Object... pairs) { return AgentSettingsActivity.object(pairs); }
    private static String message(Throwable error) {
        while (error.getCause() != null) error = error.getCause();
        return error.getMessage() == null ? "Startup settings are unavailable" : error.getMessage();
    }
    public CompletableFuture<JSONObject> dispatch(String method, JSONObject args) {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        app.main.post(() -> {
            try {
                live(); pending.add(result);
                result.whenComplete((value, error) -> app.main.post(() -> pending.remove(result)));
                CompletableFuture<JSONObject> work;
                switch (method) {
                    case "autostart.get": work = snapshot(); break;
                    case "autostart.set":
                        if (args.length() != 2 || !(args.get("enabled") instanceof Boolean)) throw new IllegalArgumentException("Choose whether this item starts automatically");
                        work = save(args.getString("id"), args.getBoolean("enabled")); break;
                    case "autostart.commands.save":
                        if (args.length() != 3 || !args.getString("environmentId").equals("local")) throw new SecurityException("Choose the local Termux environment");
                        work = command("autostart-save", object("revision", args.getString("revision"), "commands", args.getJSONArray("commands"))); break;
                    default: throw new SecurityException("Unsupported Autostart operation");
                }
                work.whenComplete((value, error) -> app.main.post(() -> {
                    try { live(); if (error != null) throw new IllegalStateException(message(error)); result.complete(value); }
                    catch (Exception failure) { result.completeExceptionally(failure); }
                }));
            } catch (Exception error) { result.completeExceptionally(error); }
        });
        return result;
    }
    private CompletableFuture<JSONObject> command(String name, JSONObject args) {
        authorizeLocal();
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        runtime.command(name, args, value -> {
            try { authorizeLocal(); result.complete(value); }
            catch (Exception error) { result.completeExceptionally(error); }
        }, error -> result.completeExceptionally(new IllegalStateException(error)));
        return result;
    }
    private CompletableFuture<JSONObject> remotes() {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        runtime.remotes(result::complete, error -> result.completeExceptionally(new IllegalStateException(error))); return result;
    }
    private CompletableFuture<JSONObject> readable(String name) {
        if (!runtime.localSetupReady() || !installation.equals(runtime.termux.installationId()))
            return CompletableFuture.completedFuture(object("unavailable", "Complete Local setup to use Termux startup settings."));
        return command(name, new JSONObject()).exceptionally(error -> object("unavailable", message(error)));
    }
    private JSONObject entry(String id, String label, String group, Object enabled, boolean available, String detail) {
        return object("id", id, "label", label, "group", group, "enabled", enabled, "available", available,
            "detail", details(detail, runtime.startupError(id)));
    }
    private static String details(String... values) {
        java.util.LinkedHashSet<String> parts = new java.util.LinkedHashSet<>();
        for (String value : values) if (value != null && !value.isBlank()) parts.add(value);
        return String.join(" · ", parts);
    }
    private static String error(JSONObject value) {
        return value == null || value.isNull("error") ? "" : value.optString("error");
    }
    private CompletableFuture<JSONObject> snapshot() {
        CompletableFuture<JSONObject> saved = remotes().exceptionally(error -> object("unavailable", message(error)));
        CompletableFuture<JSONObject> phone = TelephonyRuntime.get(app).startupSnapshot().exceptionally(error -> object("unavailable", message(error)));
        CompletableFuture<JSONObject> display = readable("display-status"), ai = readable("localai-status"),
            share = readable("share-status"), services = readable("service-status"), commands = readable("autostart-status");
        return CompletableFuture.allOf(saved, phone, display, ai, share, services, commands).thenApplyAsync(ignored -> {
            live();
            JSONArray entries = new JSONArray();
            entries.put(entry("local", "Local Agent", "Connections", runtime.localAutostart(), true, "Start the local Agent when BashKitten opens."));
            JSONObject records = saved.join();
            if (records.has("unavailable")) entries.put(entry("remotes", "Saved remote connections", "Connections", null, false, records.optString("unavailable")));
            for (Iterator<String> keys = records.keys(); keys.hasNext();) {
                String id = keys.next(); JSONObject record = records.optJSONObject(id); if (record == null) continue;
                boolean supported = record.optInt("version") == 2 && record.optString("kind").equals("agent");
                entries.put(entry("remote:" + id, record.optString("name", id), "Connections", record.optBoolean("autostart"), supported,
                    supported ? "Reconnect through this saved connection. Sign-in may still be required." : "Import a new encrypted connection QR first."));
            }
            JSONObject p = phone.join();
            entries.put(entry("telephone", "Telephone", "Phone", p.has("unavailable") ? null : p.optBoolean("enabled"), p.optBoolean("available"), p.optString("unavailable", p.optString("detail"))));
            JSONObject custom = commands.join(), failures = custom.optJSONObject("startupErrors");
            if (failures == null) failures = new JSONObject();
            JSONObject d = display.join();
            entries.put(entry("display", "Display", "Termux services", d.has("unavailable") ? null : d.optBoolean("startup"), !d.has("unavailable"),
                details(d.optString("unavailable", "Start the desktop in the background, without opening a Display tab."), error(d), failures.optString("display"))));
            JSONObject engines = ai.join();
            for (String engine : new String[]{"llama", "whisper", "tts"}) {
                JSONObject value = engines.optJSONObject(engine), config = value == null ? null : value.optJSONObject("config"), capability = value == null ? null : value.optJSONObject("startupCapability");
                boolean available = config != null && !engine.equals("tts") && (capability == null || capability.optBoolean("available", true));
                entries.put(entry("engine:" + engine, engine.equals("llama") ? "llama.cpp router" : engine.equals("tts") ? "Text to speech" : "Whisper / Parakeet", "LocalAI",
                    config == null || engine.equals("tts") ? null : config.optBoolean("startup"), available,
                    details(engines.has("unavailable") ? engines.optString("unavailable") : capability == null ? "" : capability.optString("detail"),
                        error(value), error(value == null ? null : value.optJSONObject("service")), failures.optString(engine))));
            }
            JSONObject publishing = share.join();
            entries.put(entry("publishing", "Remote publishing", "Termux services", publishing.has("unavailable") ? null : publishing.optBoolean("startup"), publishing.optString("phase").equals("ready"),
                details(publishing.optString("unavailable", "Starts with Local when Share Local is enabled and configured."), error(publishing))));
            JSONObject catalogue = services.join(); JSONArray list = catalogue.optJSONArray("services");
            if (list != null) for (int i = 0; i < list.length(); i++) {
                JSONObject service = list.optJSONObject(i); if (service == null || service.optString("id").startsWith("localai-")) continue;
                boolean runnable = service.optJSONObject("command") != null;
                entries.put(entry("service:" + service.optString("id"), service.optString("name"), "Hosted services", runnable ? service.optBoolean("startup") : null, runnable,
                    runnable ? details(error(service), failures.optString(service.optString("id"))) : "This external service has no owned launch command."));
            }
            if (catalogue.has("unavailable")) entries.put(entry("services", "Hosted services", "Hosted services", null, false, catalogue.optString("unavailable")));
            JSONObject environment = object("id", "local", "name", "This device · Termux", "available", !custom.has("unavailable"),
                "detail", custom.optString("unavailable", startupDetail(custom)), "file", custom.optString("file"), "revision", custom.optString("revision"),
                "commands", custom.optJSONArray("commands") == null ? new JSONArray() : custom.optJSONArray("commands"),
                "status", custom.optJSONArray("status") == null ? new JSONArray() : custom.optJSONArray("status"));
            return object("entries", entries, "environments", new JSONArray().put(environment));
        }, app.main::post);
    }
    private String startupDetail(JSONObject custom) {
        ArrayList<String> errors = new ArrayList<>();
        String nativeError = runtime.startupError("local-services"); if (!nativeError.isEmpty()) errors.add(nativeError);
        if (!error(custom).isEmpty()) errors.add(error(custom));
        JSONObject failures = custom.optJSONObject("startupErrors");
        if (failures != null) for (Iterator<String> keys = failures.keys(); keys.hasNext();) {
            String key = keys.next(), value = failures.optString(key); if (!value.isEmpty()) errors.add(key + ": " + value);
        }
        return String.join(" · ", errors);
    }
    private CompletableFuture<JSONObject> save(String id, boolean enabled) {
        if (id.equals("local")) { runtime.setLocalAutostart(enabled); return CompletableFuture.completedFuture(new JSONObject()); }
        if (id.startsWith("remote:")) {
            CompletableFuture<JSONObject> result = new CompletableFuture<>();
            runtime.setRemoteAutostart(id.substring(7), enabled, () -> result.complete(new JSONObject()), error -> result.completeExceptionally(new IllegalStateException(error))); return result;
        }
        if (id.equals("telephone")) return TelephonyRuntime.get(app).setStartup(enabled);
        if (id.equals("display")) return command("display-save", object("startup", enabled));
        if (id.equals("publishing")) return command("share-startup", object("enabled", enabled));
        if (id.equals("engine:llama") || id.equals("engine:whisper")) {
            String engine = id.substring(7);
            return command("localai-status", new JSONObject()).thenCompose(value -> {
                try {
                    authorizeLocal(); JSONObject selected = value.getJSONObject(engine), capability = selected.optJSONObject("startupCapability");
                    if (capability != null && !capability.optBoolean("available", true)) throw new IllegalStateException(capability.optString("detail"));
                    JSONObject config = new JSONObject(selected.getJSONObject("config").toString()).put("startup", enabled);
                    return command("localai-save", object("engine", engine, "revision", value.getString("revision"), "config", config));
                } catch (Exception error) { return CompletableFuture.failedFuture(error); }
            });
        }
        if (id.startsWith("service:") && !id.substring(8).startsWith("localai-")) return command("service-status", new JSONObject()).thenCompose(value -> {
            try {
                authorizeLocal(); JSONArray services = value.getJSONArray("services");
                for (int i = 0; i < services.length(); i++) {
                    JSONObject original = services.getJSONObject(i); if (!original.getString("id").equals(id.substring(8))) continue;
                    if (original.optJSONObject("command") == null) throw new IllegalArgumentException("This service has no launch command");
                    JSONObject service = new JSONObject();
                    for (String key : new String[]{"id", "name", "target", "scheme", "openPath", "kind", "enabled", "command"}) if (original.has(key)) service.put(key, original.get(key));
                    service.put("startup", enabled);
                    return command("service-save", object("revision", value.getString("revision"), "service", service));
                }
                throw new IllegalArgumentException("The hosted service no longer exists");
            } catch (Exception error) { return CompletableFuture.failedFuture(error); }
        });
        throw new SecurityException("Unknown startup choice");
    }
    @Override public void close() {
        closed = true;
        for (CompletableFuture<JSONObject> result : new ArrayList<>(pending)) result.completeExceptionally(new IllegalStateException("Autostart settings closed"));
        pending.clear();
    }
}
