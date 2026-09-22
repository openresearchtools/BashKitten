// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten.api;
import android.app.PendingIntent;
import com.bashkitten.api.IAgentCallback;
interface IAgentBrowser {
    PendingIntent requestAccess();
    PendingIntent showTab(String tabId);
    void execute(String requestJson, IAgentCallback callback);
}
