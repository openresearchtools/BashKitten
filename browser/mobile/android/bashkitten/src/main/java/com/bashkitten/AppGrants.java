// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

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
    private final android.content.SharedPreferences preferences;
    final java.util.concurrent.atomic.AtomicInteger generation = new java.util.concurrent.atomic.AtomicInteger();
    private final Map<String, Request> pending = new HashMap<>();
    static final class Request {
        final int uid;
        final String identity;
        String status = "pending";
        boolean presented;
        Request(int uid, String identity) { this.uid = uid; this.identity = identity; }
    }
    AppGrants(Context context) {
        this.context = context;
        preferences = context.getSharedPreferences("agent-grants", 0);
        preferences.getAll();
    }
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
    boolean publisherTrusted() { return preferences.getBoolean("publisher-trusted", true); }
    void publisherTrusted(boolean enabled) { if (!enabled) generation.incrementAndGet(); preferences.edit().putBoolean("publisher-trusted", enabled).apply(); }
    boolean samePublisher(int uid) {
        try {
            Signature[] publisher = context.getPackageManager().getPackageInfo(context.getPackageName(),
                PackageManager.GET_SIGNING_CERTIFICATES).signingInfo.getApkContentsSigners();
            String[] packages = context.getPackageManager().getPackagesForUid(uid);
            if (packages == null || packages.length == 0 || uid == android.os.Process.myUid()) return false;
            java.util.Set<Signature> expected = new java.util.HashSet<>(java.util.Arrays.asList(publisher));
            for (String name : packages) {
                Signature[] actual = context.getPackageManager().getPackageInfo(name,
                    PackageManager.GET_SIGNING_CERTIFICATES).signingInfo.getApkContentsSigners();
                if (!expected.equals(new java.util.HashSet<>(java.util.Arrays.asList(actual)))) return false;
            }
            return true;
        } catch (Exception error) { return false; }
    }
    boolean allowed(int uid) {
        try { require(uid); return true; } catch (SecurityException error) { return false; }
    }
    int revision(String identity) { return preferences.getInt("revision." + identity, 0); }
    synchronized void setAllowed(int uid, boolean enabled) {
        String identity = identity(uid);
        android.content.SharedPreferences.Editor edit = preferences.edit().putBoolean(identity, enabled);
        if (!enabled) edit.putInt("revision." + identity, revision(identity) + 1);
        edit.apply();
        for (Request request : pending.values()) {
            if (request.identity.equals(identity) && (request.status.equals("pending") || request.status.equals("approved")))
                request.status = enabled ? "approved" : "revoked";
        }
    }
    String require(int uid) {
        String identity = identity(uid);
        if (!preferences.getBoolean(identity, publisherTrusted() && samePublisher(uid))) {
            throw new SecurityException("User authorization required");
        }
        return identity;
    }
    boolean denied(int uid) {
        String identity = identity(uid);
        return preferences.contains(identity) && !preferences.getBoolean(identity, false);
    }
    synchronized PendingIntent request(int uid) {
        String nonce = ticket(uid);
        Intent intent = new Intent(context, GrantActivity.class).setData(Uri.parse("bashkitten-grant:" + nonce));
        android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
        if (android.os.Build.VERSION.SDK_INT >= 35) options.setPendingIntentCreatorBackgroundActivityStartMode(
            android.os.Build.VERSION.SDK_INT >= 36 ? android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE
                : android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
        return PendingIntent.getActivity(context, 0, intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT, options.toBundle());
    }
    synchronized String ticket(int uid) {
        String identity = identity(uid);
        for (Map.Entry<String, Request> entry : pending.entrySet()) {
            Request value = entry.getValue();
            if (value.uid == uid && value.identity.equals(identity) && value.status.equals("pending")) return entry.getKey();
        }
        String nonce = UUID.randomUUID().toString();
        pending.put(nonce, new Request(uid, identity));
        return nonce;
    }
    synchronized String pendingTicket() {
        for (Map.Entry<String, Request> entry : pending.entrySet()) {
            Request request = entry.getValue();
            if (!request.presented && request.status.equals("pending")) return entry.getKey();
        }
        return null;
    }
    synchronized Request consume(String nonce, boolean restored) {
        Request request = pending.get(nonce);
        if (request == null || !request.status.equals("pending") || (request.presented && !restored)
                || !request.identity.equals(identity(request.uid)))
            throw new SecurityException("Authorization request is unavailable");
        request.presented = true;
        return request;
    }
    synchronized String status(int uid, String nonce) {
        Request request = pending.get(nonce);
        if (request == null) return "expired";
        if (request.uid != uid || !request.identity.equals(identity(uid))) throw new SecurityException("Caller changed");
        if (request.status.equals("approved") && !allowed(uid)) return "revoked";
        return request.status;
    }
    synchronized void approve(Request request) {
        if (!request.identity.equals(identity(request.uid)) || !request.status.equals("pending"))
            throw new SecurityException("Caller changed or request is unavailable");
        preferences.edit().putBoolean(request.identity, true).apply();
        request.status = "approved";
    }
    synchronized void reject(Request request, boolean denied) {
        if (!request.status.equals("pending")) return;
        request.status = denied ? "denied" : "cancelled";
        if (denied && request.identity.equals(identity(request.uid))) setAllowed(request.uid, false);
    }
    synchronized void revokeAll() {
        generation.incrementAndGet();
        for (Request request : pending.values()) request.status = "revoked";
        preferences.edit().clear().putBoolean("publisher-trusted", false).apply();
    }
}
