// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.ZipFile;
import org.json.JSONObject;

/** Executed directly from the installed browser APK with Android's app_process. */
public final class BrowserCommand {
    public static void main(String[] arguments) {
        try { System.exit(run(arguments)); }
        catch (Exception error) {
            System.err.println("Wild Buzzard: " + (error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()));
            System.exit(1);
        }
    }
    private static int run(String[] arguments) throws Exception {
        ArrayList<String> args = new ArrayList<>(Arrays.asList(arguments));
        boolean legacy = args.remove("--legacy-key") || args.contains("--state-dir");
        if (!legacy && !args.contains("--licenses") && !args.contains("--help")) return nativeRun(args);
        boolean noLaunch = args.remove("--no-launch");
        String home = System.getenv("HOME");
        Path directory = home == null ? null : Paths.get(home, ".config", "wildbuzzard");
        int state = args.indexOf("--state-dir");
        if (state >= 0) {
            if (state + 1 >= args.size()) throw new IllegalArgumentException("--state-dir needs a directory");
            directory = Paths.get(args.remove(state + 1)); args.remove(state);
        }
        if (directory == null) throw new IllegalArgumentException("Set --state-dir to an app-private directory");
        if (args.contains("--help")) {
            System.out.println("Wild Buzzard Android commands (included in the browser APK)\n"
                + "  --authorize                  Allow this Android app (publisher-signed apps are automatic)\n"
                + "  METHOD [PARAMS_JSON]          Run a browser tool\n"
                + "  --json REQUEST_JSON          Run a complete JSON request\n"
                + "  (no arguments)               Read one JSON request from stdin\n"
                + "  --session ID                 Isolate one chat session\n"
                + "  --output FILE                Save a screenshot/download privately\n"
                + "  --legacy-key                 Use the older command-key transport\n"
                + "  --state-dir DIRECTORY        Legacy private-key directory\n"
                + "  --licenses                   Print the browser's license notices\n"
                + "  --no-launch                  Return launch tickets to an Android caller\n"
                + "Examples: tabs.list; tabs.create '{\"url\":\"https://example.com\"}'\n"
                + "          tabs.show '{\"tabId\":\"...\"}'; tabs.close '{\"tabId\":\"...\"}'\n"
                + "Other tools: capabilities, snapshot, act, read, evaluate, wait, screenshot,\n"
                + "navigate, back, forward, reload, stop, console, clearConsole, viewport,\n"
                + "tabs.setDesktopMode, tabs.setAdblocking, diagnostics, downloads.list, downloads.get. No companion app is required.");
            return 0;
        }
        if (args.equals(Collections.singletonList("--licenses"))) { licenses(); return 0; }
        if (args.equals(Collections.singletonList("--version"))) { System.out.println("Wild Buzzard Android command protocol 1"); return 0; }
        boolean authorize = args.equals(Collections.singletonList("--authorize"));
        Path file = directory.resolve("command-key");
        if (authorize && !Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
            Files.createDirectories(directory, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            byte[] created = CommandProtocol.hex(CommandProtocol.random(32)).getBytes(StandardCharsets.US_ASCII);
            try (OutputStream output = Files.newOutputStream(file, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------")); output.write(created);
            }
        }
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Run --authorize first");
        Set<java.nio.file.attribute.PosixFilePermission> permissions = Files.getPosixFilePermissions(file, LinkOption.NOFOLLOW_LINKS);
        if (!PosixFilePermissions.fromString("rw-------").containsAll(permissions))
            throw new IOException("The command key must be private to this app (chmod 600)");
        if (Files.size(file) != 64) throw new IOException("Invalid command key file");
        byte[] key = CommandProtocol.key(new String(Files.readAllBytes(file), StandardCharsets.US_ASCII));
        if (authorize) {
            System.err.println("Approve command key " + CommandProtocol.id(key).substring(0, 12) + " in Wild Buzzard.");
            launch("key", CommandProtocol.hex(key));
            long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.MINUTES.toNanos(3);
            do {
                try {
                    JSONObject result = request(key, "{\"method\":\"capabilities\"}");
                    if (result.has("result")) { System.out.println("{\"result\":\"authorized\"}"); return 0; }
                } catch (Exception ignored) {}
                Thread.sleep(500);
            } while (System.nanoTime() < deadline);
            throw new IOException("Command access was not approved");
        }
        String json;
        if (args.isEmpty()) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
            while ((count = System.in.read(buffer)) != -1) {
                if (bytes.size() + count > 800000) throw new IOException("Request too large");
                bytes.write(buffer, 0, count);
            }
            json = bytes.toString("UTF-8");
        } else if (args.size() == 2 && args.get(0).equals("--json")) json = args.get(1);
        else if (args.size() == 1 || args.size() == 2) {
            json = new JSONObject().put("method", args.get(0))
                .put("params", args.size() == 2 ? new JSONObject(args.get(1)) : new JSONObject()).toString();
        } else throw new IllegalArgumentException("Use --help for command syntax");
        if (json.length() > 200000) throw new IOException("Request too large");
        JSONObject response;
        try { response = request(key, json); }
        catch (ConnectException error) {
            if (noLaunch) throw error;
            launch(null, null);
            long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(20);
            do {
                Thread.sleep(250);
                try { response = request(key, json); break; }
                catch (ConnectException retry) { if (System.nanoTime() >= deadline) throw retry; }
            } while (true);
        }
        JSONObject result = response.optJSONObject("result");
        if (!noLaunch && result != null && result.has("launch")) {
            launch("launch", result.getString("launch"));
            response = new JSONObject().put("result", true);
        }
        System.out.println(response);
        return response.has("error") ? 1 : 0;
    }
    private static byte[] readAtMost(InputStream stream, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
        while (out.size() < limit && (count = stream.read(buffer, 0, Math.min(buffer.length, limit - out.size()))) != -1) out.write(buffer, 0, count);
        return out.toByteArray();
    }
    private static int nativeRun(ArrayList<String> args) throws Exception {
        boolean noLaunch = args.remove("--no-launch");
        String scope = option(args, "--session"), output = option(args, "--output");
        if (scope != null && (scope.length() > 128 || !scope.matches("[A-Za-z0-9_.:-]+")))
            throw new IllegalArgumentException("Invalid session identifier");
        if (args.equals(Collections.singletonList("--version"))) {
            System.out.println("Wild Buzzard Android app-identity command protocol 2"); return 0;
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
        if (scope != null) command.put("session", scope);
        if (output != null) {
            if (!Arrays.asList("screenshot", "downloads.get").contains(command.optString("method")))
                throw new IllegalArgumentException("--output is for screenshot or downloads.get");
            JSONObject params = command.optJSONObject("params"); if (params == null) params = new JSONObject();
            command.put("params", params.put("transfer", true));
        }
        int browserUid = browserUid();
        JSONObject response;
        try { response = nativeRequest(browserUid, command); }
        catch (IOException error) {
            if (noLaunch) throw error;
            launch(null, null);
            long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(20);
            do {
                Thread.sleep(250);
                try { response = nativeRequest(browserUid, command); break; }
                catch (IOException retry) { if (System.nanoTime() >= deadline) throw retry; }
            } while (true);
        }
        JSONObject result = response.optJSONObject("result");
        if (authorize && result != null && result.has("appGrant") && !noLaunch) {
            launch("appGrant", result.getString("appGrant"));
            long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.MINUTES.toNanos(3);
            do {
                Thread.sleep(500);
                JSONObject check = nativeRequest(browserUid, new JSONObject().put("method", "capabilities"));
                if (!check.has("error")) { System.out.println("{\"result\":\"authorized\"}"); return 0; }
            } while (System.nanoTime() < deadline);
            throw new IOException("App access was not approved");
        }
        if (result != null && result.has("launch") && !noLaunch) {
            launch("launch", result.getString("launch")); response = new JSONObject().put("result", true);
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
        if (!match.find()) throw new IOException("Install Wild Buzzard first");
        return Integer.parseInt(match.group(1));
    }
    private static JSONObject nativeRequest(int browserUid, JSONObject request) throws Exception {
        if (request.toString().length() > 200000) throw new IOException("Request too large");
        try (android.net.LocalSocket socket = new android.net.LocalSocket()) {
            socket.connect(new android.net.LocalSocketAddress(AppCommandGateway.socketName()));
            if (socket.getPeerCredentials().getUid() != browserUid) throw new SecurityException("Command socket is not owned by the installed Wild Buzzard app");
            socket.setSoTimeout(220000);
            CommandProtocol.write(socket.getOutputStream(), request);
            return CommandProtocol.read(socket.getInputStream(), 1200000);
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
    static JSONObject request(byte[] key, String json) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", CommandProtocol.PORT), 5000); socket.setSoTimeout(5000);
            String client = CommandProtocol.hex(CommandProtocol.random(32));
            CommandProtocol.write(socket.getOutputStream(), new JSONObject().put("protocol", 1).put("keyId", CommandProtocol.id(key)).put("nonce", client));
            JSONObject challenge = CommandProtocol.read(socket.getInputStream(), 4096);
            String server = challenge.getString("nonce");
            if (!server.matches("[0-9a-f]{64}")) throw new SecurityException("Invalid browser challenge");
            String transcript = client + "\n" + server;
            if (!MessageDigest.isEqual(CommandProtocol.key(challenge.getString("proof")), CommandProtocol.mac(key, "server\n" + transcript)))
                throw new SecurityException("The command endpoint is not your authorized browser");
            CommandProtocol.write(socket.getOutputStream(), CommandProtocol.encrypt(key, "request\n" + transcript, json));
            socket.setSoTimeout(220000);
            return new JSONObject(CommandProtocol.decrypt(key, "response\n" + transcript, CommandProtocol.read(socket.getInputStream(), 1200000)));
        }
    }
    private static void launch(String extra, String value) throws Exception {
        ArrayList<String> command = new ArrayList<>(Arrays.asList("am", "start", "-n"));
        command.add(extra == null ? CommandProtocol.PACKAGE + "/org.mozilla.fenix.HomeActivity" : CommandProtocol.ACTIVITY);
        if (extra != null) { command.add("--es"); command.add(extra); command.add(value); }
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[1024]; int count;
        while ((count = process.getInputStream().read(buffer)) != -1) if (bytes.size() < 16384) bytes.write(buffer, 0, count);
        if (process.waitFor() != 0 || bytes.toString("UTF-8").contains("Error:"))
            throw new IOException("Android could not open Wild Buzzard. Run from a visible terminal with Termux's am command, or open the browser yourself.");
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
                byte[] metadata = apkBytes(apk, "res/raw/third_party_license_metadata");
                byte[] texts = apkBytes(apk, "res/raw/third_party_licenses");
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
