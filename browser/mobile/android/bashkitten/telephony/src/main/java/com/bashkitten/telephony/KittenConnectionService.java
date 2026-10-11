/* GPL-3.0. Adapted 2026-10-11 from Phony v2.6 FakeCallConnectionService.kt; see NOTICE. */
package com.bashkitten.telephony;

import android.telecom.*;

/** Android alone binds this service. Even a cold Contacts bind passes saved policy. */
public final class KittenConnectionService extends ConnectionService {
    @Override public Connection onCreateIncomingConnection(PhoneAccountHandle manager, ConnectionRequest request) {
        return TelephonyRuntime.get(this).connection(request, true);
    }
    @Override public Connection onCreateOutgoingConnection(PhoneAccountHandle manager, ConnectionRequest request) {
        return TelephonyRuntime.get(this).connection(request, false);
    }
    @Override public void onCreateIncomingConnectionFailed(PhoneAccountHandle manager, ConnectionRequest request) {
        TelephonyRuntime.get(this).incomingFailed(request);
    }
}
