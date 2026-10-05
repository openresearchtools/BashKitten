// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.content.Context;
import com.bashkitten.remote.mobile.Connection;
import com.bashkitten.remote.mobile.Mobile;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;

/** One native enrollment. Its owner runs blocking calls off the UI thread. */
final class NativeRemote implements AutoCloseable {
    private final SecretStore tokens;
    private final Connection client;
    private byte[] enrollment;

    NativeRemote(Context context, JSONObject bundle, String torSocket) throws Exception {
        go.Seq.setContext(context.getApplicationContext());
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
            client = Mobile.open(enrollment, "unix", torSocket, savedToken, data -> {
                try {
                    String json = new String(data, StandardCharsets.UTF_8);
                    JSONObject value = new JSONObject();
                    if (!json.equals("null")) value.put("token", new JSONObject(json));
                    tokens.write(value); // Atomic, encrypted and complete before returning to Go.
                } finally { Arrays.fill(data, (byte) 0); }
            });
        } catch (Exception error) {
            Arrays.fill(enrollment, (byte) 0); enrollment = null;
            throw error;
        } finally { if (savedToken != null) Arrays.fill(savedToken, (byte) 0); }
    }

    static JSONObject decrypt(Context context, String text, String password) throws Exception {
        go.Seq.setContext(context.getApplicationContext());
        byte[] plain = Mobile.decrypt(text, password);
        try { return new JSONObject(new String(plain, StandardCharsets.UTF_8)); }
        finally { Arrays.fill(plain, (byte) 0); }
    }

    /** For the privileged Gecko configuration only; never return through a web bridge. */
    synchronized JSONObject browserIdentity() throws Exception {
        if (enrollment == null) throw new IllegalStateException("Remote connection is closed");
        byte[] identity = Mobile.browserIdentity(enrollment);
        try { return new JSONObject(new String(identity, StandardCharsets.UTF_8)); }
        finally { Arrays.fill(identity, (byte) 0); }
    }

    String beginLogin() throws Exception { return client.beginLogin(); }
    void completeLogin(String callback) throws Exception { client.completeLogin(callback); }
    void cancelLogin() { client.cancelLogin(); }
    JSONObject map(String id, int port) throws Exception { return new JSONObject(client.map(id, port)); }
    void unmap(String id) { client.unmap(id); }
    JSONArray mappings() throws Exception { return new JSONArray(client.mappings()); }

    void logout() throws Exception {
        try { client.logout(); }
        finally { close(); }
    }

    @Override public synchronized void close() {
        client.close();
        if (enrollment != null) { Arrays.fill(enrollment, (byte) 0); enrollment = null; }
        // Normal shutdown preserves the encrypted refresh token. Logout revokes it.
    }
}
