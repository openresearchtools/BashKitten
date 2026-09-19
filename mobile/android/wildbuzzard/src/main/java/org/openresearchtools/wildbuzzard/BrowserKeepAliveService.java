// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.app.*;
import android.content.Intent;
import android.os.IBinder;

/** Non-exported foreground lifetime for approved agent work and active Tor browsing. */
public final class BrowserKeepAliveService extends Service {
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        BrowserApp app = BrowserApp.get(this);
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("browser", "Browser automation", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, app.host.launchIntent(), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(1, new Notification.Builder(this, "browser").setContentTitle("WildBuzzard is available")
            .setContentText("Browser tabs and Tor connections stay active").setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentIntent(open).setOngoing(true).build());
        return START_NOT_STICKY;
    }
}
