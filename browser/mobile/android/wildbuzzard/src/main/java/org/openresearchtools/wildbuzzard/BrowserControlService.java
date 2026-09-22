// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import java.util.*;
import org.openresearchtools.wildbuzzard.api.*;

public final class BrowserControlService extends Service {
    BrowserApp app;
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
                new Intent(BrowserControlService.this, ActivateTabActivity.class).setData(Uri.parse("wildbuzzard-tab:" + UUID.randomUUID()))
                    .putExtra("tab", id).putExtra("owner", owner).putExtra("uid", uid),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT);
        }
        @Override public void execute(String json, IAgentCallback callback) {
            if (callback == null) throw new IllegalArgumentException("Callback required");
            app.controller.execute(app.controller.forUid(Binder.getCallingUid()), json, value -> {
                try { callback.onResult(value); } catch (RemoteException ignored) {}
            });
        }
    };
    @Override public IBinder onBind(Intent intent) { return binder; }
}
