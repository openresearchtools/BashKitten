// SPDX-License-Identifier: MIT
// Adapted from Android Remote Control MCP v1.12.0, Copyright 2026–2027 Daniele Salvatore Albano.
// BashKitten changes: on-demand access, no cache/logging/event forwarding; live native policy gates.
package com.bashkitten.phone;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

public final class PhoneNotificationService extends NotificationListenerService {
    static volatile PhoneNotificationService current;
    @Override public void onListenerConnected(){current=this;PhonePolicy p=PhoneControlsRuntime.get(this).policy;if(!p.master()||!p.selected(PhonePolicy.Feature.NOTIFICATIONS))requestUnbind();p.changed();}
    @Override public void onListenerDisconnected(){if(current==this){current=null;PhoneControlsRuntime.get(this).policy.stateChanged();}}
    @Override public void onDestroy(){if(current==this){current=null;PhoneControlsRuntime.get(this).policy.stateChanged();}super.onDestroy();}
    // Deliberately do not extract or retain callback payloads. Current state is read only on an authorized request.
    @Override public void onNotificationPosted(StatusBarNotification value){}
    @Override public void onNotificationRemoved(StatusBarNotification value){}
}
