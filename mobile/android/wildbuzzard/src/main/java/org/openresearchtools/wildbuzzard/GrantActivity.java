// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;

public final class GrantActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            BrowserApp app = BrowserApp.get(this);
            AppGrants.Request request = app.grants.consume(getIntent().getData().getSchemeSpecificPart());
            String name = getPackageManager().getNameForUid(request.uid);
            new AlertDialog.Builder(this).setTitle("Allow browser control?")
                    .setMessage(name + " can create and control its own tabs, read their pages, and act using the logins in those tabs. You can revoke access from WildBuzzard's menu.")
                    .setNegativeButton("Cancel", (d, w) -> finish())
                    .setPositiveButton("Allow", (d, w) -> { app.grants.approve(request);
                    startForegroundService(new android.content.Intent(this, BrowserControlService.class)); finish(); })
                    .setOnCancelListener(d -> finish()).show();
        } catch (Exception error) { finish(); }
    }
}
