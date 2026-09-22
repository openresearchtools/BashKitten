// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

public final class ActivateTabActivity extends Activity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        BrowserApp app = BrowserApp.get(this);
        try {
            String owner = app.grants.require(getIntent().getIntExtra("uid", -1));
            if (!owner.equals(getIntent().getStringExtra("owner"))) throw new SecurityException();
            app.show(app.owned(getIntent().getStringExtra("tab"), owner));
        } catch (Exception ignored) {}
        finish();
    }
}
