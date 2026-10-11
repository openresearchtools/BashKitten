// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.app.RemoteInput;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;

/** An explicit unexported component; only our event-specific PendingIntents enter. */
public final class PhoneReplyReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent) {
        Uri uri = intent.getData();
        if (uri == null || !"bashkitten-phone".equals(uri.getScheme()) || uri.getPathSegments().size() != 1) return;
        String action = intent.getAction();
        if (action == null || !action.equals(uri.getAuthority()) || !(action.equals("read") || action.equals("reply"))) return;
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence text = results == null ? null : results.getCharSequence(PhoneNotifications.INPUT);
        PendingResult pending = goAsync(); TelephonyRuntime owner = TelephonyRuntime.get(context);
        java.util.concurrent.atomic.AtomicBoolean finished = new java.util.concurrent.atomic.AtomicBoolean();
        Runnable finish = () -> { if (finished.compareAndSet(false,true)) pending.finish(); };
        // prepare() transfers the request to the existing foreground native owner.
        // The receiver deadline must never wait for a slow Tor request.
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(finish,8000);
        owner.reply(uri.getLastPathSegment(),text == null ? "" : text.toString(),action.equals("read")).whenComplete((result,error) -> finish.run());
    }
}
