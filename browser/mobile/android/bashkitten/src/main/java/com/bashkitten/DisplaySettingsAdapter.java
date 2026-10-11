// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.json.JSONObject;

/** Narrow local controller for the protected Display settings document. */
public final class DisplaySettingsAdapter {
    private static final String PROMPT = "Use the termux-display skill to set up XFCE for this device and save a working launch command, using supported GPU acceleration if available.";
    private static final Set<String> COMMANDS = Set.of("display-status", "display-start", "display-stop", "display-save");
    private final Activity activity;
    private final AgentRuntime runtime;
    private final String installation;
    private final Set<CompletableFuture<JSONObject>> requests = new HashSet<>();
    private JSONObject last;
    private boolean closed;

    public DisplaySettingsAdapter(Activity activity, Consumer<JSONObject> events) {
        this.activity = activity; runtime = BrowserApp.get(activity).agent;
        installation = runtime.termux.installationId();
    }
    private void authorize() {
        if (closed || activity.isDestroyed()) throw new IllegalStateException("Display settings closed");
        if (!installation.equals(runtime.termux.installationId()) || !runtime.localSetupReady())
            throw new SecurityException("Complete Local setup before changing Display settings.");
    }
    public CompletableFuture<JSONObject> dispatch(String method, JSONObject args) {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        activity.runOnUiThread(() -> {
            if (closed) { result.completeExceptionally(new IllegalStateException("Display settings closed")); return; }
            requests.add(result); result.whenComplete((value, error) -> requests.remove(result));
            try {
                if (method.equals("display-setup")) {
                    if (runtime.selected.equals("local")) runtime.turnOn(); else runtime.select("local");
                    BrowserApp app = BrowserApp.get(activity);
                    activity.startActivity(app.host.launchIntent().putExtra("bashkitten.openAgent", true));
                    result.complete(new JSONObject()); app.main.post(activity::finish); return;
                }
                if (method.equals("display-status") &&
                    (!installation.equals(runtime.termux.installationId()) || !runtime.localSetupReady())) {
                    result.complete(new JSONObject().put("needsSetup", true)); return;
                }
                authorize();
                if (method.equals("display-open")) {
                    com.bashkitten.display.DisplayTabs.open(activity, "local"); result.complete(new JSONObject()); return;
                }
                if (method.equals("display-copy")) {
                    String kind = args.optString("kind"), text;
                    if (kind.equals("prompt")) text = PROMPT;
                    else if (kind.equals("command") && last != null) text = last.optString("command");
                    else throw new IllegalArgumentException("No display command is available to copy.");
                    ((ClipboardManager)activity.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Display", text));
                    result.complete(new JSONObject()); return;
                }
                if (!COMMANDS.contains(method)) throw new SecurityException("Unsupported Display operation");
                JSONObject input = new JSONObject();
                if (method.equals("display-save")) {
                    if (args.has("startup")) {
                        if (args.length() != 1 || !(args.get("startup") instanceof Boolean)) throw new IllegalArgumentException("Choose whether Display starts automatically.");
                        input.put("startup", args.getBoolean("startup"));
                    } else input.put("revision", args.getString("revision")).put("command", args.getString("command")).put("reset", args.optBoolean("reset"));
                }
                if (method.equals("display-start")) BrowserApp.get(activity).display.prepareStart();
                runtime.command(method, input, value -> {
                    if (method.equals("display-stop")) BrowserApp.get(activity).display.revoke();
                    try { authorize(); last = value; result.complete(value); }
                    catch (Exception error) { result.completeExceptionally(error); }
                }, error -> result.completeExceptionally(new IllegalStateException(error)));
            } catch (Exception error) { result.completeExceptionally(error); }
        });
        return result;
    }
    public void close() {
        closed = true; last = null;
        for (CompletableFuture<JSONObject> request : new HashSet<>(requests)) request.completeExceptionally(new IllegalStateException("Display settings closed"));
        requests.clear();
    }
}
