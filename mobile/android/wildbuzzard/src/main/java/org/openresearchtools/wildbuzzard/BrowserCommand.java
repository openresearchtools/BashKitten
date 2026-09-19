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
                + "  --authorize                  Approve this terminal's command key\n"
                + "  METHOD [PARAMS_JSON]          Run a browser tool\n"
                + "  --json REQUEST_JSON          Run a complete JSON request\n"
                + "  (no arguments)               Read one JSON request from stdin\n"
                + "  --state-dir DIRECTORY        Private key directory (default $HOME/.config/wildbuzzard)\n"
                + "  --licenses                   Print the browser's license notices\n"
                + "  --no-launch                  Return launch tickets to an Android caller\n"
                + "Examples: tabs.list; tabs.create '{\"url\":\"https://example.com\"}'\n"
                + "          tabs.show '{\"tabId\":\"...\"}'; tabs.close '{\"tabId\":\"...\"}'\n"
                + "Other tools: capabilities, snapshot, act, read, evaluate, wait, screenshot,\n"
                + "navigate, back, forward, reload, stop, console, clearConsole, viewport,\n"
                + "tabs.setDesktopMode, tabs.setAdblocking. No companion app is required.");
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
