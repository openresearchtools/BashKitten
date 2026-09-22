// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;
import java.util.zip.ZipFile;
import org.json.JSONObject;

/** Executed directly from the installed browser APK with Android's app_process. */
public final class BrowserCommand {
    public static void main(String[] arguments) {
        try { System.exit(run(arguments)); }
        catch (Exception error) {
            System.err.println("BashKitten: " + (error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()));
            System.exit(1);
        }
    }
    private static int run(String[] arguments) throws Exception {
        ArrayList<String> args = new ArrayList<>(Arrays.asList(arguments));
        if (args.equals(Collections.singletonList("--help"))) {
            System.out.println("BashKitten Android browser commands (included in the APK)\n"
                + "  METHOD [PARAMS_JSON]          Run a browser tool\n"
                + "  --json REQUEST_JSON          Run a complete JSON request\n"
                + "  (no arguments)               Read one JSON request from stdin\n"
                + "  --output FILE                Save a screenshot/download privately\n"
                + "  --authorize                  Request app access without running a tool\n"
                + "  --licenses                   Print this APK's license notices\n"
                + "  --no-launch                  Return approval/launch tickets to the caller\n"
                + "The first ordinary command opens native app approval when needed.\n"
                + "Use explicit tabId values returned by tabs.list or tabs.create.\n"
                + "Agent, setup and login views are never accessible to browser tools.");
            return 0;
        }
        if (args.equals(Collections.singletonList("--licenses"))) { licenses(); return 0; }
        if (args.contains("--legacy-key") || args.contains("--state-dir") || args.contains("--session"))
            throw new IllegalArgumentException("Use native app approval and explicit tabId values; command keys and browser sessions are not supported");
        return nativeRun(args);
    }
    private static byte[] readAtMost(InputStream stream, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
        while (out.size() < limit && (count = stream.read(buffer, 0, Math.min(buffer.length, limit - out.size()))) != -1) out.write(buffer, 0, count);
        return out.toByteArray();
    }
    private static int nativeRun(ArrayList<String> args) throws Exception {
        boolean noLaunch = args.remove("--no-launch");
        String output = option(args, "--output");
        if (args.equals(Collections.singletonList("--version"))) {
            System.out.println("BashKitten Android app-identity command protocol 2"); return 0;
        }
        boolean authorize = args.equals(Collections.singletonList("--authorize"));
        JSONObject command;
        if (authorize) command = new JSONObject().put("method", "app.authorize");
        else if (args.isEmpty()) {
            byte[] bytes = readAtMost(System.in, 800001);
            if (bytes.length > 800000) throw new IOException("Request too large");
            command = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } else if (args.size() == 2 && args.get(0).equals("--json")) command = new JSONObject(args.get(1));
        else if (args.size() == 1 || args.size() == 2) command = new JSONObject().put("method", args.get(0))
            .put("params", args.size() == 2 ? new JSONObject(args.get(1)) : new JSONObject());
        else throw new IllegalArgumentException("Use --help for command syntax");
        if (output != null) {
            if (!Arrays.asList("screenshot", "downloads.get").contains(command.optString("method")))
                throw new IllegalArgumentException("--output is for screenshot or downloads.get");
            JSONObject params = command.optJSONObject("params"); if (params == null) params = new JSONObject();
            command.put("params", params.put("transfer", true));
        }
        int browserUid = browserUid();
        JSONObject initial = authorize ? command : new JSONObject().put("method", "app.prepare");
        JSONObject response;
        try { response = nativeRequest(browserUid, initial); }
        catch (IOException error) {
            if (noLaunch) throw error;
            launch(null, null);
            long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(20);
            do {
                Thread.sleep(250);
                try { response = nativeRequest(browserUid, initial); break; }
                catch (IOException retry) { if (System.nanoTime() >= deadline) throw retry; }
            } while (true);
        }
        JSONObject result = response.optJSONObject("result");
        if (result != null && result.has("appGrant")) {
            if (noLaunch) { System.out.println(response); return 2; }
            String ticket = result.getString("appGrant");
            try { launchNative("appGrant", ticket); }
            catch (Exception error) {
                System.err.println("Open BashKitten to approve this app's pending browser-control request.");
            }
            long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.MINUTES.toNanos(3);
            do {
                Thread.sleep(500);
                JSONObject check = nativeRequest(browserUid, new JSONObject().put("method", "app.authorization").put("ticket", ticket));
                if (check.has("error")) { System.out.println(check); return 1; }
                String status = check.getJSONObject("result").getString("status");
                if (status.equals("approved")) { response = nativeRequest(browserUid, initial); break; }
                if (!status.equals("pending")) {
                    System.out.println(new JSONObject().put("error", "Browser access " + status).put("code", "authorization_" + status));
                    return 1;
                }
                if (System.nanoTime() >= deadline) throw new IOException("Browser approval is still pending; open BashKitten to review it");
            } while (true);
        }
        if (!authorize && !response.has("error")) {
            if (response.getJSONObject("result").getBoolean("foregroundRequired")) {
                if (noLaunch) throw new IOException("Open BashKitten once to activate background browser control");
                launch(null, null);
                long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(20);
                do {
                    Thread.sleep(250); response = nativeRequest(browserUid, initial);
                    if (response.has("error") || !response.getJSONObject("result").getBoolean("foregroundRequired")) break;
                    if (System.nanoTime() >= deadline) throw new IOException("Android did not allow browser background work; open BashKitten and retry");
                } while (true);
            }
            // Never retry a submitted tool: a lost reply does not mean it did not execute.
            if (!response.has("error")) response = nativeRequest(browserUid, command);
        }
        result = response.optJSONObject("result");
        if (!authorize && result != null && result.has("appGrant")) {
            System.out.println(new JSONObject().put("error", "Browser permission changed before the command; review Agent access and retry")
                .put("code", "authorization_revoked"));
            return 1;
        }
        if (result != null && result.has("launch") && !noLaunch) {
            launchNative("launch", result.getString("launch")); response = new JSONObject().put("result", true);
        }
        if (output != null && !response.has("error")) {
            if (result == null || !result.has("transfer")) throw new IOException("No file transfer returned");
            Path destination = Paths.get(output).toAbsolutePath();
            copyTransfer(result.getJSONObject("transfer"), destination);
            result.remove("transfer"); result.put("path", destination.toString());
        }
        System.out.println(response);
        return response.has("error") ? 1 : 0;
    }
    private static String option(ArrayList<String> args, String name) {
        int index = args.indexOf(name);
        if (index < 0) return null;
        if (index + 1 >= args.size()) throw new IllegalArgumentException(name + " needs a value");
        String value = args.remove(index + 1); args.remove(index); return value;
    }
    private static int browserUid() throws Exception {
        Process process = new ProcessBuilder("/system/bin/cmd", "package", "list", "packages", "-U", "--user",
            Integer.toString(android.os.Process.myUid() / 100000), CommandProtocol.PACKAGE).redirectErrorStream(true).start();
        String text = new String(readAtMost(process.getInputStream(), 16384), StandardCharsets.UTF_8);
        if (process.waitFor() != 0) throw new IOException("Cannot resolve the installed browser identity");
        java.util.regex.Matcher match = java.util.regex.Pattern.compile("(?m)^package:" + java.util.regex.Pattern.quote(CommandProtocol.PACKAGE) + " uid:(\\d+)\\s*$").matcher(text);
        if (!match.find()) throw new IOException("Install BashKitten first");
        return Integer.parseInt(match.group(1));
    }
    private static android.os.IBinder appEndpoint;
    private static android.app.PendingIntent pendingLaunch;
    private static void launchNative(String field, String value) throws Exception {
        android.app.PendingIntent launch = pendingLaunch; pendingLaunch = null;
        if (launch == null) { launch(field, value); return; }
        android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
        if (android.os.Build.VERSION.SDK_INT >= 34) options.setPendingIntentBackgroundActivityStartMode(
            android.os.Build.VERSION.SDK_INT >= 36 ? android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE
                : android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
        launch.send(null, 0, null, null, null, null, options.toBundle());
    }
    private static android.content.Context commandContext;
    private static android.content.Context commandContext() throws Exception {
        if (commandContext != null) return commandContext;
        // app_process has no Application. Use Android's runtime context to send the
        // discovery broadcast; authorization still uses Binder.getCallingUid().
        android.os.Looper.prepareMainLooper();
        Class<?> activityThread = Class.forName("android.app.ActivityThread");
        Object thread = activityThread.getMethod("systemMain").invoke(null);
        android.content.Context system = (android.content.Context) activityThread.getMethod("getSystemContext").invoke(thread);
        String[] packages = system.getPackageManager().getPackagesForUid(android.os.Process.myUid());
        if (packages == null || packages.length == 0) throw new SecurityException("Run this command from an Android app such as Termux");
        commandContext = system.createPackageContext(packages[0], android.content.Context.CONTEXT_IGNORE_SECURITY);
        return commandContext;
    }
    private static JSONObject nativeRequest(int browserUid, JSONObject request) throws Exception {
        if (request.toString().length() > 200000) throw new IOException("Request too large");
        if (appEndpoint == null || !appEndpoint.isBinderAlive()) {
            java.util.concurrent.CompletableFuture<android.os.IBinder> connected = new java.util.concurrent.CompletableFuture<>();
            android.os.Binder callback = new android.os.Binder() {
                @Override protected boolean onTransact(int code, android.os.Parcel data, android.os.Parcel reply, int flags) {
                    if (code != AppCommandGateway.CONNECT) return false;
                    data.enforceInterface(AppCommandGateway.CALLBACK);
                    if (android.os.Binder.getCallingUid() != browserUid) throw new SecurityException("Connection is not from the installed BashKitten app");
                    connected.complete(data.readStrongBinder()); return true;
                }
            };
            android.content.Intent intent = new android.content.Intent()
                .setClassName(CommandProtocol.PACKAGE, "com.bashkitten.AppCommandReceiver")
                .setData(android.net.Uri.parse("bashkitten-command:" + UUID.randomUUID()))
                .addFlags(android.content.Intent.FLAG_INCLUDE_STOPPED_PACKAGES);
            android.os.Bundle extras = new android.os.Bundle(); extras.putBinder("callback", callback); intent.putExtras(extras);
            android.app.PendingIntent discovery = android.app.PendingIntent.getBroadcast(commandContext(), 0, intent,
                android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_ONE_SHOT);
            try {
                discovery.send(); appEndpoint = connected.get(10, java.util.concurrent.TimeUnit.SECONDS);
            } catch (java.util.concurrent.TimeoutException error) { throw new IOException("Open BashKitten to connect", error); }
            finally { discovery.cancel(); }
        }
        java.util.concurrent.CompletableFuture<String> result = new java.util.concurrent.CompletableFuture<>();
        android.os.Binder callback = new android.os.Binder() {
            @Override protected boolean onTransact(int code, android.os.Parcel data, android.os.Parcel reply, int flags) {
                if (code != AppCommandGateway.RESULT) return false;
                data.enforceInterface(AppCommandGateway.CALLBACK);
                if (android.os.Binder.getCallingUid() != browserUid) throw new SecurityException("Response is not from BashKitten");
                String response = data.readString();
                pendingLaunch = data.readTypedObject(android.app.PendingIntent.CREATOR);
                result.complete(response); return true;
            }
        };
        android.os.Parcel data = android.os.Parcel.obtain();
        try {
            data.writeInterfaceToken(AppCommandGateway.DESCRIPTOR); data.writeString(request.toString()); data.writeStrongBinder(callback);
            appEndpoint.transact(AppCommandGateway.CONNECT, data, null, android.os.IBinder.FLAG_ONEWAY);
        } catch (android.os.RemoteException error) { appEndpoint = null; throw new IOException("Browser connection closed", error); }
        finally { data.recycle(); }
        try {
            long timeout = request.optString("method").equals("app.prepare") ? 7 : 215;
            return new JSONObject(result.get(timeout, java.util.concurrent.TimeUnit.SECONDS));
        } catch (java.util.concurrent.TimeoutException error) {
            throw new IOException("Browser did not respond; open your terminal or BashKitten and retry", error);
        }
    }
    private static void copyTransfer(JSONObject transfer, Path destination) throws Exception {
        URL url = new URL(transfer.getString("url"));
        if (!url.getProtocol().equals("http") || !url.getHost().equals("127.0.0.1") || url.getUserInfo() != null)
            throw new SecurityException("Invalid browser transfer endpoint");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(5000); connection.setReadTimeout(30000);
        connection.setRequestProperty("Authorization", "Bearer " + transfer.getString("token"));
        boolean created = false, complete = false;
        try {
            if (connection.getResponseCode() != 200) throw new IOException("File transfer was rejected; request a fresh transfer");
            Files.createFile(destination, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"))); created = true;
            try (InputStream in = connection.getInputStream(); OutputStream out = Files.newOutputStream(destination)) {
                byte[] buffer = new byte[65536]; int count; long total = 0;
                while ((count = in.read(buffer)) != -1) { out.write(buffer, 0, count); total += count; }
                if (connection.getContentLengthLong() >= 0 && total != connection.getContentLengthLong()) throw new IOException("Incomplete file transfer");
            }
            complete = true;
        } finally { connection.disconnect(); if (created && !complete) Files.deleteIfExists(destination); }
    }
    private static void launch(String extra, String value) throws Exception {
        ArrayList<String> command = new ArrayList<>(Arrays.asList("am", "start", "-n"));
        command.add(extra == null ? CommandProtocol.PACKAGE + "/org.mozilla.fenix.HomeActivity" : CommandProtocol.ACTIVITY);
        if (extra != null) { command.add("--es"); command.add(extra); command.add(value); }
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[1024]; int count;
        while ((count = process.getInputStream().read(buffer)) != -1) if (bytes.size() < 16384) bytes.write(buffer, 0, count);
        if (process.waitFor() != 0 || bytes.toString("UTF-8").contains("Error:"))
            throw new IOException("Android could not open BashKitten. Run from a visible terminal with Termux's am command, or open the browser yourself.");
    }
    private static void licenses() throws Exception {
        for (String path : System.getProperty("java.class.path", "").split(File.pathSeparator)) {
            if (!path.endsWith(".apk")) continue;
            try (ZipFile apk = new ZipFile(path)) {
                java.util.zip.ZipEntry entry = apk.getEntry("assets/THIRD-PARTY-NOTICES.txt");
                if (entry == null) continue;
                try (InputStream input = apk.getInputStream(entry)) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) System.out.write(buffer, 0, count);
                }
                byte[] metadata = apkBytes(apk, "assets/raw/third_party_license_metadata");
                byte[] texts = apkBytes(apk, "assets/raw/third_party_licenses");
                System.out.println("\n\nAndroid dependencies from this APK\n");
                for (String line : new String(metadata, StandardCharsets.UTF_8).trim().split("\n")) {
                    int separator = line.indexOf(' ');
                    String[] range = line.substring(0, separator).split(":");
                    int offset = Integer.parseInt(range[0]), length = Integer.parseInt(range[1]);
                    if (offset < 0 || length < 0 || offset > texts.length - length) throw new IOException("Invalid license metadata");
                    System.out.println(line.substring(separator + 1) + "\n");
                    System.out.write(texts, offset, length); System.out.println("\n");
                }
                return;
            }
        }
        throw new IOException("Run the command from the installed browser APK to read its notices");
    }
    private static byte[] apkBytes(ZipFile apk, String name) throws IOException {
        java.util.zip.ZipEntry entry = apk.getEntry(name);
        if (entry == null) throw new IOException("This APK is missing dependency license notices");
        try (InputStream input = apk.getInputStream(entry); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }
}
