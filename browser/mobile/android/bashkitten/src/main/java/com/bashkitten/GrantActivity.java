// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import androidx.appcompat.app.AlertDialog;
import android.os.Bundle;

public final class GrantActivity extends ProductActivity {
    private BrowserApp app;
    private AppGrants.Request request;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            app = BrowserApp.get(this);
            request = app.grants.consume(getIntent().getData().getSchemeSpecificPart(), state != null);
            if (app.grants.allowed(request.uid)) { app.grants.approve(request); app.keepAlive(); finish(); return; }
            String name = getPackageManager().getNameForUid(request.uid);
            new AlertDialog.Builder(this).setTitle("Allow browser control?")
                .setMessage(name + " can read and control browsing tabs, including signed-in pages. Agent, setup and login views remain protected. Programs inside Termux share Termux's app permission. You can revoke access in Agent access.")
                .setNegativeButton("Deny", (dialog, which) -> { app.grants.reject(request, true); finish(); })
                .setPositiveButton("Allow", (dialog, which) -> {
                    try { app.grants.approve(request); app.keepAlive(); }
                    catch (Exception error) { app.message("Browser approval expired; try the command again"); }
                    finish();
                })
                .setOnCancelListener(dialog -> { app.grants.reject(request, false); finish(); }).show();
        } catch (Exception error) { finish(); }
    }
    @Override protected void onDestroy() {
        if (isFinishing() && app != null && request != null) app.grants.reject(request, false);
        super.onDestroy();
    }
}
