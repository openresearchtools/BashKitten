// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.os.Bundle;

/** Intent extras contain one-use tickets, never browser-control credentials. */
public final class CommandAccessActivity extends ProductActivity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        BrowserApp app = BrowserApp.get(this);
        try {
            String appGrant = getIntent().getStringExtra("appGrant");
            if (appGrant != null) {
                startActivity(new android.content.Intent(this, GrantActivity.class)
                    .setData(android.net.Uri.parse("bashkitten-grant:" + appGrant)));
            } else {
                String launch = getIntent().getStringExtra("launch");
                if (launch != null) app.commands.show(launch);
            }
        } catch (Exception ignored) { }
        finish();
    }
}
