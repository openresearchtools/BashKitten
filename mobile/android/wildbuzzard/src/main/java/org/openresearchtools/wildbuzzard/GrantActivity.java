// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.app.Activity;
import androidx.appcompat.app.AlertDialog;
import android.os.Bundle;

public final class GrantActivity extends ProductActivity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            BrowserApp app = BrowserApp.get(this);
            AppGrants.Request request = app.grants.consume(getIntent().getData().getSchemeSpecificPart());
            String name = getPackageManager().getNameForUid(request.uid);
            new AlertDialog.Builder(this).setTitle("Allow browser control?")
                    .setMessage(name + " can create and control its own tabs, read their pages, and act using saved logins and imported onion credentials in those tabs. You can revoke access from Wild Buzzard's menu.")
                    .setNegativeButton("Cancel", (d, w) -> finish())
                    .setPositiveButton("Allow", (d, w) -> { app.grants.approve(request);
                    app.keepAlive(); finish(); })
                    .setOnCancelListener(d -> finish()).show();
        } catch (Exception error) { finish(); }
    }
}
