// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

final class AppGrants {
    private final Context context;
    private final Map<String, Request> pending = new HashMap<>();
    static final class Request {
        final int uid;
        final String identity;
        final long expires;
        Request(int uid, String identity) { this.uid = uid; this.identity = identity; expires = android.os.SystemClock.elapsedRealtime() + 300000; }
    }
    AppGrants(Context context) { this.context = context; }
    String identity(int uid) {
        try {
            String[] packages = context.getPackageManager().getPackagesForUid(uid);
            if (packages == null || packages.length == 0) throw new SecurityException("Unknown caller");
            ArrayList<String> identities = new ArrayList<>();
            for (String name : packages) {
                Signature[] signatures = context.getPackageManager().getPackageInfo(name,
                        PackageManager.GET_SIGNING_CERTIFICATES).signingInfo.getApkContentsSigners();
                for (Signature signature : signatures) {
                    byte[] digest = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray());
                    StringBuilder hex = new StringBuilder();
                    for (byte b : digest) hex.append(String.format("%02x", b & 255));
                    identities.add(name + ":" + hex);
                }
            }
            Collections.sort(identities);
            return String.join(",", identities);
        } catch (Exception error) { throw new SecurityException("Cannot verify caller", error); }
    }
    String require(int uid) {
        String identity = identity(uid);
        if (!context.getSharedPreferences("agent-grants", 0).getBoolean(identity, false)) {
            throw new SecurityException("User authorization required");
        }
        return identity;
    }
    synchronized PendingIntent request(int uid) {
        pending.entrySet().removeIf(e -> e.getValue().expires < android.os.SystemClock.elapsedRealtime());
        if (pending.size() >= 32) throw new SecurityException("Too many authorization requests");
        String nonce = UUID.randomUUID().toString();
        pending.put(nonce, new Request(uid, identity(uid)));
        Intent intent = new Intent(context, GrantActivity.class).setData(Uri.parse("wildbuzzard-grant:" + nonce));
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT);
    }
    synchronized Request consume(String nonce) {
        Request request = pending.remove(nonce);
        if (request == null || request.expires < android.os.SystemClock.elapsedRealtime()
                || !request.identity.equals(identity(request.uid))) throw new SecurityException("Authorization request expired");
        return request;
    }
    void approve(Request request) {
        if (!request.identity.equals(identity(request.uid))) throw new SecurityException("Caller changed");
        context.getSharedPreferences("agent-grants", 0).edit().putBoolean(request.identity, true).apply();
    }
    void revokeAll() { context.getSharedPreferences("agent-grants", 0).edit().clear().apply(); }
}
