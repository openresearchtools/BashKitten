// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.os.Bundle;
import androidx.appcompat.app.AlertDialog;

/** Explicit user consent for a command key; intent extras never authorize themselves. */
public final class CommandAccessActivity extends ProductActivity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        BrowserApp app = BrowserApp.get(this);
        try {
            String launch = getIntent().getStringExtra("launch");
            if (launch != null) { app.commands.show(launch); finish(); return; }
            String key = getIntent().getStringExtra("key");
            String fingerprint = CommandProtocol.id(CommandProtocol.key(key)).substring(0, 12);
            new AlertDialog.Builder(this).setTitle("Allow command-line browser control?")
                .setMessage("Key " + fingerprint + "\n\nOnly approve if this matches the command you started. Programs with this key can create and control their own tabs, read pages, and act using saved logins and imported onion credentials. They cannot control other apps' tabs. Revoke access from Wild Buzzard's menu.")
                .setNegativeButton("Cancel", (dialog, which) -> finish())
                .setPositiveButton("Allow", (dialog, which) -> {
                    app.keepAlive();
                    app.commands.authorize(key, this::finish, message -> { app.message(message); finish(); });
                }).setOnCancelListener(dialog -> finish()).show();
        } catch (Exception error) { finish(); }
    }
}
