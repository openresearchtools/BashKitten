// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.os.*;
import com.bashkitten.api.IDisplaySource;

/** Runs under Termux's UID, using the existing verified native Binder discovery. */
public final class DisplayPublisher {
    public static void initialize() throws Exception { BrowserCommand.initializeDisplay(); }
    public static int ownerUid() throws Exception { return BrowserCommand.browserUid(); }
    public static IBinder publish(String version, IDisplaySource source) throws Exception {
        IBinder endpoint = BrowserCommand.displayEndpoint();
        Parcel request = Parcel.obtain(), response = Parcel.obtain();
        try {
            request.writeInterfaceToken(AppCommandGateway.DESCRIPTOR);
            request.writeString(version); request.writeStrongBinder(source.asBinder());
            if (!endpoint.transact(AppCommandGateway.DISPLAY_REGISTER, request, response, 0))
                throw new IllegalStateException("Update BashKitten: embedded Display is unavailable");
            response.readException(); return endpoint;
        } finally { request.recycle(); response.recycle(); }
    }
}
