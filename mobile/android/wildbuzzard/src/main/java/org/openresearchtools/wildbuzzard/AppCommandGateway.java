// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.os.*;
import org.json.JSONObject;
import java.util.function.Consumer;

/** Binder supplies the terminal's actual Android UID on every command. */
final class AppCommandGateway extends Binder {
    static final String DESCRIPTOR = "org.openresearchtools.wildbuzzard.AppCommand";
    static final String CALLBACK = DESCRIPTOR + ".Callback";
    static final int CONNECT = IBinder.FIRST_CALL_TRANSACTION;
    static final int RESULT = CONNECT + 1;
    private final BrowserApp app;
    AppCommandGateway(BrowserApp app) { this.app = app; }
    @Override protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
        if (code != CONNECT) return super.onTransact(code, data, reply, flags);
        data.enforceInterface(DESCRIPTOR);
        int uid = Binder.getCallingUid();
        String json = data.readString();
        IBinder callback = data.readStrongBinder();
        if (callback == null) return true;
        Consumer<String> result = value -> {
            Parcel out = Parcel.obtain();
            try {
                out.writeInterfaceToken(CALLBACK); out.writeString(value);
                callback.transact(RESULT, out, null, IBinder.FLAG_ONEWAY);
            } catch (RemoteException ignored) { /* The caller can exit before a page operation finishes. */ }
            finally { out.recycle(); }
        };
        try {
            if (json == null || json.length() > 200000) throw new IllegalArgumentException("Request too large");
            JSONObject request = new JSONObject(json);
            String method = request.optString("method");
            if (method.equals("app.authorize")) {
                try { app.grants.require(uid); result.accept("{\"result\":\"authorized\"}"); }
                catch (SecurityException error) {
                    result.accept(new JSONObject().put("result", new JSONObject().put("appGrant", app.grants.ticket(uid))).toString());
                }
            } else {
                AgentController.Access access = app.controller.forUid(uid, request.optString("session"), true);
                if (method.equals("app.prepare")) {
                    app.main.post(() -> {
                        try {
                            access.check.run();
                            if (!BrowserKeepAliveService.active) app.keepAlive();
                            long deadline = SystemClock.elapsedRealtime() + 5000;
                            Runnable started = new Runnable() {
                                @Override public void run() {
                                    if (BrowserKeepAliveService.active) result.accept("{\"result\":{\"foregroundRequired\":false}}");
                                    else if (SystemClock.elapsedRealtime() >= deadline) result.accept("{\"error\":\"Browser foreground service did not start\"}");
                                    else app.main.postDelayed(this, 25);
                                }
                            };
                            started.run();
                        } catch (SecurityException error) { result.accept("{\"error\":\"App authorization required\"}"); }
                        catch (IllegalStateException error) { result.accept("{\"result\":{\"foregroundRequired\":true}}"); }
                    });
                } else app.controller.execute(access, json, result);
            }
        } catch (SecurityException error) {
            result.accept("{\"error\":\"App authorization required; run --authorize or allow this app in Settings > Agent access\"}");
        } catch (Exception error) { result.accept("{\"error\":\"Invalid app command\"}"); }
        return true;
    }
}
