// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.os.*;
import com.bashkitten.api.*;
import com.bashkitten.display.DisplayProtocol;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Only the approved installed Termux UID can publish a native X11 source. */
public final class DisplayBroker {
    private final BrowserApp app;
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private final java.util.List<Pending> waiting = new java.util.ArrayList<>();
    private IDisplaySource source;
    private IBinder.DeathRecipient death;
    private int owner = -1;
    private long generation;
    private static final class Pending {
        final Consumer<ParcelFileDescriptor> ready; final Consumer<String> fail;
        boolean delivered;
        Pending(Consumer<ParcelFileDescriptor> ready, Consumer<String> fail) { this.ready = ready; this.fail = fail; }
    }
    DisplayBroker(BrowserApp app) { this.app = app; }
    private void require(int uid) throws Exception {
        app.grants.require(uid);
        int installed = app.getPackageManager().getApplicationInfo(TermuxConnection.PACKAGE, 0).uid;
        if (uid != installed) throw new SecurityException("Display source must belong to the approved Termux installation");
        if (!app.agent.localIsOnRequested()) throw new SecurityException("Local Agent is Off");
    }
    void register(int uid, String version, IDisplaySource value) throws Exception {
        require(uid);
        if (!DisplayProtocol.VERSION.equals(version)) throw new IllegalArgumentException("Update BashKitten and its Termux packages together: Display versions differ");
        if (value == null) throw new IllegalArgumentException("Display source required");
        work.execute(() -> {
            try {
                require(uid); clearSource(); source = value; owner = uid; long id = ++generation;
                death = () -> work.execute(() -> { if (id == generation) clearSource(); });
                value.asBinder().linkToDeath(death, 0);
                for (Pending pending : new java.util.ArrayList<>(waiting)) connect(pending);
                waiting.clear();
            } catch (Exception error) {
                failWaiting(error.getMessage()); clearSource();
                try { value.refreshAuthorization(); } catch (RemoteException ignored) {}
            }
        });
    }
    public void request(Consumer<ParcelFileDescriptor> ready, Consumer<String> fail) {
        Pending pending = new Pending(ready, fail);
        work.execute(() -> {
            if (source != null) connect(pending);
            else { waiting.add(pending); app.main.postDelayed(() -> work.execute(() -> {
                if (waiting.remove(pending)) failed(pending, "Start Display in Local settings, then reopen it. The paired Termux launcher has not connected.");
            }), 25000); }
        });
    }
    private void connect(Pending pending) {
        long id = generation;
        try {
            require(owner);
            source.connect(new IDisplayConnection.Stub() {
                public void result(ParcelFileDescriptor connection, String error) {
                    int uid = Binder.getCallingUid();
                    work.execute(() -> {
                        try {
                            require(uid);
                            if (id != generation || uid != owner) throw new SecurityException("Display source changed");
                            if (connection == null) throw new IllegalStateException(error == null || error.isEmpty() ? "Display returned no connection" : error);
                            if (pending.delivered) { close(connection); return; }
                            pending.delivered = true; pending.ready.accept(connection);
                        } catch (Exception failure) { close(connection); failed(pending, failure.getMessage()); }
                    });
                }
            });
            app.main.postDelayed(() -> work.execute(() -> failed(pending, "Desktop did not provide its display connection; close and reopen Display.")), 10000);
        } catch (Exception error) { failed(pending, error.getMessage()); }
    }
    private void failed(Pending pending, String error) {
        if (!pending.delivered) { pending.delivered = true; pending.fail.accept(error == null ? "Display disconnected" : error); }
    }
    public void revalidate() {
        work.execute(() -> {
            if (source == null) return;
            try { require(owner); } catch (Exception error) { revoke(); }
        });
    }
    public void revoke() {
        app.main.post(() -> app.host.closeDisplay());
        work.execute(() -> {
            IDisplaySource previous = source;
            clearSource(); failWaiting("Local Display access was revoked");
            // Drop the privileged handoff immediately. A still-running server may
            // request a new handoff only through the normal approval checks.
            if (previous != null) try { previous.refreshAuthorization(); } catch (RemoteException ignored) {}
        });
    }
    private void failWaiting(String error) { for (Pending pending : waiting) failed(pending, error); waiting.clear(); }
    private void clearSource() {
        if (source != null && death != null) source.asBinder().unlinkToDeath(death, 0);
        source = null; death = null; owner = -1; generation++;
    }
    private static void close(ParcelFileDescriptor fd) { if (fd != null) try { fd.close(); } catch (java.io.IOException ignored) {} }
}
