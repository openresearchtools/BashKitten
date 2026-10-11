// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.display;

import android.content.*;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/** Browser-owned native viewport slot. Rendering, engine/input and I/O live elsewhere. */
public final class DisplayViewport extends FrameLayout {
    public interface ConnectionProvider {
        void request(Consumer<ParcelFileDescriptor> ready, Consumer<String> failure);
    }
    private static final ExecutorService IO = Executors.newCachedThreadPool(r -> new Thread(r, "Display-IPC"));
    private static final AtomicLong IDS = new AtomicLong();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SurfaceView slot;
    private final TextView message;
    private final ConnectionProvider provider;
    private final Runnable closeTab;
    private IDisplayRenderer renderer;
    private ServiceConnection binding;
    private SurfaceControlViewHost.SurfacePackage child;
    private volatile long generation;
    private volatile boolean active;
    private boolean bound, resized;
    private int lastWidth, lastHeight;

    public DisplayViewport(Context context, ConnectionProvider provider, Runnable closeTab) {
        super(context); this.provider = provider; this.closeTab = closeTab;
        setBackgroundColor(0xff202225);
        slot = new SurfaceView(context);
        slot.setZOrderOnTop(true);
        slot.getHolder().setFormat(android.graphics.PixelFormat.TRANSLUCENT);
        slot.setFocusable(true); slot.setFocusableInTouchMode(true);
        addView(slot, new LayoutParams(-1, -1));
        message = new TextView(context); message.setTextColor(Color.WHITE); message.setGravity(Gravity.CENTER);
        message.setText("Preparing Display…"); addView(message, new LayoutParams(-1, -1));
        slot.getHolder().addCallback(new SurfaceHolder.Callback() {
            public void surfaceCreated(SurfaceHolder holder) { maybeAttach(); }
            public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) { resize(); maybeAttach(); }
            public void surfaceDestroyed(SurfaceHolder holder) { detach(); }
        });
        addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> resize());
        // Slot bounds are already the Fenix content rectangle, including IME shrink.
        // It is the sole inset owner; child receives zero content insets.
    }
    public void selected(boolean selected) {
        active = selected;
        if (selected) { setVisibility(VISIBLE); maybeAttach(); }
        else { detach(); setVisibility(GONE); }
    }
    // Android transfers focus from the host window to its embedded window. That
    // host focus loss is not a tab blur; the child's own window tracks real focus.
    @Override protected void onDetachedFromWindow() { active = false; detach(); super.onDetachedFromWindow(); }
    private void maybeAttach() {
        if (!active || bound || !isAttachedToWindow() || slot.getHostToken() == null || slot.getWidth() <= 0 || slot.getHeight() <= 0) return;
        long id = generation = IDS.incrementAndGet(); bound = true;
        message.setText("Connecting to desktop…"); message.setVisibility(VISIBLE);
        binding = new ServiceConnection() {
            public void onServiceConnected(ComponentName name, IBinder binder) {
                if (id != generation || !active) return;
                renderer = IDisplayRenderer.Stub.asInterface(binder);
                final IDisplayRenderer target = renderer;
                final IBinder token = slot.getHostToken();
                final int display = slot.getDisplay().getDisplayId(), width = slot.getWidth(), height = slot.getHeight();
                final Configuration configuration = new Configuration(getResources().getConfiguration());
                IO.execute(() -> provider.request(connection -> {
                    if (id != generation || !active) { close(connection); return; }
                    try { target.attach(id, token, display, width, height, configuration, connection, callback); }
                    catch (RemoteException | RuntimeException error) { fail(id, "Renderer connection failed. Close and reopen Display."); }
                    finally { close(connection); }
                }, error -> fail(id, error)));
            }
            public void onServiceDisconnected(ComponentName name) { fail(id, "Display renderer stopped. Close and reopen Display; desktop apps remain running."); }
            public void onBindingDied(ComponentName name) { fail(id, "Display renderer changed. Close and reopen Display."); }
            public void onNullBinding(ComponentName name) { fail(id, "Display renderer is unavailable."); }
        };
        ServiceConnection connection = binding;
        IO.execute(() -> {
            try {
                boolean connected = getContext().bindService(new Intent(getContext(), DisplayRendererService.class), Context.BIND_AUTO_CREATE,
                    command -> main.post(command), connection);
                if (!connected) fail(id, "Could not start the Display renderer.");
                // bindService may finish after the tab closed.
                else if (id != generation) unbind(connection);
            } catch (RuntimeException error) { fail(id, "Could not bind Display: " + error.getMessage()); }
        });
        main.postDelayed(() -> { if (id == generation && child == null) fail(id, "Display attachment timed out. Close and reopen Display."); }, 15000);
    }
    private final IDisplayClient.Stub callback = new IDisplayClient.Stub() {
        public void surface(long id, SurfaceControlViewHost.SurfacePackage value) {
            main.post(() -> {
                if (id != generation || !active) { value.release(); return; }
                if (child != null) child.release(); child = value;
                lastWidth = lastHeight = 0;
                slot.setChildSurfacePackage(value); slot.requestFocus(); message.setVisibility(GONE); resize();
            });
        }
        public void state(long id, boolean connected, String error) {
            if (error != null && !error.isEmpty()) fail(id, error);
        }
        public void close(long id) { main.post(() -> { if (id == generation) closeTab.run(); }); }
    };
    private void resize() {
        if (resized) return; resized = true;
        postOnAnimation(() -> {
            resized = false;
            int width = slot.getWidth(), height = slot.getHeight();
            // The FD may arrive after a rotation/IME resize. Only send geometry
            // once attach completed, then apply the latest bounds, not its snapshot.
            if (!active || renderer == null || child == null || width <= 0 || height <= 0 || (width == lastWidth && height == lastHeight)) return;
            lastWidth = width; lastHeight = height;
            IDisplayRenderer target = renderer; long id = generation;
            Configuration config = new Configuration(getResources().getConfiguration());
            if (child != null) child.notifyConfigurationChanged(config);
            IO.execute(() -> { try { target.resize(id, width, height, config); } catch (RemoteException error) { fail(id, "Display resize failed."); } });
        });
    }
    private void fail(long id, String error) {
        main.post(() -> { if (id == generation) {
            // Release the top-level embedded surface so a failure cannot cover its
            // browser-owned explanation or retain input over another tab.
            active = false; detach(); message.setText(error); message.setVisibility(VISIBLE);
        } });
    }
    public void detach() {
        long id = generation; generation = IDS.incrementAndGet();
        IDisplayRenderer target = renderer; renderer = null; bound = false;
        ServiceConnection connection = binding; binding = null;
        if (child != null) { child.release(); child = null; }
        lastWidth = lastHeight = 0;
        IO.execute(() -> {
            if (target != null) try { target.focus(id, false); target.detach(id); } catch (RemoteException ignored) {}
            if (connection != null) unbind(connection);
        });
    }
    private void unbind(ServiceConnection connection) { try { getContext().unbindService(connection); } catch (IllegalArgumentException ignored) {} }
    private static void close(ParcelFileDescriptor descriptor) { if (descriptor != null) try { descriptor.close(); } catch (java.io.IOException ignored) {} }
}
