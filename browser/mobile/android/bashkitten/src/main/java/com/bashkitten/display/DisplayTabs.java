// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.display;

import android.app.Activity;
import android.widget.Toast;
import com.bashkitten.BrowserApp;

/** The only public native entry point; web content cannot manufacture a Display tab. */
public final class DisplayTabs {
    public static final String CONTEXT = "bashkitten-display-local";
    private DisplayTabs() {}
    public static void toggle(Activity activity, String environmentId) {
        if (!"local".equals(environmentId)) throw new IllegalArgumentException("Android Display is local Termux only");
        BrowserApp app = BrowserApp.get(activity);
        if (app.host.displayOpen()) app.host.closeDisplay();
        else open(activity, environmentId);
    }
    public static void open(Activity activity, String environmentId) {
        if (!"local".equals(environmentId)) throw new IllegalArgumentException("Android Display is local Termux only");
        BrowserApp app = BrowserApp.get(activity);
        // Always address the local native controller, even when a remote Agent is selected.
        try {
            app.host.openDisplay(environmentId);
            if (!app.display.hasSource() && !app.display.isChanging())
                app.display.setEnabled(true, result -> {}, error -> Toast.makeText(activity, error, Toast.LENGTH_LONG).show());
        } catch (Exception error) { Toast.makeText(activity, error.getMessage(), Toast.LENGTH_LONG).show(); }
    }
}
