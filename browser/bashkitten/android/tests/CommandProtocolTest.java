// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.bashkitten;

import java.io.*;
import java.net.*;
import java.util.concurrent.*;
import javax.crypto.AEADBadTagException;
import org.json.JSONObject;

/** Host-side negative checks for the shell transport; device tests exercise the actual APK entry point. */
public final class CommandProtocolTest {
    interface Checked { void run() throws Exception; }
    static void rejects(Checked action) throws Exception {
        try { action.run(); throw new AssertionError("Operation was accepted"); }
        catch (AEADBadTagException | SecurityException | IOException expected) {}
    }
    public static void main(String[] args) throws Exception {
        byte[] key = CommandProtocol.random(32);
        String transcript = "client-challenge\nserver-challenge";
        JSONObject encrypted = CommandProtocol.encrypt(key, "request\n" + transcript, "{\"method\":\"tabs.list\"}");
        if (!CommandProtocol.decrypt(key, "request\n" + transcript, encrypted).contains("tabs.list")) throw new AssertionError();
        rejects(() -> CommandProtocol.decrypt(CommandProtocol.random(32), "request\n" + transcript, encrypted));
        rejects(() -> CommandProtocol.decrypt(key, "response\n" + transcript, encrypted));
        rejects(() -> CommandProtocol.decrypt(key, "request\nother-connection", encrypted));
        byte[] changed = java.util.Base64.getDecoder().decode(encrypted.getString("data")); changed[0] ^= 1;
        JSONObject tampered = new JSONObject(encrypted.toString()).put("data", java.util.Base64.getEncoder().encodeToString(changed));
        rejects(() -> CommandProtocol.decrypt(key, "request\n" + transcript, tampered));
        rejects(() -> CommandProtocol.read(new ByteArrayInputStream(new byte[]{0x7f, -1, -1, -1}), 4096));
        rejects(() -> CommandProtocol.read(new ByteArrayInputStream(new byte[]{0, 0, 0, 10, '{'}), 4096));
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try (ServerSocket server = new ServerSocket(CommandProtocol.PORT, 1, InetAddress.getByName("127.0.0.1"))) {
            Future<?> impostor = worker.submit(() -> {
                try (Socket socket = server.accept()) {
                    socket.setSoTimeout(5000);
                    CommandProtocol.read(socket.getInputStream(), 4096);
                    CommandProtocol.write(socket.getOutputStream(), new JSONObject().put("nonce", CommandProtocol.hex(CommandProtocol.random(32)))
                        .put("proof", CommandProtocol.hex(CommandProtocol.random(32))));
                    if (socket.getInputStream().read() != -1) throw new AssertionError("Client sent a command to an impostor");
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            rejects(() -> BrowserCommand.request(key, "{\"method\":\"evaluate\",\"params\":{\"code\":\"private data\"}}"));
            impostor.get(10, TimeUnit.SECONDS);
        } finally { worker.shutdownNow(); }
        System.out.println("PASS: encryption round trip; wrong key, tampering, replay transcript, reflection, invalid frames and endpoint impersonation rejected");
    }
}
