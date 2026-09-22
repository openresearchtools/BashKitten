// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.app.*;
import android.content.Intent;
import android.os.*;

/** Browser lifetime is independent of its windows. Agent power owns one CPU lock. */
public final class BrowserKeepAliveService extends Service {
    public static final String AGENT_ON = "com.bashkitten.AGENT_ON";
    public static final String AGENT_OFF = "com.bashkitten.AGENT_OFF";
    static volatile boolean active;
    private PowerManager.WakeLock wake;
    public static boolean isActive() { return active; }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        if (wake != null && wake.isHeld()) wake.release();
        active = false; super.onDestroy();
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        BrowserApp app = BrowserApp.get(this);
        String action = intent == null ? "" : intent.getAction();
        if (AGENT_ON.equals(action)) {
            if (wake == null) {
                wake = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BashKitten:Agent");
                wake.setReferenceCounted(false);
            }
            if (!wake.isHeld()) wake.acquire();
        } else if (AGENT_OFF.equals(action) && wake != null && wake.isHeld()) wake.release();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("browser", "Browser and Agent", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, app.host.launchIntent().putExtra("bashkitten.openAgent", true), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(1, new Notification.Builder(this, "browser").setContentTitle("BashKitten")
            .setContentText(wake != null && wake.isHeld() ? "Agent is on · CPU wake lock held" : "Browser tabs and Tor connections stay available")
            .setSmallIcon(android.R.drawable.ic_menu_compass).setContentIntent(open).setOngoing(true).build());
        active = true;
        return START_NOT_STICKY;
    }
}
