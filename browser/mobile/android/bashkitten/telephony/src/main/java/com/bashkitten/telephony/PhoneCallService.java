// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;

/** Active voice calls only. It is not a permanent microphone or hidden restart loop. */
public final class PhoneCallService extends Service {
    public static final String STOP = "com.bashkitten.phone.STOP_CALL";
    @Override public IBinder onBind(Intent ignored) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        TelephonyRuntime runtime = TelephonyRuntime.get(this);
        if (intent != null && STOP.equals(intent.getAction())) { runtime.hangup(); stopSelf(); return START_NOT_STICKY; }
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("bashkitten-calls", "BashKitten calls", NotificationManager.IMPORTANCE_LOW));
        PendingIntent stop = PendingIntent.getService(this, 0, new Intent(this, PhoneCallService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, "bashkitten-calls")
            .setSmallIcon(android.R.drawable.sym_action_call).setContentTitle("BashKitten call")
            .setContentText("Call audio uses LocalAI on this phone").setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "Hang up", stop).build()).build();
        try {
            startForeground(7184, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            runtime.execute(() -> runtime.voiceServiceReady(true, ""));
        } catch (RuntimeException error) {
            runtime.execute(() -> runtime.voiceServiceReady(false, "Android did not allow the call microphone service: " + error.getMessage()));
            stopSelf();
        }
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        TelephonyRuntime.get(this).execute(() -> TelephonyRuntime.get(this).voiceServiceStopped());
        super.onDestroy();
    }
}
