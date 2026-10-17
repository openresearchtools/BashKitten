// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import org.json.JSONObject;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/** Browser-owned local setup/control through the ordinary, user-granted Termux API. */
public final class TermuxConnection {
    public static final String PACKAGE = "com.termux";
    public static final String PERMISSION = "com.termux.permission.RUN_COMMAND";
    public static final String SETUP_COMPLETE = "com.bashkitten.TERMUX_SETUP_COMPLETE";
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

    /** PackageManager keeps this value across updates, but changes it on reinstall. */
    public String installationId() {
        try {
            android.content.pm.PackageInfo info = context.getPackageManager().getPackageInfo(PACKAGE, 0);
            return info.applicationInfo.uid + ":" + info.firstInstallTime;
        } catch (PackageManager.NameNotFoundException error) {
            return "";
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

    /** Prefer the device's native 64-bit ABI over an emulated secondary ABI. */
    static String downloadAbi() {
        for (String abi : android.os.Build.SUPPORTED_64_BIT_ABIS) {
            if (abi.equals("arm64-v8a") || abi.equals("x86_64")) return abi;
        }
        throw new IllegalStateException("BashKitten requires ARM64 or x86_64 Android.");
    }

    /** The only setup command shown to the user. It carries no executable intent extras. */
    public String setupCommand() {
        PackageManager packages = context.getPackageManager();
        Intent launch = packages.getLaunchIntentForPackage(context.getPackageName());
        if (launch == null || launch.getComponent() == null) {
            throw new IllegalStateException("BashKitten's launch activity is unavailable.");
        }
        ComponentName destination = launch.getComponent();
        // Repair old bootstrap libraries before invoking curl. Download completely
        // before running the repository script, retaining its real failure status.
        return "(set -eu; export DEBIAN_FRONTEND=noninteractive; "
                + "apt-get -o APT::Update::Error-Mode=any update; "
                + "apt-get full-upgrade -y -o Dpkg::Options::=--force-confold; "
                + "curl -fL --proto '=https' --proto-redir '=https' "
                + "https://termux.bashkitten.com "
                + "-o \"$TMPDIR/bashkitten-install.sh\"; "
                + "bash \"$TMPDIR/bashkitten-install.sh\" " + shellQuote(destination.flattenToShortString()) + ")";
    }

    public void probe(Consumer<JSONObject> done, Consumer<String> fail) {
        String script = "if [ -x '" + PREFIX + "/bin/bashkittenctl' ] "
                + "&& [ \"$(dpkg-query -W -f='${Status}' bashkitten 2>/dev/null)\" = 'install ok installed' ]; then "
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
        String input;
        try {
            // A native settings read must not resurrect a saved Local web owner.
            // The controller consumes this only when it starts; explicit Start
            // remains the existing action, and live owners are never reset.
            input = (args == null ? new JSONObject() : new JSONObject(args.toString())).put("initialWeb", false).toString();
        } catch (org.json.JSONException error) { fail.accept("Invalid service command arguments."); return; }
        // Secrets remain on stdin: no password, factor or connection key enters argv or logs.
        String script = "if [ -x '" + PREFIX + "/bin/bashkittenctl' ]; then "
                + "exec '" + PREFIX + "/bin/bashkittenctl' \"$1\" --stdin \"$2\"; else "
                + "printf '{\"error\":\"BashKitten packages are not installed yet.\"}' >&2; exit 1; fi";
        long timeout = command.equals("start") || command.equals("restart") || command.equals("autostart-startup") || command.startsWith("share-") ? 180000 : command.equals("status") ? 120000 : 60000;
        execute(script, new String[] { command, args != null && args.optBoolean("readOnly") ? "--read-only" : "" }, input, timeout, done, fail);
    }

    /** Runs only the fixed updater shipped by this APK, never caller-provided UI code. */
    void updates(String module, String preparer, JSONObject input, Consumer<JSONObject> done, Consumer<String> fail) {
        try {
            String node = PREFIX + "/lib/bashkitten/node/bin/node";
            // A real private file lets the job owner detach and survive this
            // Activity/process. Hash-addressed APK bytes are never hotpatched.
            String script = "set -eu; umask 077; "
                + "directory=\"${BASHKITTEN_DATA_DIR:-$HOME/.local/share/bashkitten-pi}/updates/apk\"; "
                + "mkdir -p -- \"$directory\"; chmod 700 -- \"$directory\"; "
                + "module=\"$directory/$2.mjs\"; helper=\"$directory/$4.py\"; "
                + "for extension in mjs py; do "
                + "if [ \"$extension\" = mjs ]; then source=$1; digest=$2; file=$module; "
                + "else source=$3; digest=$4; file=$helper; fi; "
                + "if ! printf '%s  %s\\n' \"$digest\" \"$file\" | sha256sum -c - >/dev/null 2>&1; then "
                + "temporary=$(mktemp \"$directory/.update.XXXXXXXX\"); trap 'rm -f -- \"$temporary\"' EXIT; "
                + "printf '%s' \"$source\" >\"$temporary\"; chmod 600 -- \"$temporary\"; "
                + "printf '%s  %s\\n' \"$digest\" \"$temporary\" | sha256sum -c - >/dev/null; "
                + "mv -f -- \"$temporary\" \"$file\"; trap - EXIT; fi; done; "
                + "unset NODE_OPTIONS NODE_PATH; export BASHKITTEN_EXECUTION_ROLE=termux TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE=disable; "
                + "if [ -x " + shellQuote(node) + " ] && [ ! -e \"$directory/../apk-bootstrap/state.json\" ]; then "
                + "export OPENSSL_CONF=" + shellQuote(PREFIX + "/lib/bashkitten/node/etc/openssl.cnf") + "; "
                + "exec /system/bin/sh -c 'exec \"$1\" \"$2\"' bashkitten-updates " + shellQuote(node) + " \"$module\"; fi; "
                + "exec /system/bin/sh -c 'exec \"$1\" \"$2\" \"$3\"' bashkitten-updates "
                + shellQuote(PREFIX + "/bin/python") + " \"$helper\" \"$module\"";
            execute(script, new String[] { module, sha256(module), preparer, sha256(preparer) }, input.toString(), 60000, done, fail);
        } catch (Exception error) { fail.accept(message(error, "Unable to prepare the package updater.")); }
    }

    private static String sha256(String value) throws java.security.NoSuchAlgorithmException {
        byte[] bytes = java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder digest = new StringBuilder();
        for (byte item : bytes) digest.append(String.format(java.util.Locale.ROOT, "%02x", item & 255));
        return digest.toString();
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
            request.fail.accept(error);
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
        // Successful status responses may describe a service's error state.
        // Command failures use the nonzero exit code handled above.
        request.done.accept(value);
    }

    private static String shellQuote(String value) { return "'" + value.replace("'", "'\\''") + "'"; }
    private static String message(Exception error, String fallback) {
        String value = error.getMessage();
        return value == null || value.isEmpty() ? fallback : value;
    }

    private static final class Request {
        final Consumer<JSONObject> done;
        final Consumer<String> fail;
        PendingIntent pending;
        Runnable timeout;
        Request(Consumer<JSONObject> done, Consumer<String> fail) { this.done = done; this.fail = fail; }
    }
}
