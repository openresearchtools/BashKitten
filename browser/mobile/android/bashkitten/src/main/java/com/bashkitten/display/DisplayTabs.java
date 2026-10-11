// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.display;

import android.app.Activity;
import android.widget.Toast;
import com.bashkitten.BrowserApp;
import org.json.JSONObject;

/** The only public native entry point; web content cannot manufacture a Display tab. */
public final class DisplayTabs {
    public static final String CONTEXT = "bashkitten-display-local";
    private DisplayTabs() {}
    public static void open(Activity activity, String environmentId) {
        if (!"local".equals(environmentId)) throw new IllegalArgumentException("Android Display is local Termux only");
        BrowserApp app = BrowserApp.get(activity);
        if (!app.agent.localIsOnRequested()) {
            Toast.makeText(activity, "Turn on Local before opening Display.", Toast.LENGTH_LONG).show(); return;
        }
        app.host.openDisplay(environmentId);
        // Always address the local native controller, even when a remote Agent is selected.
        try {
            app.agent.termux.run(new JSONObject().put("command", "display-start"), result -> {},
                error -> Toast.makeText(activity, error, Toast.LENGTH_LONG).show());
        } catch (Exception error) { Toast.makeText(activity, error.getMessage(), Toast.LENGTH_LONG).show(); }
    }
}
