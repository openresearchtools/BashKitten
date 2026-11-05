// SPDX-License-Identifier: AGPL-3.0-or-later
package com.taskarian.api;
import android.app.PendingIntent;
import com.taskarian.api.IAgentCallback;
import com.taskarian.api.IDisplaySource;
interface IAgentBrowser {
    PendingIntent requestAccess();
    PendingIntent showTab(String tabId);
    void execute(String requestJson, IAgentCallback callback);
    void registerDisplay(String version, IDisplaySource source);
}
