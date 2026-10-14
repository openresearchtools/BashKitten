// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.display;

import android.app.Service;
import android.content.*;
import android.content.res.Configuration;
import android.hardware.display.DisplayManager;
import android.os.*;
import android.os.Process;
import android.view.*;
import com.termux.x11.LorieHost;

/** Disposable :display process. It never owns Termux's X server or Pi lifetime. */
public final class DisplayRendererService extends Service {
    private final HandlerThread thread = new HandlerThread("BashKitten-Display");
    private Handler work;
    private SurfaceControlViewHost surface;
    private LorieHost host;
    private IDisplayClient client;
    private long generation = -1;
    private IBinder.DeathRecipient death;
    @Override public void onCreate() { super.onCreate(); thread.start(); work = new Handler(thread.getLooper()); }
    private void requireOwner() {
        if (Binder.getCallingUid() != Process.myUid()) throw new SecurityException("Private display renderer");
    }
    private final IDisplayRenderer.Stub binder = new IDisplayRenderer.Stub() {
        public void attach(long id, IBinder token, int displayId, int width, int height,
                           Configuration configuration, ParcelFileDescriptor connection, boolean interactive, IDisplayClient callback) {
            requireOwner();
            work.post(() -> {
                release(); generation = id; client = callback;
                try {
                    if (connection == null || token == null || callback == null || width <= 0 || height <= 0)
                        throw new IllegalArgumentException("Incomplete Display attachment");
                    Display display = getSystemService(DisplayManager.class).getDisplay(displayId);
                    if (display == null) throw new IllegalArgumentException("Display is unavailable");
                    Context window = createDisplayContext(display).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION, null);
                    // Disk reads and native initialization occur on this child thread.
                    SharedPreferences prefs = getSharedPreferences("embedded-display", MODE_PRIVATE); prefs.getAll();
                    host = new LorieHost(window, prefs, () -> {
                        try { if (client != null) client.close(generation); } catch (RemoteException ignored) {}
                    }, connected -> state(connected, connected ? "" : "Desktop connection closed. Reopen Display to attach again."));
                    host.interactive(interactive);
                    surface = new SurfaceControlViewHost(window, display, token);
                    surface.setView(host.content(), width, height);
                    host.getLorieView().setContentInsets(0, 0, 0, 0);
                    host.getLorieView().connect(connection.detachFd());
                    death = () -> work.post(DisplayRendererService.this::release);
                    callback.asBinder().linkToDeath(death, 0);
                    SurfaceControlViewHost.SurfacePackage parcel = surface.getSurfacePackage();
                    try { callback.surface(id, parcel); } finally { if (parcel != null) parcel.release(); }
                    state(host.getLorieView().connected(), "");
                } catch (Exception | LinkageError error) {
                    state(false, "Display could not attach: " + error.getClass().getSimpleName() + ": " + error.getMessage());
                    release();
                } finally { close(connection); }
            });
        }
        public void resize(long id, int width, int height, Configuration configuration) {
            requireOwner(); work.post(() -> {
                if (id != generation || surface == null || width <= 0 || height <= 0) return;
                surface.relayout(width, height);
                host.getLorieView().setContentInsets(0, 0, 0, 0);
            });
        }
        public void focus(long id, boolean focused) {
            requireOwner(); work.post(() -> { if (id == generation && host != null) host.focus(focused); });
        }
        public void interactive(long id, boolean enabled) {
            requireOwner(); work.post(() -> { if (id == generation && host != null) host.interactive(enabled); });
        }
        public void detach(long id) { requireOwner(); work.post(() -> { if (id == generation) release(); }); }
    };
    private void state(boolean connected, String error) {
        if (client != null) try { client.state(generation, connected, error); } catch (RemoteException ignored) {}
    }
    private void release() {
        if (client != null && death != null) client.asBinder().unlinkToDeath(death, 0);
        if (host != null) host.destroy();
        if (surface != null) surface.release();
        surface = null; host = null; client = null; death = null; generation = -1;
    }
    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public void onDestroy() {
        // Teardown must not wait for a blocked EGL driver/native frame. This process
        // contains only this module; its death closes renderer FDs, not the server.
        work.post(this::release);
        Process.killProcess(Process.myPid());
        super.onDestroy();
    }
    private static void close(ParcelFileDescriptor descriptor) {
        if (descriptor != null) try { descriptor.close(); } catch (java.io.IOException ignored) {}
    }
}
