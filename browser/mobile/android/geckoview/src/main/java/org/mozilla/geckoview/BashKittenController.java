// SPDX-License-Identifier: AGPL-3.0-or-later
package org.mozilla.geckoview;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.UiThread;
import java.lang.ref.WeakReference;
import java.util.WeakHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.mozilla.gecko.util.BundleEventListener;
import org.mozilla.gecko.util.EventCallback;
import org.mozilla.gecko.util.GeckoBundle;
import org.mozilla.gecko.util.ThreadUtils;

/** Product-private bridge to the session's privileged browser module. */
public final class BashKittenController {
    private static final String HOST_EVENT = "BashKitten:HostCall";
    private static final WeakHashMap<GeckoSession, HostListener> HOSTS = new WeakHashMap<>();

    /** Narrow native UI actions for the enrolled Agent document. */
    public interface HostDelegate {
        void call(@NonNull String command, @NonNull String args, @NonNull Consumer<String> reply);
    }

    private BashKittenController() {}

    @UiThread
    public static void setHostDelegate(@NonNull GeckoSession session, @Nullable HostDelegate delegate) {
        ThreadUtils.assertOnUiThread();
        HostListener previous = HOSTS.remove(session);
        if (previous != null) {
            previous.active = false;
            session.getEventDispatcher().unregisterUiThreadListener(previous, HOST_EVENT);
        }
        if (delegate == null) return;
        String context = session.getSettings().getContextId();
        if (context == null || !context.startsWith("bashkitten-agent-ui-")) {
            throw new IllegalArgumentException("Protected Agent session required");
        }
        HostListener listener = new HostListener(session, delegate);
        HOSTS.put(session, listener);
        session.getEventDispatcher().registerUiThreadListener(listener, HOST_EVENT);
    }

    private static final class HostListener implements BundleEventListener {
        private final WeakReference<GeckoSession> session;
        private final HostDelegate delegate;
        private boolean active = true;

        HostListener(GeckoSession session, HostDelegate delegate) {
            this.session = new WeakReference<>(session);
            this.delegate = delegate;
        }

        @Override
        public void handleMessage(String event, GeckoBundle message, EventCallback callback) {
            String command = message.getString("command", "");
            String args = message.getString("args", "{}");
            GeckoSession current = session.get();
            if (!active || current == null || HOSTS.get(current) != this || args.length() > 200000 ||
                    !("notification-settings".equals(command) || "notify-turn".equals(command) ||
                      "import-remote".equals(command) || "sign-in".equals(command))) {
                callback.sendSuccess("{\"error\":\"Unsupported Agent host request\"}");
                return;
            }
            AtomicBoolean answered = new AtomicBoolean();
            Consumer<String> reply = value -> ThreadUtils.runOnUiThread(() -> {
                if (!answered.compareAndSet(false, true)) return;
                callback.sendSuccess(!active ? "{\"error\":\"Agent host disconnected\"}" :
                        value == null || value.length() > 200000 ?
                        "{\"error\":\"Invalid Agent host response\"}" : value);
            });
            try {
                delegate.call(command, args, reply);
            } catch (RuntimeException error) {
                reply.accept("{\"error\":\"Agent host action failed\"}");
            }
        }
    }
    @UiThread
    public static void initialViewport(@NonNull GeckoSession session, int width, int height) {
        session.setBashKittenInitialViewport(width, height);
    }
    @UiThread
    public static @NonNull GeckoResult<String> request(
            @NonNull GeckoSession session, @NonNull String json) {
        GeckoBundle data = new GeckoBundle(1);
        data.putString("request", json);
        return session.getEventDispatcher().queryString("BashKitten:Request", data);
    }
}
