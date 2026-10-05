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
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.*;

/** A process-owned, authenticated SOCKS entrance to Tor's private filesystem socket. */
final class TorGateway {
    private final ServerSocket listener;
    private final String path;
    final String secret;
    private final ExecutorService connections = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, AgentRoute> agents = new ConcurrentHashMap<>();

    TorGateway(String path) throws IOException {
        this.path = path;
        secret = newSecret();
        listener = new ServerSocket();
        listener.bind(new InetSocketAddress("127.0.0.1", 0));
        Thread accept = new Thread(() -> {
            while (!listener.isClosed()) {
                try {
                    Socket socket = listener.accept();
                    connections.execute(() -> {
                        try { forward(socket); } catch (IOException ignored) {}
                        finally { try { socket.close(); } catch (IOException ignored) {} }
                    });
                } catch (IOException ignored) { break; }
            }
        }, "bashkitten-tor-gateway");
        accept.setDaemon(true); accept.start();
    }
    int port() { return listener.getLocalPort(); }
    private static String newSecret() {
        byte[] random = new byte[32]; new SecureRandom().nextBytes(random);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(random);
    }

    /** A private route credential supplied only to its protected Gecko view. */
    final class AgentRoute implements AutoCloseable {
        final String host, secret = newSecret();
        private final Set<Socket> active = new HashSet<>();
        private int mappedPort;
        private boolean closed;
        private AgentRoute(String host) { this.host = host; }
        private synchronized void attach(Socket socket) throws IOException {
            if (closed) throw new IOException("Agent route is closed");
            active.add(socket);
        }
        private synchronized void detach(Socket socket) { active.remove(socket); }
        private synchronized int target() throws IOException {
            if (closed) throw new IOException("Agent route is closed");
            return mappedPort;
        }
        synchronized void useTunnel(int port) {
            if (closed || port < 1 || port > 65535) throw new IllegalStateException("Invalid Agent tunnel");
            if (mappedPort == port) return;
            mappedPort = port;
            // Existing login sockets must not keep bypassing the carrier after
            // activation. Gecko reconnects with the same enrolled HTTPS origin.
            closeSockets();
        }
        private void closeSockets() {
            for (Socket socket : active) try { socket.close(); } catch (IOException ignored) {}
            active.clear();
        }
        @Override public synchronized void close() {
            closed = true; agents.remove(secret, this); closeSockets();
        }
    }
    AgentRoute agentRoute(String host) {
        if (host == null || !host.matches("[a-z2-7]{56}\\.onion")) throw new IllegalArgumentException("Invalid Agent onion");
        AgentRoute route = new AgentRoute(host); agents.put(route.secret, route); return route;
    }
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
        AgentRoute route = agents.get(new String(password, StandardCharsets.US_ASCII));
        if (route != null) {
            route.attach(browser);
            try {
                output.write(new byte[]{1, 0});
                byte[] request = read(input, 4);
                if (request[0] != 5 || request[1] != 1 || request[2] != 0 || request[3] != 3)
                    throw new IOException("Agent route requires an exact onion destination");
                int hostSize = input.read();
                if (hostSize < 1) throw new IOException("Missing Agent destination");
                byte[] host = read(input, hostSize), port = read(input, 2);
                if (!route.host.equals(new String(host, StandardCharsets.US_ASCII)) || port[0] != 1 || (port[1] & 255) != 187)
                    throw new IOException("Unexpected Agent destination");
                int mapped = route.target();
                if (mapped != 0) {
                    try (Socket tunnel = new Socket()) {
                        tunnel.connect(new InetSocketAddress("127.0.0.1", mapped), 5000);
                        output.write(new byte[]{5, 0, 0, 1, 127, 0, 0, 1, 0, 0});
                        browser.setSoTimeout(0);
                        pipe(browser, input, output, tunnel.getInputStream(), tunnel.getOutputStream(), tunnel, tunnel::shutdownOutput);
                    }
                } else {
                    ByteArrayOutputStream destination = new ByteArrayOutputStream();
                    destination.write(request); destination.write(hostSize); destination.write(host); destination.write(port);
                    torForward(browser, input, output, header, user, password, destination.toByteArray());
                }
            } finally { route.detach(browser); }
            return;
        }
        if (!MessageDigest.isEqual(password, secret.getBytes(StandardCharsets.US_ASCII))) {
            output.write(new byte[]{1, 1}); return;
        }
        torForward(browser, input, output, header, user, password, null);
    }
    private void torForward(Socket browser, InputStream input, OutputStream output,
            byte[] header, byte[] user, byte[] password, byte[] destination) throws IOException {
        try (LocalSocket tor = new LocalSocket()) {
            // No other Android UID can replace this socket inside the app's private directory.
            tor.connect(new LocalSocketAddress(path, LocalSocketAddress.Namespace.FILESYSTEM));
            tor.setSoTimeout(5000);
            InputStream upstream = tor.getInputStream(); OutputStream downstream = tor.getOutputStream();
            downstream.write(new byte[]{5, 1, 2});
            byte[] method = read(upstream, 2);
            if (method[0] != 5 || method[1] != 2) throw new IOException("Tor authentication");
            downstream.write(header); downstream.write(user); downstream.write(password.length); downstream.write(password);
            byte[] accepted = read(upstream, 2);
            if (destination == null) output.write(accepted);
            if (accepted[0] != 1 || accepted[1] != 0) return;
            if (destination != null) downstream.write(destination);
            browser.setSoTimeout(0); tor.setSoTimeout(0);
            pipe(browser, input, output, upstream, downstream, tor, tor::shutdownOutput);
        }
    }
    private interface HalfClose { void run() throws IOException; }
    private void pipe(Socket browser, InputStream input, OutputStream output, InputStream upstream,
            OutputStream downstream, Closeable target, HalfClose finish) throws IOException {
        connections.execute(() -> {
            try { copy(input, downstream); finish.run(); }
            catch (IOException ignored) { try { target.close(); } catch (IOException ignoredAgain) {} }
        });
        try { copy(upstream, output); } finally { browser.close(); }
    }
    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[16384]; int count;
        while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
    }
}
