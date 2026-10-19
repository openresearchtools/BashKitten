// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.service.notification.NotificationListenerService;
import android.provider.Settings;
import java.util.concurrent.atomic.AtomicLong;

/** A single native policy, never writable from command/worker credentials. */
public final class PhonePolicy {
    public enum Feature {
        APPS("Applications and links", false), NOTIFICATIONS("Notifications", false), FILES("Files and sharing", false),
        CLIPBOARD("Clipboard", false), LOCATION("Location", false), SCREEN("Screen and elements", true),
        TOUCH("Touch and element actions", true), TEXT("Text and keys", true), NAVIGATION("Navigation", true);
        public final String label; public final boolean accessibility;
        Feature(String label, boolean accessibility) { this.label = label; this.accessibility = accessibility; }
    }
    final Context context; final SharedPreferences preferences;
    private final java.util.Set<Runnable> listeners=new java.util.concurrent.CopyOnWriteArraySet<>();
    public void observe(Runnable listener){listeners.add(listener);}
    public void unobserve(Runnable listener){listeners.remove(listener);}
    public void stateChanged(){new android.os.Handler(android.os.Looper.getMainLooper()).post(()->{for(Runnable listener:listeners)listener.run();});}
    private final AtomicLong generation = new AtomicLong(1);
    PhonePolicy(Context context) { this.context = context; preferences = context.getSharedPreferences("phone-controls", Context.MODE_PRIVATE); }
    public long generation() { return generation.get(); }
    public boolean master() { try { return preferences.getBoolean("enabled", false); } catch (ClassCastException e) { return false; } }
    public boolean selected(Feature feature) { try { return preferences.getBoolean(feature.name(), false); } catch (ClassCastException e) { return false; } }
    public String unavailable(Feature feature) {
        if (feature.accessibility && PhoneAccessibilityService.current == null) return "Enable Accessibility access and connect the service";
        PhoneNotificationService listener = PhoneNotificationService.current;
        if (feature == Feature.NOTIFICATIONS && (!notificationGranted() || listener == null || !listener.ready())) return "Enable notification access and connect the listener";
        if (feature == Feature.LOCATION && context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return "Precise location access is required";
        return "";
    }
    public boolean effective(Feature feature) { return master() && selected(feature) && unavailable(feature).isEmpty(); }
    boolean notificationGranted() {
        String enabled = Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
        String name = new ComponentName(context, PhoneNotificationService.class).flattenToString();
        if (enabled != null) for (String item : enabled.split(":")) if (name.equals(item)) return true;
        return false;
    }
    public void setMaster(boolean value) { preferences.edit().putBoolean("enabled", value).apply(); changed(); }
    public void setSelected(Feature feature, boolean value) { preferences.edit().putBoolean(feature.name(), value).apply(); changed(); }
    public void changed() {
        generation.incrementAndGet();
        stateChanged();
        PhoneControlsRuntime.get(context).reconcile();
    }
    void require(Feature feature, long expected) {
        if (expected != generation() || !effective(feature)) throw new SecurityException("Phone feature is unavailable or was revoked");
    }
    void reconcileServices() {
        PhoneNotificationService listener = PhoneNotificationService.current;
        if (!master() || !selected(Feature.NOTIFICATIONS) || !notificationGranted()) { if (listener != null) listener.unbind(); }
        else if (listener == null && notificationGranted()) NotificationListenerService.requestRebind(new ComponentName(context, PhoneNotificationService.class));
        PhoneAccessibilityService service = PhoneAccessibilityService.current;
        if (service != null) service.reconcile();
    }
}
