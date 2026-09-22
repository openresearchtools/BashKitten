// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.concurrent.*;

/** A process-owned, authenticated SOCKS entrance to Tor's private filesystem socket. */
final class TorGateway {
    private final ServerSocket listener;
    private final String path;
    final String secret;
    private final ExecutorService connections = Executors.newCachedThreadPool();
    private final Semaphore capacity = new Semaphore(64);

    TorGateway(String path) throws IOException {
        this.path = path;
        byte[] random = new byte[32]; new SecureRandom().nextBytes(random);
        secret = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        listener = new ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"));
        Thread accept = new Thread(() -> {
            while (!listener.isClosed()) {
                try {
                    Socket socket = listener.accept();
                    if (!capacity.tryAcquire()) { socket.close(); continue; }
                    connections.execute(() -> {
                        try { forward(socket); } catch (IOException ignored) {}
                        finally { try { socket.close(); } catch (IOException ignored) {} capacity.release(); }
                    });
                } catch (IOException ignored) { break; }
            }
        }, "bashkitten-tor-gateway");
        accept.setDaemon(true); accept.start();
    }
    int port() { return listener.getLocalPort(); }
    private static byte[] read(InputStream input, int count) throws IOException {
        byte[] result = new byte[count];
        int offset = 0;
        while (offset < count) {
            int got = input.read(result, offset, count - offset);
            if (got < 0) throw new EOFException();
            offset += got;
        }
        return result;
    }
    private void forward(Socket browser) throws IOException {
        browser.setSoTimeout(5000);
        InputStream input = browser.getInputStream(); OutputStream output = browser.getOutputStream();
        byte[] hello = read(input, 2);
        if (hello[0] != 5) throw new IOException("SOCKS version");
        boolean authenticated = false;
        for (byte method : read(input, hello[1] & 255)) if (method == 2) authenticated = true;
        if (!authenticated) { output.write(new byte[]{5, (byte)255}); return; }
        output.write(new byte[]{5, 2});
        byte[] header = read(input, 2);
        if (header[0] != 1 || header[1] == 0) throw new IOException("SOCKS authentication");
        byte[] user = read(input, header[1] & 255);
        int size = input.read(); if (size < 1) throw new IOException("SOCKS authentication");
        byte[] password = read(input, size);
        if (!MessageDigest.isEqual(password, secret.getBytes(StandardCharsets.US_ASCII))) {
            output.write(new byte[]{1, 1}); return;
        }
        try (LocalSocket tor = new LocalSocket()) {
            // No other Android UID can replace this socket inside the app's private directory.
            tor.connect(new LocalSocketAddress(path, LocalSocketAddress.Namespace.FILESYSTEM));
            tor.setSoTimeout(5000);
            InputStream upstream = tor.getInputStream(); OutputStream downstream = tor.getOutputStream();
            downstream.write(new byte[]{5, 1, 2});
            byte[] method = read(upstream, 2);
            if (method[0] != 5 || method[1] != 2) throw new IOException("Tor authentication");
            downstream.write(header); downstream.write(user); downstream.write(size); downstream.write(password);
            byte[] accepted = read(upstream, 2);
            output.write(accepted);
            if (accepted[0] != 1 || accepted[1] != 0) return;
            browser.setSoTimeout(0); tor.setSoTimeout(0);
            connections.execute(() -> {
                try { copy(input, downstream); tor.shutdownOutput(); }
                catch (IOException ignored) { try { tor.close(); } catch (IOException ignoredAgain) {} }
            });
            try { copy(upstream, output); } finally { browser.close(); }
        }
    }
    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[16384]; int count;
        while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
    }
}
