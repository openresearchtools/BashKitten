// SPDX-License-Identifier: GPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/** Browser-owned local setup/control through the ordinary, user-granted Termux API. */
public final class TermuxConnection {
    public static final String PACKAGE = "com.termux";
    public static final String PERMISSION = "com.termux.permission.RUN_COMMAND";
    public static final String PREFIX = "/data/data/com.termux/files/usr";
    private static final String HOME = "/data/data/com.termux/files/home";
    private static final String EXTRA = "com.termux.RUN_COMMAND_";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final ConcurrentHashMap<String, Request> REQUESTS = new ConcurrentHashMap<>();
    private final Context context;

    public TermuxConnection(Context context) {
        this.context = context.getApplicationContext();
    }

    public boolean installed() {
        try {
            return context.getPackageManager().getApplicationInfo(PACKAGE, 0).enabled;
        } catch (PackageManager.NameNotFoundException error) {
            return false;
        }
    }

    public boolean permissionGranted() {
        return installed() && context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED;
    }

    public void requestPermission(Activity activity, int requestCode) {
        activity.requestPermissions(new String[] { PERMISSION }, requestCode);
    }

    public void openPermissionSettings() {
        context.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + context.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    public void openTermux() {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(PACKAGE);
        if (launch == null) throw new IllegalStateException("Install Termux first.");
        context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    /** The only setup command shown to the user. It carries no executable intent extras. */
    public String setupCommand() {
        PackageManager packages = context.getPackageManager();
        Intent launch = packages.getLaunchIntentForPackage(context.getPackageName());
        if (launch == null || launch.getComponent() == null) {
            throw new IllegalStateException("BashKitten's launch activity is unavailable.");
        }
        ComponentName destination = launch.getComponent();
        try {
            ActivityInfo info = packages.getActivityInfo(destination, 0);
            if (info.targetActivity != null) destination = new ComponentName(context.getPackageName(), info.targetActivity);
        } catch (PackageManager.NameNotFoundException error) {
            throw new IllegalStateException("BashKitten's launch activity is unavailable.", error);
        }
        return "mkdir -p ~/.termux && "
                + "{ if grep -q '^[[:space:]]*allow-external-apps[[:space:]]*=' ~/.termux/termux.properties 2>/dev/null; then "
                + "sed -i 's/^[[:space:]]*allow-external-apps[[:space:]]*=.*/allow-external-apps=true/' ~/.termux/termux.properties; "
                + "else printf '\\nallow-external-apps=true\\n' >> ~/.termux/termux.properties; fi; } && "
                + "termux-reload-settings && am start --user \"$(( $(id -u) / 100000 ))\" -n "
                + shellQuote(destination.flattenToString());
    }

    public void probe(Consumer<JSONObject> done, Consumer<String> fail) {
        String script = "if [ -x '" + PREFIX + "/bin/bashkittenctl' ]; then "
                + "printf '{\"connected\":true,\"packages\":true}'; else "
                + "printf '{\"connected\":true,\"packages\":false}'; fi";
        execute(script, new String[0], null, 20000, done, fail);
    }

    /** Accepts {command, args}; only native browser UI may call this local privileged bridge. */
    public void run(JSONObject request, Consumer<JSONObject> done, Consumer<String> fail) {
        String command = request.optString("command", "");
        if (!command.matches("[a-z][a-z0-9-]{0,63}")) {
            fail.accept("Invalid service command.");
            return;
        }
        JSONObject args = request.optJSONObject("args");
        String input = (args == null ? new JSONObject() : args).toString();
        if (input.getBytes(StandardCharsets.UTF_8).length > 131072) {
            fail.accept("Service request is too large.");
            return;
        }
        // Secrets remain on stdin: no password, factor or connection key enters argv or logs.
        String script = "export BASHKITTEN_NO_AUTOSTART=1; if [ -x '" + PREFIX + "/bin/bashkittenctl' ]; then "
                + "exec '" + PREFIX + "/bin/bashkittenctl' \"$1\" --stdin; else "
                + "printf '{\"error\":\"BashKitten packages are not installed yet.\"}' >&2; exit 1; fi";
        long timeout = command.equals("start") || command.equals("restart") || command.equals("status") ? 120000 : 60000;
        execute(script, new String[] { command }, input, timeout, done, fail);
    }

    /** Start the packaged, pinned bootstrap; its durable log is read with bootstrapStatus(). */
    public void bootstrap(Consumer<JSONObject> done, Consumer<String> fail) {
        try {
            requirePermission();
            String checksum = asset("keyring-sha256.txt").trim();
            if (!checksum.matches("[a-f0-9]{64}")) throw new IllegalStateException("Invalid bundled repository checksum.");
            String script = asset("bootstrap.sh");
            // The task belongs to Termux's foreground service and continues when Agent is hidden.
            context.startForegroundService(commandIntent(script, new String[] { checksum, "external" }, null));
            done.accept(new JSONObject().put("accepted", true));
        } catch (Exception error) {
            fail.accept(message(error, "Unable to start Termux setup."));
        }
    }

    public void bootstrapStatus(Consumer<JSONObject> done, Consumer<String> fail) {
        String script = "dir=\"$HOME/.local/share/bashkitten-pi/bootstrap\"\n"
                + "state=$(cat \"$dir/status.json\" 2>/dev/null || printf '{}')\n"
                + "if [ -f \"$dir/lock\" ] && flock -n \"$dir/lock\" true; then\n"
                + "  case \"$state\" in *'\"status\":\"running\"'*) state='{\"status\":\"interrupted\",\"phase\":\"Setup interrupted. Resume to continue.\"}';; esac\n"
                + "fi\n"
                + "log=$(tail -c 24000 \"$dir/output.log\" 2>/dev/null | base64 | tr -d '\\n')\n"
                + "printf '{\"bootstrap\":%s,\"logBase64\":\"%s\"}\\n' \"$state\" \"$log\"";
        execute(script, new String[0], null, 20000, done, fail);
    }

    private void requirePermission() {
        if (!installed()) throw new IllegalStateException("Install and open Termux to finish its initial setup.");
        if (!permissionGranted()) throw new IllegalStateException("Allow BashKitten to run commands in Termux.");
    }

    private Intent commandIntent(String script, String[] arguments, String stdin) {
        String[] shellArguments = new String[arguments.length + 3];
        shellArguments[0] = "-c";
        shellArguments[1] = script;
        shellArguments[2] = "bashkitten-control";
        System.arraycopy(arguments, 0, shellArguments, 3, arguments.length);
        Intent intent = new Intent("com.termux.RUN_COMMAND")
                .setComponent(new ComponentName(PACKAGE, "com.termux.app.RunCommandService"))
                .putExtra(EXTRA + "PATH", PREFIX + "/bin/bash")
                .putExtra(EXTRA + "ARGUMENTS", shellArguments)
                .putExtra(EXTRA + "BACKGROUND", true)
                .putExtra(EXTRA + "WORKDIR", HOME);
        if (stdin != null) intent.putExtra(EXTRA + "STDIN", stdin);
        return intent;
    }

    private void execute(String script, String[] arguments, String stdin, long timeout,
            Consumer<JSONObject> done, Consumer<String> fail) {
        String id = UUID.randomUUID().toString();
        Request request = new Request(done, fail);
        try {
            requirePermission();
            Intent result = new Intent(context, TermuxResultReceiver.class)
                    .setAction(context.getPackageName() + ".TERMUX_RESULT." + id).putExtra("requestId", id);
            request.pending = PendingIntent.getBroadcast(context, id.hashCode(), result,
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_ONE_SHOT);
            request.timeout = () -> {
                if (REQUESTS.remove(id, request)) {
                    request.pending.cancel();
                    fail.accept("Termux did not return a result. Check its status before retrying.");
                }
            };
            REQUESTS.put(id, request);
            MAIN.postDelayed(request.timeout, timeout);
            context.startForegroundService(commandIntent(script, arguments, stdin)
                    .putExtra(EXTRA + "PENDING_INTENT", request.pending));
        } catch (Exception error) {
            REQUESTS.remove(id, request);
            if (request.timeout != null) MAIN.removeCallbacks(request.timeout);
            if (request.pending != null) request.pending.cancel();
            fail.accept(message(error, "Unable to connect to Termux."));
        }
    }

    static void receive(Intent intent) {
        String id = intent.getStringExtra("requestId");
        if (id == null) return;
        Request request = REQUESTS.remove(id);
        if (request == null) return;
        MAIN.removeCallbacks(request.timeout);
        request.pending.cancel();
        Bundle result = intent.getBundleExtra("result");
        if (result == null) {
            request.fail.accept("Termux returned no command result.");
            return;
        }
        // Termux's transport status uses Activity.RESULT_OK, independently of the process exit code.
        if (result.getInt("err", Integer.MIN_VALUE) != Activity.RESULT_OK || result.getInt("exitCode", -1) != 0) {
            String error = result.getString("errmsg", "");
            if (error.isEmpty()) {
                try { error = new JSONObject(result.getString("stderr", "")).optString("error"); }
                catch (Exception ignored) { /* Do not expose raw shell output from a private account operation. */ }
            }
            if (error.isEmpty()) error = "Termux command failed. Check Termux setup and retry.";
            request.fail.accept(error.substring(0, Math.min(error.length(), 1200)));
            return;
        }
        JSONObject value;
        try {
            String output = result.getString("stdout", "").trim();
            value = output.isEmpty() ? new JSONObject() : new JSONObject(output);
        } catch (Exception error) {
            request.fail.accept("Termux returned an invalid service response.");
            return;
        }
        if (value.has("error")) {
            String error = value.optString("error", "Service command failed.");
            request.fail.accept(error.substring(0, Math.min(error.length(), 1200)));
        } else request.done.accept(value);
    }

    private String asset(String name) throws Exception {
        try (InputStream input = context.getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
                if (output.size() > 262144) throw new IllegalStateException("Bundled setup asset is too large.");
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static String shellQuote(String value) { return "'" + value.replace("'", "'\\''") + "'"; }
    private static String message(Exception error, String fallback) {
        String value = error.getMessage();
        return value == null || value.isEmpty() ? fallback : value.substring(0, Math.min(value.length(), 1200));
    }

    private static final class Request {
        final Consumer<JSONObject> done;
        final Consumer<String> fail;
        PendingIntent pending;
        Runnable timeout;
        Request(Consumer<JSONObject> done, Consumer<String> fail) { this.done = done; this.fail = fail; }
    }
}
