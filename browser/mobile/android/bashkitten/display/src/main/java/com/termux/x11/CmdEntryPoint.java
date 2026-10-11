// SPDX-License-Identifier: GPL-3.0-only
// Adapted from Termux:X11 fa3a8b430e28: native server remains under Termux UID.
// Discovery is BashKitten's approved Binder gateway, never upstream LAN knocks
// or broadcast-provided server binders. The browser's renderer may come and go.
package com.termux.x11;

import android.os.*;
import androidx.annotation.Keep;
import com.bashkitten.api.*;
import com.bashkitten.display.DisplayProtocol;
import java.net.URL;
import java.util.concurrent.*;
import dalvik.annotation.optimization.CriticalNative;

@Keep
public final class CmdEntryPoint {
    private static Handler handler;
    private final ExecutorService gateway = Executors.newSingleThreadExecutor();
    private IBinder endpoint;
    private volatile int browserUid = -1;
    private boolean publishing;
    private long authorizationGeneration;
    private int retry = 1000;
    public static void main(String[] args) {
        if (Looper.getMainLooper() == null) Looper.prepareMainLooper();
        handler = new Handler(Looper.getMainLooper());
        try { Class.forName("com.bashkitten.DisplayPublisher").getMethod("initialize").invoke(null); }
        catch (Exception error) { throw new IllegalStateException("Could not initialize Termux Display authorization", error); }
        String resource = "lib/" + Build.SUPPORTED_ABIS[0] + "/libXlorie.so";
        URL library = CmdEntryPoint.class.getClassLoader().getResource(resource);
        if (library == null) throw new IllegalStateException("Install BashKitten for this Android architecture");
        System.load(library.getFile().replace("file:", ""));
        CmdEntryPoint server = new CmdEntryPoint();
        if (!server.start(args)) System.exit(1);
        Looper.loop();
    }
    private final IDisplaySource.Stub source = new IDisplaySource.Stub() {
        public void refreshAuthorization() {
            if (Binder.getCallingUid() != browserUid || browserUid < 0)
                throw new SecurityException("Only the paired BashKitten browser can revoke Display");
            handler.post(() -> { authorizationGeneration++; endpoint = null; sendBroadcast(); });
        }
        public void connect(IDisplayConnection callback) {
            if (Binder.getCallingUid() != browserUid || browserUid < 0)
                throw new SecurityException("Only the paired BashKitten browser can attach Display");
            if (callback == null) throw new IllegalArgumentException("Display callback required");
            gateway.execute(() -> {
                try (ParcelFileDescriptor connection = getXConnection()) {
                    callback.result(connection, "");
                } catch (Exception error) {
                    try { callback.result(null, "Native display connection failed: " + error.getMessage()); }
                    catch (RemoteException ignored) {}
                }
            });
        }
    };
    // Names are kept for the donor JNI methods. They no longer send broadcasts.
    @Keep private void setDocumentTag(String tag) {}
    @Keep private void sendBroadcastDelayed() { sendBroadcast(); }
    @Keep private void sendBroadcast() {
        handler.post(() -> {
            if (publishing || (endpoint != null && endpoint.isBinderAlive())) return;
            publishing = true;
            long attempt = authorizationGeneration;
            gateway.execute(() -> {
                try {
                    Class<?> publisher = Class.forName("com.bashkitten.DisplayPublisher");
                    browserUid = (Integer) publisher.getMethod("ownerUid").invoke(null);
                    IBinder registered = (IBinder) publisher.getMethod("publish", String.class, IDisplaySource.class)
                        .invoke(null, DisplayProtocol.VERSION, source);
                    registered.linkToDeath(() -> handler.post(() -> { endpoint = null; sendBroadcast(); }), 0);
                    handler.post(() -> {
                        publishing = false;
                        if (attempt != authorizationGeneration) { endpoint = null; sendBroadcast(); return; }
                        endpoint = registered; retry = 1000;
                        if (!registered.isBinderAlive()) { endpoint = null; sendBroadcast(); }
                    });
                } catch (Exception error) {
                    handler.post(() -> {
                        publishing = false;
                        Throwable cause = error.getCause() == null ? error : error.getCause();
                        System.err.println("BashKitten Display: " + cause.getMessage());
                        handler.postDelayed(this::sendBroadcast, retry);
                        retry = Math.min(10000, retry * 2);
                    });
                }
            });
        });
    }
    public native boolean start(String[] args);
    public native ParcelFileDescriptor getXConnection();
    public native ParcelFileDescriptor getLogcatOutput();
    public native void reportFatalError(String message);
    @CriticalNative private static native boolean connected();
}
