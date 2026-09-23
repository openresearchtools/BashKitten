// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.os.*;
import org.json.JSONObject;
import java.util.function.Consumer;

/** Binder supplies the terminal's actual Android UID on every command. */
final class AppCommandGateway extends Binder {
    static final String DESCRIPTOR = "com.bashkitten.AppCommand";
    static final String CALLBACK = DESCRIPTOR + ".Callback";
    static final int CONNECT = IBinder.FIRST_CALL_TRANSACTION;
    static final int RESULT = CONNECT + 1;
    private final BrowserApp app;
    AppCommandGateway(BrowserApp app) { this.app = app; }
    private android.app.PendingIntent launchIntent(String response) {
        try {
            JSONObject result = new JSONObject(response).optJSONObject("result");
            String field = result != null && result.has("appGrant") ? "appGrant" : "launch";
            if (result == null || !result.has(field)) return null;
            android.content.Intent intent = new android.content.Intent(app, CommandAccessActivity.class)
                .setData(android.net.Uri.parse("bashkitten-launch:" + java.util.UUID.randomUUID()))
                .putExtra(field, result.getString(field));
            android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
            if (Build.VERSION.SDK_INT >= 35) options.setPendingIntentCreatorBackgroundActivityStartMode(
                Build.VERSION.SDK_INT >= 36 ? android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE
                    : android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
            return android.app.PendingIntent.getActivity(app, 0, intent,
                android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_ONE_SHOT, options.toBundle());
        } catch (Exception error) { return null; }
    }
    @Override protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
        if (code != CONNECT) return super.onTransact(code, data, reply, flags);
        data.enforceInterface(DESCRIPTOR);
        int uid = Binder.getCallingUid();
        String json = data.readString();
        IBinder callback = data.readStrongBinder();
        if (callback == null) return true;
        Consumer<String> result = value -> {
            try { sendResult(callback, value); }
            catch (RemoteException error) {
                try { sendResult(callback, "{\"error\":\"Android Binder could not deliver the browser result: " + error.getClass().getSimpleName() + "\",\"code\":\"transport_error\"}"); }
                catch (RemoteException unavailable) { android.util.Log.w("BashKitten", "Browser callback is unavailable"); }
            }
        };
        dispatch(uid, json, result);
        return true;
    }
    private void sendResult(IBinder callback, String value) throws RemoteException {
        Parcel out = Parcel.obtain();
        try {
            out.writeInterfaceToken(CALLBACK); out.writeString(value);
            out.writeTypedObject(launchIntent(value), 0);
            if (!callback.transact(RESULT, out, null, IBinder.FLAG_ONEWAY))
                throw new RemoteException("Browser callback rejected the result");
        } finally { out.recycle(); }
    }
    void dispatch(int uid, String json, Consumer<String> result) {
        try {
            if (json == null) throw new IllegalArgumentException("Request required");
            JSONObject request = new JSONObject(json);
            if (request.has("session")) throw new IllegalArgumentException("Use explicit tabId values");
            String method = request.optString("method");
            if (method.equals("app.authorization")) {
                result.accept(new JSONObject().put("result", new JSONObject()
                    .put("status", app.grants.status(uid, request.getString("ticket")))).toString());
                return;
            }
            if (!app.grants.allowed(uid)) {
                if (!method.equals("app.authorize") && app.grants.denied(uid)) {
                    result.accept("{\"error\":\"Browser access denied; change this app in Agent access\",\"code\":\"authorization_denied\"}");
                } else {
                    result.accept(new JSONObject().put("result", new JSONObject()
                        .put("appGrant", app.grants.ticket(uid))).toString());
                }
                return;
            }
            if (method.equals("app.authorize")) { result.accept("{\"result\":\"authorized\"}"); return; }
            AgentController.Access access = app.controller.forUid(uid, true);
            if (method.equals("app.prepare")) {
                app.main.post(() -> {
                    try {
                        access.check.run();
                        if (!BrowserKeepAliveService.active) app.keepAlive();
                        long deadline = SystemClock.elapsedRealtime() + 5000;
                        Runnable started = new Runnable() {
                            @Override public void run() {
                                try { access.check.run(); }
                                catch (SecurityException error) { result.accept("{\"error\":\"Browser access revoked\",\"code\":\"authorization_revoked\"}"); return; }
                                if (BrowserKeepAliveService.active) result.accept("{\"result\":{\"foregroundRequired\":false}}");
                                else if (SystemClock.elapsedRealtime() >= deadline) result.accept("{\"error\":\"Browser foreground service did not start\"}");
                                else app.main.postDelayed(this, 25);
                            }
                        };
                        started.run();
                    } catch (SecurityException error) { result.accept("{\"error\":\"Browser access revoked\",\"code\":\"authorization_revoked\"}"); }
                    catch (IllegalStateException error) { result.accept("{\"result\":{\"foregroundRequired\":true}}"); }
                });
            } else app.controller.execute(access, json, result);
        } catch (SecurityException error) {
            result.accept("{\"error\":\"Browser access revoked or caller identity changed\",\"code\":\"authorization_revoked\"}");
        } catch (Exception error) { result.accept("{\"error\":\"Invalid app command\"}"); }
    }
}
