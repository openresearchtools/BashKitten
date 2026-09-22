// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.*;
import java.util.ArrayList;

public final class TabOptionsActivity extends ProductActivity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        setTitle("BashKitten · this tab");
        BrowserApp app = BrowserApp.get(this);
        BrowserApp.Tab tab = app.host.selected();
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(24, 60, 24, 24);
        if (tab != null) {
            Switch desktop = new Switch(this); desktop.setText("Desktop site"); desktop.setChecked(tab.desktop);
            desktop.setOnCheckedChangeListener((b, enabled) -> app.host.desktop(tab.id, enabled)); root.addView(desktop);
            Switch blocker = new Switch(this); blocker.setText("Adblocking for this tab"); blocker.setChecked(tab.adblock);
            blocker.setOnCheckedChangeListener((b, enabled) -> app.setAdblock(tab, enabled, ignored -> {}, app::message)); root.addView(blocker);
            if (tab.tor) {
                TextView route = new TextView(this); route.setText("Connected through Tor"); root.addView(route);
            }
        }
        add(root, "Private Tor sites", () -> startActivity(new Intent(this, OnionActivity.class)));
        add(root, "Revoke agent access", () -> {
            app.grants.revokeAll();
            app.commands.revokeAll();
            app.refresh();
            for (BrowserApp.Tab owned : new ArrayList<>(app.tabs.values())) if (!owned.owner.equals(BrowserApp.USER)) app.close(owned);
            app.message("Agent access revoked");
        });
        add(root, "Licenses and source", () -> startActivity(new Intent(this, LicensesActivity.class)));
        showContent(root, true);
    }
    private void add(LinearLayout root, String label, Runnable action) { Button b = new Button(this); b.setText(label); b.setOnClickListener(v -> action.run()); root.addView(b); }
}
