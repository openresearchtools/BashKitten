// SPDX-License-Identifier: MIT
// Adapted from Android Remote Control MCP v1.12.0, Copyright 2026–2027 Daniele Salvatore Albano.
// BashKitten changes: on-demand access, no cache/logging/event forwarding; live native policy gates.
package com.bashkitten.phone;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

public final class PhoneNotificationService extends NotificationListenerService {
    static volatile PhoneNotificationService current;
    private static final Object lifecycle = new Object();
    private volatile boolean ready;
    private long generation;
    boolean ready(){return ready;}
    @Override public void onListenerConnected(){
        synchronized(lifecycle){generation++;ready=true;current=this;}
        PhoneControlsRuntime.get(this).policy.changed();
    }
    void unbind(){
        final long expected;
        synchronized(lifecycle){if(current!=this||!ready)return;ready=false;expected=generation;}
        PhoneControlsRuntime.get(this).policy.stateChanged();
        // Only the background reconciler issues Binder requests, once per
        // connection. Off stays enforced while Android completes the unbind.
        try{requestUnbind();}
        catch(SecurityException disconnected){
            // Android may have revoked this listener token before its callback.
            // Retire only that connection, never a newer onListenerConnected.
            disconnected(expected);
        }
    }
    private void disconnected(long expected){
        synchronized(lifecycle){
            if(expected>=0&&generation!=expected)return;
            generation++;ready=false;
            if(current!=this)return;
            current=null;
        }
        PhoneControlsRuntime.get(this).policy.changed();
    }
    @Override public void onListenerDisconnected(){disconnected(-1);}
    @Override public void onDestroy(){disconnected(-1);super.onDestroy();}
    // Deliberately do not extract or retain callback payloads. Current state is read only on an authorized request.
    @Override public void onNotificationPosted(StatusBarNotification value){}
    @Override public void onNotificationRemoved(StatusBarNotification value){}
}
