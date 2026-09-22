// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import java.util.*;
import com.bashkitten.api.*;

public final class BrowserControlService extends Service {
    BrowserApp app;
    private final Set<Integer> awaitingApproval = Collections.synchronizedSet(new HashSet<>());
    @Override public void onCreate() {
        super.onCreate(); app = BrowserApp.get(this);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        stopSelf(startId);
        return START_NOT_STICKY;
    }
    private final IAgentBrowser.Stub binder = new IAgentBrowser.Stub() {
        @Override public PendingIntent requestAccess() { return app.grants.request(Binder.getCallingUid()); }
        @Override public PendingIntent showTab(String id) {
            int uid = Binder.getCallingUid(); String owner = app.grants.require(uid);
            // The non-exported activation activity rechecks ownership on the UI thread.
            return PendingIntent.getActivity(BrowserControlService.this, 0,
                new Intent(BrowserControlService.this, ActivateTabActivity.class).setData(Uri.parse("bashkitten-tab:" + UUID.randomUUID()))
                    .putExtra("tab", id).putExtra("owner", owner).putExtra("uid", uid),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT);
        }
        @Override public void execute(String json, IAgentCallback callback) {
            if (callback == null) throw new IllegalArgumentException("Callback required");
            if (json == null || json.length() > 200000) throw new IllegalArgumentException("Invalid request");
            int uid = Binder.getCallingUid();
            if (app.grants.allowed(uid)) { executeApproved(uid, json, callback); return; }
            if (app.grants.denied(uid)) {
                result(callback, "{\"error\":\"Browser access denied\",\"code\":\"authorization_denied\"}"); return;
            }
            if (!awaitingApproval.add(uid)) {
                result(callback, "{\"error\":\"An app approval is already pending\",\"code\":\"authorization_pending\"}"); return;
            }
            String ticket;
            try {
                ticket = app.grants.ticket(uid);
                callback.onApprovalRequired(app.grants.request(uid));
            } catch (Exception error) { awaitingApproval.remove(uid); return; }
            app.main.post(new Runnable() {
                @Override public void run() {
                    if (!callback.asBinder().isBinderAlive()) { awaitingApproval.remove(uid); return; }
                    String status;
                    try { status = app.grants.status(uid, ticket); }
                    catch (SecurityException error) { status = "revoked"; }
                    if (status.equals("pending")) { app.main.postDelayed(this, 500); return; }
                    awaitingApproval.remove(uid);
                    if (status.equals("approved")) executeApproved(uid, json, callback);
                    else result(callback, "{\"error\":\"Browser access " + status + "\",\"code\":\"authorization_" + status + "\"}");
                }
            });
        }

    };
    private void executeApproved(int uid, String json, IAgentCallback callback) {
        try { app.controller.execute(app.controller.forUid(uid), json, value -> result(callback, value)); }
        catch (SecurityException error) { result(callback, "{\"error\":\"Browser access revoked\",\"code\":\"authorization_revoked\"}"); }
        catch (Exception error) { result(callback, "{\"error\":\"Invalid browser command\"}"); }
    }
    private void result(IAgentCallback callback, String value) {
        try { callback.onResult(value); } catch (RemoteException ignored) { }
    }
    @Override public IBinder onBind(Intent intent) { return binder; }
}
