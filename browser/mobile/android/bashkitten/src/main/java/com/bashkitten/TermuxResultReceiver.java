// SPDX-License-Identifier: GPL-3.0-only
package com.bashkitten;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Non-exported; only an explicit, one-use PendingIntent accepts a Termux result. */
public final class TermuxResultReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        TermuxConnection.receive(intent);
    }
}
