// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import android.content.Intent;
import androidx.fragment.app.FragmentActivity;
import com.bashkitten.phone.PhoneControlsPanel;
import com.bashkitten.telephony.PhonePanel;

/** Narrow action seam for the browser's own menu; no page or extension entry. */
public final class AgentControls {
    private AgentControls() {}
    public enum Control { LOCAL_AI, NOTIFICATIONS, PHONE_USE, REMOTES, TELEPHONE, PERFORMANCE }

    public static void open(Activity activity, Control control) {
        switch (control) {
            case LOCAL_AI:
                if (!BrowserApp.get(activity).agent.selected.equals("local")) return;
                new AgentLocalAIDialog().show(((FragmentActivity) activity).getSupportFragmentManager(), "agent-localai");
                break;
            case NOTIFICATIONS:
                PhonePanel.showMessages(activity, PhoneControlsPanel.settingsContext(activity));
                break;
            case PHONE_USE:
                PhoneControlsPanel.show(activity);
                break;
            case REMOTES:
                activity.startActivity(new Intent(activity, AgentRemotesActivity.class).putExtra("connectOnly", true));
                break;
            case TELEPHONE:
                PhonePanel.showCalls(activity, PhoneControlsPanel.settingsContext(activity));
                break;
            case PERFORMANCE:
                new AgentPerformanceDialog().show(((FragmentActivity) activity).getSupportFragmentManager(), "agent-performance");
                break;
        }
    }
}
