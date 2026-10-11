// SPDX-License-Identifier: AGPL-3.0-only
package org.mozilla.geckoview;

import java.util.WeakHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.mozilla.gecko.util.BundleEventListener;
import org.mozilla.gecko.util.EventCallback;
import org.mozilla.gecko.util.GeckoBundle;
import org.mozilla.gecko.util.ThreadUtils;

/** Separate enrollment from HTTPS Agent pages and ordinary browser sessions. */
public final class BashKittenSettingsController {
    private static final String EVENT = "BashKitten:SettingsCall";
    private static final WeakHashMap<GeckoSession, Listener> OWNERS = new WeakHashMap<>();
    private BashKittenSettingsController() {}
    public interface Delegate { void call(String method, String args, Consumer<String> reply); }
    public static void setDelegate(GeckoSession session, String section, Delegate delegate) {
        ThreadUtils.assertOnUiThread();
        Listener previous = OWNERS.remove(session);
        if (previous != null) { previous.active = false; session.getEventDispatcher().unregisterUiThreadListener(previous, EVENT); }
        if (delegate == null) return;
        String context = session.getSettings().getContextId();
        if (context == null || !context.startsWith("bashkitten-settings-")) throw new IllegalArgumentException("Native settings context required");
        Listener owner = new Listener(section, delegate);
        OWNERS.put(session, owner);
        session.getEventDispatcher().registerUiThreadListener(owner, EVENT);
    }
    private static final class Listener implements BundleEventListener {
        final String section;
        final Delegate delegate;
        boolean active = true;
        Listener(String section, Delegate delegate) { this.section = section; this.delegate = delegate; }
        @Override public void handleMessage(String event, GeckoBundle data, EventCallback callback) {
            String args = data.getString("args", "{}");
            if (!active || !section.equals(data.getString("section"))) {
                callback.sendSuccess("{\"error\":\"Settings view unavailable\"}"); return;
            }
            AtomicBoolean answered = new AtomicBoolean();
            Consumer<String> reply = value -> ThreadUtils.runOnUiThread(() -> {
                if (!answered.compareAndSet(false, true)) return;
                callback.sendSuccess(!active ? "{\"error\":\"Settings view closed\"}" : value == null ? "{\"error\":\"Invalid settings response\"}" : value);
            });
            try { delegate.call(data.getString("command", ""), args, reply); }
            catch (RuntimeException failure) { reply.accept("{\"error\":\"Settings action failed\"}"); }
        }
    }
}
