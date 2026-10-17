// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.bashkitten.phone.PhoneSettingsAdapter;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;
import org.mozilla.geckoview.*;

/** Browser-owned Gecko settings document, never registered as an ordinary tab. */
public final class AgentSettingsActivity extends ProductActivity {
    private static final String URI = "about:bashkitten-settings";
    private static final Set<String> SECTIONS = new HashSet<>(Arrays.asList("licenses", "localai", "notifications", "phone-use", "remotes", "telephone", "performance", "display", "share-local", "autostart", "updates"));
    private static final Set<String> LOCAL_AI = new HashSet<>(Arrays.asList(("localai-status localai-first-run localai-model-device localai-save localai-model-use localai-synthesize localai-synthesis-cancel localai-quantize localai-ini localai-browse localai-router-models localai-router-model-save localai-router-model-test localai-router-model-test-status localai-router-model-test-cancel localai-check localai-install localai-cancel localai-action native-models-status native-models-catalogue native-models-preset native-models-settings native-models-search native-models-repository native-models-download native-models-action").split(" ")));
    private BrowserApp app;
    private GeckoSession session;
    private GeckoView view;
    private String section;
    private boolean active, closed, configured;
    private PhoneSettingsAdapter phone;
    private RemoteSettingsAdapter remotes;
    private DisplaySettingsAdapter display;
    private ShareSettingsAdapter share;
    private AutostartSettingsAdapter autostart;
    private UpdatesSettingsAdapter updates;
    private ExecutorService counters;
    private PerformanceMonitor monitor;
    private String performanceLease;
    private CompletableFuture<JSONObject> sampling;
    private volatile JSONObject workloadReading = object("cpuPercent", JSONObject.NULL, "pending", true);
    private boolean workloadInFlight;
    private String modelTestOwner;
    private CompletableFuture<JSONObject> recordRead;

    public static void open(Activity activity, String section) {
        BrowserApp.get(activity).agent.settingsOpened();
        if (section.equals("providers") || section.equals("general")) {
            BrowserApp.get(activity).agent.navigation(section.equals("providers") ? "providers" : "settings", new JSONObject(),
                ignored -> {}, error -> android.widget.Toast.makeText(activity, error, android.widget.Toast.LENGTH_LONG).show());
            return;
        }
        if (!SECTIONS.contains(section)) throw new IllegalArgumentException("Unknown settings section");
        activity.startActivity(new Intent(activity, AgentSettingsActivity.class).putExtra("section", section));
    }
    @Override public void onCreate(Bundle saved) {
        app = BrowserApp.get(this);
        // Private browser chrome stays dark. Apply that same activity-local
        // choice before native prompts and Gecko settings obtain their theme.
        if (app.host.privateBrowsing())
            getDelegate().setLocalNightMode(androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_YES);
        super.onCreate(saved);
        section = getIntent().getStringExtra("section");
        if (!SECTIONS.contains(section)) { finish(); return; }
        view = new GeckoView(this);
        // GeckoView's touch origin and its SurfaceView must stay identical.
        // Inset the container, not GeckoView's internal rendering surface.
        FrameLayout content = new FrameLayout(this);
        content.addView(view, new FrameLayout.LayoutParams(-1, -1));
        ViewCompat.setOnApplyWindowInsetsListener(content, (target, insets) -> {
            androidx.core.graphics.Insets area = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            target.setPadding(area.left, area.top, area.right, area.bottom); return insets;
        });
        setContentView(content); ViewCompat.requestApplyInsets(content);
        session = new GeckoSession(new GeckoSessionSettings.Builder().contextId("bashkitten-settings-" + UUID.randomUUID()).usePrivateMode(true).build());
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession source, LoadRequest request) {
                return GeckoResult.fromValue(source == session && URI.equals(request.uri) && request.target == TARGET_WINDOW_CURRENT && !request.isDownload ? AllowOrDeny.ALLOW : AllowOrDeny.DENY);
            }
            @Override public GeckoResult<GeckoSession> onNewSession(GeckoSession source, String uri) { return GeckoResult.fromValue(null); }
        });
        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override public void onCrash(GeckoSession source) { finish(); }
            @Override public void onKill(GeckoSession source) { finish(); }
        });
        session.setPromptDelegate(new GeckoSession.PromptDelegate() {
            @Override public GeckoResult<PromptResponse> onChoicePrompt(GeckoSession source, ChoicePrompt prompt) {
                if (source != session || !active || closed) return GeckoResult.fromValue(prompt.dismiss());
                return AgentChoicePrompt.show(AgentSettingsActivity.this, prompt);
            }
        });
        if (section.equals("telephone") || section.equals("notifications") || section.equals("phone-use")) {
            phone = new PhoneSettingsAdapter(this, this::event);
            phone.setOpenVoiceSettings(() -> open(this, "localai"));
        } else if (section.equals("remotes")) remotes = new RemoteSettingsAdapter(this, this::event);
        else if (section.equals("display")) display = new DisplaySettingsAdapter(this, this::event);
        else if (section.equals("share-local")) share = new ShareSettingsAdapter(this, this::event);
        else if (section.equals("autostart")) autostart = new AutostartSettingsAdapter(this, this::event);
        else if (section.equals("updates")) updates = new UpdatesSettingsAdapter(this, this::event);
        BashKittenSettingsController.setDelegate(session, section, this::call);
        session.open(app.host.runtime()); view.setSession(session);
        JSONObject info = object("section", section, "platform", "android", "backendName", "Local", "local", true, "theme", theme());
        request("settings.configure", object("section", section, "info", info)).thenAccept(ignored -> {
            if (closed) return;
            configured = true; session.setActive(active);
            request("settings.visibility", object("visible", active)); session.loadUri(URI);
        }).exceptionally(error -> { showFailure(error); return null; });
    }
    @Override public void onConfigurationChanged(android.content.res.Configuration next) {
        super.onConfigurationChanged(next); if (configured) event(object("type", "theme", "data", object("theme", theme())));
    }
    private String theme() {
        // This activity's AppCompat configuration already honors Firefox's
        // Light/Dark/System choice. A paused HomeActivity may still have its old resources.
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        return dark ? "dark" : "light";
    }
    private CompletableFuture<JSONObject> request(String method, JSONObject params) {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        if (closed || session == null) { result.completeExceptionally(new IllegalStateException("Settings closed")); return result; }
        BashKittenController.request(session, object("method", method, "params", params).toString()).accept(reply -> {
            try { JSONObject parsed = new JSONObject(reply); if (parsed.has("error")) throw new IllegalStateException(parsed.getString("error")); result.complete(parsed); }
            catch (Exception error) { result.completeExceptionally(error); }
        }, result::completeExceptionally);
        return result;
    }
    private void call(String method, String encoded, java.util.function.Consumer<String> reply) {
        if (!active || closed) { reply.accept(object("error", "Settings view is not active").toString()); return; }
        try {
            JSONObject args = new JSONObject(encoded);
            CompletableFuture<JSONObject> operation;
            if (method.equals("settings-close")) {
                reply.accept(object("result", new JSONObject()).toString()); app.main.post(this::finish); return;
            }
            if (phone != null) operation = phone.dispatch(section, method, args);
            else if (remotes != null && method.equals("remotes.share-local")) { open(this, "share-local"); operation = CompletableFuture.completedFuture(new JSONObject()); }
            else if (remotes != null) operation = remotes.dispatch(method, args);
            else if (display != null) operation = display.dispatch(method, args);
            else if (share != null) operation = share.dispatch(method, args);
            else if (autostart != null) operation = autostart.dispatch(method, args);
            else if (updates != null) operation = updates.dispatch(method, args);
            else if (section.equals("licenses")) {
                if (method.equals("localai-open-record")) operation = openRecord(args);
                else if (method.equals("localai-status") || method.equals("native-models-catalogue")) operation = command(method, args);
                else throw new SecurityException("Unsupported license operation");
            }
            else if (section.equals("localai")) operation = localAI(method, args);
            else if (section.equals("performance") && method.equals("performance-sample")) operation = sample();
            else if (section.equals("performance") && method.equals("performance-close")) { stopCounters(); operation = CompletableFuture.completedFuture(new JSONObject()); }
            else throw new SecurityException("Unsupported settings operation");
            // Complete runtime notices can be large; serialize outside the UI thread.
            operation.whenCompleteAsync((value, error) -> {
                String response = object(error == null ? "result" : "error", error == null ? value : message(error)).toString();
                app.main.post(() -> reply.accept(response));
            });
        } catch (Exception error) { reply.accept(object("error", message(error)).toString()); }
    }
    private CompletableFuture<JSONObject> localAI(String method, JSONObject args) {
        if (method.equals("localai-status") && app.agent.shareNeedsSetup()) return CompletableFuture.completedFuture(object("needsSetup", true));
        if (method.equals("localai-setup")) {
            if (app.agent.selected.equals("local")) app.agent.turnOn(); else app.agent.select("local");
            startActivity(app.host.launchIntent().putExtra("bashkitten.openAgent", true));
            app.main.post(this::finish); return CompletableFuture.completedFuture(new JSONObject());
        }
        if (!method.equals("clipboard-copy") && app.agent.shareNeedsSetup()) throw new IllegalStateException("Complete Local setup before changing LocalAI settings.");
        if (Arrays.asList("localai-router-model-test", "localai-router-model-test-status", "localai-router-model-test-cancel").contains(method)) {
            String owner = args.optString("owner");
            if (!owner.matches("[a-fA-F0-9-]{36}")) throw new IllegalArgumentException("Invalid model check owner");
            if (method.equals("localai-router-model-test")) {
                if (modelTestOwner != null && !modelTestOwner.equals(owner)) throw new IllegalStateException("The previous model check must be closed first");
                modelTestOwner = owner;
                CompletableFuture<JSONObject> start = command(method, args);
                start.whenComplete((value, error) -> app.main.post(() -> {
                    if (error != null || !active || closed || !owner.equals(modelTestOwner)) {
                        command("localai-router-model-test-cancel", object("owner", owner)).whenComplete((cancelled, failure) -> app.main.post(() -> {
                            if (owner.equals(modelTestOwner)) modelTestOwner = null;
                        }));
                    }
                }));
                return start;
            }
            if (!owner.equals(modelTestOwner)) throw new SecurityException("Model check belongs to another settings view");
            CompletableFuture<JSONObject> result = command(method, args);
            result.thenAccept(value -> app.main.post(() -> {
                if (owner.equals(modelTestOwner) && !Arrays.asList("loading", "checking").contains(value.optString("state"))) modelTestOwner = null;
            }));
            return result;
        }
        if (method.equals("clipboard-copy")) {
            ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("BashKitten", args.optString("text")));
            return CompletableFuture.completedFuture(new JSONObject());
        }
        if (!LOCAL_AI.contains(method)) throw new SecurityException("Unsupported LocalAI operation");
        return command(method, args);
    }
    private CompletableFuture<JSONObject> command(String name, JSONObject args) {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        if (section.equals("licenses")) {
            if (!app.agent.localSetupReady()) return CompletableFuture.failedFuture(new IllegalStateException("Downloaded notices are unavailable until this device’s Termux connection is set up."));
            if (!Set.of("localai-status", "localai-record", "native-models-catalogue").contains(name))
                return CompletableFuture.failedFuture(new SecurityException("Unsupported license read"));
            String installation = app.agent.termux.installationId();
            // Read saved files through the existing private bridge, without updates or starting an owner.
            app.agent.termux.run(object("command", name, "args", objectWithReadOnly(args)), value -> {
                if (!app.agent.localSetupReady() || !installation.equals(app.agent.termux.installationId()))
                    result.completeExceptionally(new IllegalStateException("The Termux connection changed."));
                else result.complete(value);
            }, error -> result.completeExceptionally(new IllegalStateException(error)));
            return result;
        }
        app.agent.command(name, args, result::complete, error -> result.completeExceptionally(new IllegalStateException(error)));
        return result;
    }
    private static JSONObject objectWithReadOnly(JSONObject args) {
        try { return new JSONObject(args.toString()).put("readOnly", true); }
        catch (org.json.JSONException error) { throw new IllegalArgumentException(error); }
    }
    private CompletableFuture<JSONObject> openRecord(JSONObject args) {
        cancelRecordRead();
        CompletableFuture<JSONObject> result = new CompletableFuture<>(); recordRead = result;
        // One authorized gesture owns the native reads; decode UTF-8 only once complete.
        readRecord(args.optString("engine"), args.optString("record"), new ByteArrayOutputStream(), null, result);
        return result;
    }
    private void readRecord(String engine, String record, ByteArrayOutputStream content, String revision, CompletableFuture<JSONObject> result) {
        if (result.isDone()) return;
        if (!active || closed || recordRead != result) { result.cancel(false); return; }
        int offset = content.size();
        JSONObject args = object("engine", engine, "record", record, "offset", offset);
        if (revision != null) args = object("engine", engine, "record", record, "offset", offset, "revision", revision);
        command("localai-record", args).whenCompleteAsync((value, error) -> {
            if (result.isDone()) return;
            try {
                if (error != null) throw new java.util.concurrent.CompletionException(error);
                byte[] bytes = Base64.getDecoder().decode(value.getString("data"));
                long total = value.getLong("total"), next = (long)offset + bytes.length;
                String current = value.getString("revision");
                if (value.getLong("offset") != offset || bytes.length > 48 * 1024 || next > total || bytes.length == 0 && next != total ||
                    !current.matches("[a-f0-9]{64}") || revision != null && !revision.equals(current)) throw new IllegalStateException("Invalid runtime record chunk");
                content.write(bytes, 0, bytes.length);
                if (next == total) result.complete(object("name", value.getString("name"), "mimeType", value.getString("mimeType"),
                    "content", content.toString(StandardCharsets.UTF_8), "attribution", value.getJSONObject("attribution")));
                else app.main.post(() -> readRecord(engine, record, content, current, result));
            } catch (Exception failure) { result.completeExceptionally(failure); }
        });
    }
    private void cancelRecordRead() {
        if (recordRead != null) recordRead.cancel(false);
        recordRead = null;
    }
    private CompletableFuture<JSONObject> sample() {
        if (sampling != null && !sampling.isDone()) return sampling;
        if (counters == null) { counters = Executors.newSingleThreadExecutor(); monitor = new PerformanceMonitor(getApplicationContext()); performanceLease = UUID.randomUUID().toString(); }
        final String lease = performanceLease;
        final PerformanceMonitor source = monitor;
        CompletableFuture<PerformanceMonitor.Sample> nativeReading = CompletableFuture.supplyAsync(source::sample, counters);
        if (!workloadInFlight) {
            workloadInFlight = true;
            command("performance-sample", object("session", lease)).whenComplete((value, error) -> app.main.post(() -> {
                if (!lease.equals(performanceLease)) { command("performance-close", object("session", lease)); return; }
                workloadInFlight = false;
                workloadReading = error == null ? value : object("cpuPercent", JSONObject.NULL, "pending", false, "reason", message(error));
            }));
        }
        // Device counters retain their cadence even if Termux is still starting.
        sampling = nativeReading.thenApply(reading -> object("workload", workloadReading,
            "cpuPercent", reading.totalCpu, "cpuPending", reading.totalCpuPending,
            "ram", object("used", reading.used, "total", reading.total),
            "gpus", reading.gpu == null ? new JSONArray() : new JSONArray().put(object("name", "GPU", "percent", reading.gpu))));
        return sampling;
    }
    private void cancelModelCheck() {
        String owner = modelTestOwner; modelTestOwner = null;
        if (owner != null) command("localai-router-model-test-cancel", object("owner", owner));
    }
    private void stopCounters() {
        String previous = performanceLease; performanceLease = null;
        if (counters != null) counters.shutdownNow(); counters = null; monitor = null; sampling = null; workloadInFlight = false;
        workloadReading = object("cpuPercent", JSONObject.NULL, "pending", true);
        if (previous != null) command("performance-close", object("session", previous));
    }
    private void event(JSONObject value) { app.main.post(() -> { if (active && configured && !closed) request("settings.event", value); }); }
    @Override protected void onResume() {
        super.onResume(); active = true;
        if (session != null) session.setActive(true);
        if (configured) { request("settings.visibility", object("visible", true)); event(object("type", "theme", "data", object("theme", theme()))); }
        if (phone != null) phone.refresh();
    }
    @Override protected void onPause() {
        active = false; stopCounters(); cancelModelCheck(); cancelRecordRead();
        if (configured) request("settings.visibility", object("visible", false));
        if (session != null) session.setActive(false);
        super.onPause();
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(requestCode, permissions, grants); if (phone != null) phone.refresh();
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (remotes != null) remotes.onActivityResult(requestCode, resultCode, data);
        if (share != null) share.onActivityResult(requestCode, resultCode, data);
    }
    @Override protected void onDestroy() {
        stopCounters(); cancelModelCheck(); cancelRecordRead(); closed = true;
        if (phone != null) phone.close(); if (remotes != null) remotes.close(); if (display != null) display.close(); if (share != null) share.close();
        if (autostart != null) autostart.close();
        if (updates != null) updates.close();
        if (session != null) { BashKittenSettingsController.setDelegate(session, section, null); view.releaseSession(); session.close(); session = null; }
        super.onDestroy();
    }
    private void showFailure(Throwable error) { app.main.post(() -> { if (closed) return; TextView text = new TextView(this); text.setText(message(error)); setContentView(text); }); }
    static JSONObject object(Object... pairs) { JSONObject result = new JSONObject(); try { for (int i=0;i<pairs.length;i+=2) result.put((String)pairs[i], pairs[i+1] == null ? JSONObject.NULL : pairs[i+1]); } catch (org.json.JSONException error) { throw new IllegalArgumentException(error); } return result; }
    private static String message(Throwable error) { while (error.getCause() != null) error = error.getCause(); return error.getMessage() == null ? "Settings action failed" : error.getMessage(); }
}
