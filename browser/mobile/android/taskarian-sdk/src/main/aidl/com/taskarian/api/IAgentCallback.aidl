// SPDX-License-Identifier: AGPL-3.0-or-later
package com.taskarian.api;
import android.app.PendingIntent;
oneway interface IAgentCallback {
    void onResult(String responseJson);
    void onApprovalRequired(in PendingIntent approval);
}
