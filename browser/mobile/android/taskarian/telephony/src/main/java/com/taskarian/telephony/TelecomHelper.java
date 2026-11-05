/* GPL-3.0. Adapted 2026-10-11 from Phony v2.6 TelecomHelper.kt; see ../NOTICE. */
package com.taskarian.telephony;

import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.telecom.*;

/** Account operations run on the phone owner, never on an Activity or binder thread. */
final class TelecomHelper {
    static final String ACCOUNT = "taskarian-agent-line";
    final Context context;
    final TelecomManager telecom;
    TelecomHelper(Context context) { this.context = context; telecom = context.getSystemService(TelecomManager.class); }
    PhoneAccountHandle account() { return new PhoneAccountHandle(new ComponentName(context, KittenConnectionService.class), ACCOUNT); }
    void requireAvailable() {
        if (telecom == null || !context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELECOM))
            throw new IllegalStateException("This device does not offer Android calling services.");
    }
    void register() {
        requireAvailable();
        telecom.registerPhoneAccount(PhoneAccount.builder(account(), "Taskarian")
            .setCapabilities(PhoneAccount.CAPABILITY_CALL_PROVIDER).addSupportedUriScheme(PhoneAccount.SCHEME_SIP).build());
    }
    boolean enabled() {
        requireAvailable();
        if (Build.VERSION.SDK_INT < 35) throw new IllegalStateException("Taskarian calling requires Android 15 or newer.");
        return telecom.getRegisteredPhoneAccounts().stream().anyMatch(p -> account().equals(p.getAccountHandle()) && p.isEnabled());
    }
    void unregister() { if (telecom != null) telecom.unregisterPhoneAccount(account()); }
    void call(Uri address) {
        if (!enabled()) throw new IllegalStateException("Enable the Taskarian calling account in Android settings.");
        Bundle extras = new Bundle(); extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, account());
        telecom.placeCall(address, extras);
    }
    void incoming(Uri address, String eventId) {
        if (!enabled()) throw new IllegalStateException("The Taskarian calling account is unavailable.");
        Bundle details = new Bundle(); details.putString("eventId", eventId);
        Bundle extras = new Bundle(); extras.putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, address);
        extras.putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, details);
        telecom.addNewIncomingCall(account(), extras);
    }
}
