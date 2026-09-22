// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard.api;
import android.app.PendingIntent;
import org.openresearchtools.wildbuzzard.api.IAgentCallback;
interface IAgentBrowser {
    PendingIntent requestAccess();
    PendingIntent showTab(String tabId);
    void execute(String requestJson, IAgentCallback callback);
}
