// SPDX-License-Identifier: AGPL-3.0-only
package com.taskarian;

import android.content.Context;
import com.taskarian.remote.mobile.Connection;
import com.taskarian.remote.mobile.Mobile;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Enumeration;
import org.json.JSONArray;
import org.json.JSONObject;

/** One native enrollment. Its owner runs blocking calls off the UI thread. */
final class NativeRemote implements AutoCloseable {
    private static boolean networkInterfacesConfigured;
    private final SecretStore tokens;
    private final Connection client;
    private final Object tokenLock = new Object();
    private boolean forgotten;
    private byte[] enrollment;

    NativeRemote(Context context, JSONObject bundle, String torSocket) throws Exception {
        go.Seq.setContext(context.getApplicationContext());
        configureNetworkInterfaces();
        String id = bundle.getString("id");
        if (!id.matches("[a-f0-9]{48}")) throw new IllegalArgumentException("Invalid remote identity");
        // Keep token rotation separate from the connection catalogue. The native
        // owner retains one instance per enrollment, including while Local is selected.
        tokens = new SecretStore(context, "remote-token-" + id);
        enrollment = bundle.toString().getBytes(StandardCharsets.UTF_8);
        byte[] savedToken = null;
        try {
            JSONObject stored = tokens.read();
            JSONObject saved = stored.has("token") ? stored.getJSONObject("token") : null;
            if (saved != null) savedToken = saved.toString().getBytes(StandardCharsets.UTF_8);
            String profile = new java.io.File(context.getNoBackupFilesDir(), "remote-network/" + id).getAbsolutePath();
            client = Mobile.openProfile(enrollment, "unix", torSocket, profile, savedToken, data -> {
                try {
                    String json = new String(data, StandardCharsets.UTF_8);
                    JSONObject value = new JSONObject();
                    if (!json.equals("null")) value.put("token", new JSONObject(json));
                    synchronized (tokenLock) {
                        if (forgotten) throw new IllegalStateException("Remote connection was forgotten");
                        tokens.write(value); // Atomic and complete before returning to Go.
                    }
                } finally { Arrays.fill(data, (byte) 0); }
            });
        } catch (Exception error) {
            Arrays.fill(enrollment, (byte) 0); enrollment = null;
            throw error;
        } finally { if (savedToken != null) Arrays.fill(savedToken, (byte) 0); }
    }

    private static synchronized void configureNetworkInterfaces() throws Exception {
        if (networkInterfacesConfigured) return;
        Mobile.setNetworkInterfaces(NativeRemote::networkInterfaces);
        networkInterfacesConfigured = true;
    }

    /** Called by upstream netmon on its worker, using Android's supported Java API. */
    private static String networkInterfaces() throws Exception {
        JSONArray result = new JSONArray();
        Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
        while (interfaces != null && interfaces.hasMoreElements()) {
            NetworkInterface value = interfaces.nextElement();
            JSONArray addresses = new JSONArray();
            boolean broadcast = false;
            for (InterfaceAddress address : value.getInterfaceAddresses()) {
                String ip = address.getAddress().getHostAddress();
                int zone = ip.indexOf('%');
                if (zone >= 0) ip = ip.substring(0, zone);
                addresses.put(ip + "/" + address.getNetworkPrefixLength());
                broadcast |= address.getBroadcast() != null;
            }
            result.put(new JSONObject().put("Name", value.getName()).put("Index", value.getIndex())
                .put("MTU", value.getMTU()).put("Up", value.isUp()).put("Broadcast", broadcast)
                .put("Loopback", value.isLoopback()).put("PointToPoint", value.isPointToPoint())
                .put("Multicast", value.supportsMulticast()).put("Addresses", addresses));
        }
        return result.toString();
    }

    static String host(JSONObject bundle) throws Exception {
        String host = bundle.getString(bundle.optInt("version") == 3 ? "host" : "onion");
        if (!host.matches("(?:[a-z2-7]{56}\\.onion|[a-f0-9]{48}\\.taskarian\\.invalid)")) throw new SecurityException("Invalid enrolled server identity");
        return host;
    }

    static JSONObject decrypt(Context context, String text, String password) throws Exception {
        go.Seq.setContext(context.getApplicationContext());
        byte[] plain = Mobile.decrypt(text, password);
        try { return new JSONObject(new String(plain, StandardCharsets.UTF_8)); }
        finally { Arrays.fill(plain, (byte) 0); }
    }

    static String readImage(Context context, byte[] image) throws Exception {
        go.Seq.setContext(context.getApplicationContext());
        return Mobile.readImage(image);
    }

    /** For the privileged Gecko configuration only; never return through a web bridge. */
    synchronized JSONObject browserIdentity() throws Exception {
        if (enrollment == null) throw new IllegalStateException("Remote connection is closed");
        byte[] identity = Mobile.browserIdentity(enrollment);
        try { return new JSONObject(new String(identity, StandardCharsets.UTF_8)); }
        finally { Arrays.fill(identity, (byte) 0); }
    }

    static JSONObject browserIdentity(Context context, JSONObject bundle) throws Exception {
        go.Seq.setContext(context.getApplicationContext());
        byte[] data = bundle.toString().getBytes(StandardCharsets.UTF_8);
        byte[] result = null;
        try {
            result = Mobile.browserIdentity(data);
            return new JSONObject(new String(result, StandardCharsets.UTF_8));
        } finally {
            Arrays.fill(data, (byte) 0);
            if (result != null) Arrays.fill(result, (byte) 0);
        }
    }

    int loginPort() throws Exception { return Math.toIntExact(client.loginPort()); }
    void closeLoginRoute() { client.closeLoginRoute(); }
    JSONObject transportStatus() throws Exception { return new JSONObject(client.transportStatus()); }
    String beginLogin() throws Exception { return client.beginLogin(); }
    boolean authorize() throws Exception { return client.authorize(); }
    void completeLogin(String callback, String form) throws Exception { client.completeLogin(callback, form); }
    void cancelLogin() { client.cancelLogin(); }
    JSONObject map(String id, int port) throws Exception { return new JSONObject(client.map(id, port)); }
    void unmap(String id) { client.unmap(id); }
    JSONArray mappings() throws Exception { return new JSONArray(client.mappings()); }
    JSONObject phone(String action, JSONObject value, JSONObject identity) throws Exception { return json(client.phone(new JSONObject().put("action", action).put("value", value).put("identity", identity).toString().getBytes(StandardCharsets.UTF_8))); }
    JSONObject services() throws Exception { return json(client.services()); }
    JSONObject serviceAction(String id, String action) throws Exception { return json(client.serviceAction(id, action)); }
    private static JSONObject json(byte[] data) throws Exception {
        try { return new JSONObject(new String(data, StandardCharsets.UTF_8)); }
        finally { Arrays.fill(data, (byte) 0); }
    }

    void logout() throws Exception {
        try { client.logout(); }
        finally { close(); }
    }

    void forget() throws Exception {
        close();
        synchronized (tokenLock) {
            forgotten = true;
            tokens.write(new JSONObject());
        }
    }

    static void forgetSaved(Context context, String id) throws Exception {
        if (!id.matches("[a-f0-9]{48}")) throw new IllegalArgumentException("Invalid remote identity");
        new SecretStore(context, "remote-token-" + id).write(new JSONObject());
        java.nio.file.Path directory = new java.io.File(context.getNoBackupFilesDir(), "remote-network/" + id).toPath();
        if (java.nio.file.Files.exists(directory, java.nio.file.LinkOption.NOFOLLOW_LINKS)) java.nio.file.Files.walkFileTree(directory, new java.nio.file.SimpleFileVisitor<java.nio.file.Path>() {
            @Override public java.nio.file.FileVisitResult visitFile(java.nio.file.Path file, java.nio.file.attribute.BasicFileAttributes attributes) throws java.io.IOException {
                java.nio.file.Files.delete(file); return java.nio.file.FileVisitResult.CONTINUE;
            }
            @Override public java.nio.file.FileVisitResult postVisitDirectory(java.nio.file.Path dir, java.io.IOException error) throws java.io.IOException {
                if (error != null) throw error;
                java.nio.file.Files.delete(dir); return java.nio.file.FileVisitResult.CONTINUE;
            }
        });
    }

    @Override public synchronized void close() {
        client.close();
        if (enrollment != null) { Arrays.fill(enrollment, (byte) 0); enrollment = null; }
        // Normal shutdown preserves the encrypted refresh token. Logout revokes it.
    }
}
