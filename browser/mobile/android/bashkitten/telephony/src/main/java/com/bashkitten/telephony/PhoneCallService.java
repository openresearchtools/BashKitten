// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;

/** User-enabled call reception. Only CallAudio creates a recorder, during a live call. */
public final class PhoneCallService extends Service {
    public static final String STOP = "com.bashkitten.phone.STOP_CALL";
    private static final String OFF = "com.bashkitten.phone.STOP_RECEPTION";
    @Override public IBinder onBind(Intent ignored) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        TelephonyRuntime runtime = TelephonyRuntime.get(this);
        if (intent != null && STOP.equals(intent.getAction())) {
            if (runtime.ownsVoiceService(this)) runtime.hangup(); else stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && OFF.equals(intent.getAction())) { runtime.configure(TelephonyRuntime.json("telephony", false)); return START_NOT_STICKY; }
        runtime.execute(() -> runtime.voiceServiceStarted(this));
        return START_NOT_STICKY;
    }
    void update(boolean active, long revision) {
        TelephonyRuntime runtime = TelephonyRuntime.get(this);
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("bashkitten-calls", "BashKitten calls", NotificationManager.IMPORTANCE_LOW));
        PendingIntent stop = PendingIntent.getService(this, 0, new Intent(this, PhoneCallService.class).setAction(active ? STOP : OFF), PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, "bashkitten-calls")
            .setSmallIcon(android.R.drawable.sym_action_call).setContentTitle(active ? "BashKitten call" : "BashKitten calls ready")
            .setContentText(active ? "Call audio uses LocalAI on this phone" : "Waiting for calls. Microphone is used only during a call.").setOngoing(true)
            .addAction(new Notification.Action.Builder(null, active ? "Hang up" : "Turn Calls off", stop).build()).build();
        try {
            startForeground(7184, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | (active ? ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL : 0));
            runtime.execute(() -> runtime.voiceServiceReady(this, revision, ""));
        } catch (RuntimeException error) {
            runtime.execute(() -> runtime.voiceServiceReady(this, revision, "Call reception is unavailable. Open Callback and turn Calls off and on again. Android: " + error.getMessage()));
        }
    }
    @Override public void onDestroy() {
        TelephonyRuntime.get(this).execute(() -> TelephonyRuntime.get(this).voiceServiceStopped(this));
        super.onDestroy();
    }
}
