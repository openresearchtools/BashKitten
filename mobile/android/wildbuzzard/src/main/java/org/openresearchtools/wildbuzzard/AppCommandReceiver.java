// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.content.*;
import android.os.*;

/** Discovery only: the returned Binder checks the actual calling UID on every request. */
public final class AppCommandReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        Bundle extras = intent.getExtras();
        IBinder callback = extras == null ? null : extras.getBinder("callback");
        if (callback == null) return;
        Parcel data = Parcel.obtain();
        try {
            data.writeInterfaceToken(AppCommandGateway.CALLBACK);
            data.writeStrongBinder(BrowserApp.get(context).appCommands);
            callback.transact(AppCommandGateway.CONNECT, data, null, IBinder.FLAG_ONEWAY);
        } catch (RemoteException ignored) { /* The requesting process may have exited. */ }
        finally { data.recycle(); }
    }
}
