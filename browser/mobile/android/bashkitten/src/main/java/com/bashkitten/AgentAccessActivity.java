// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.widget.*;
import androidx.appcompat.app.AlertDialog;
import java.util.*;

public final class AgentAccessActivity extends ProductActivity {
    private BrowserApp app;
    private int generation;
    private static final class Entry {
        final ApplicationInfo info;
        final String label;
        final boolean allowed, same;
        Entry(ApplicationInfo info, String label, boolean allowed, boolean same) {
            this.info = info; this.label = label; this.allowed = allowed; this.same = same;
        }
    }
    @Override public void onCreate(Bundle state) { super.onCreate(state); app = BrowserApp.get(this); setTitle("Agent access"); render(); }
    private void render() {
        final int version = ++generation;
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        TextView description = new TextView(this);
        description.setText("Allowed apps can control ordinary browsing tabs. Agent, setup and login views stay private. Terminal programs share their terminal app's permission."); root.addView(description);
        CheckBox publisher = new CheckBox(this); publisher.setText("Automatically allow apps signed by this publisher");
        publisher.setChecked(app.grants.publisherTrusted()); root.addView(publisher);
        publisher.setOnCheckedChangeListener((button, enabled) -> { app.grants.publisherTrusted(enabled); if (!enabled) app.closeUnapprovedTabs(); render(); });
        TextView status = new TextView(this); status.setText("Loading installed apps…"); root.addView(status);
        showContent(root, true);
        new Thread(() -> {
            List<Entry> entries = new ArrayList<>();
            try {
                HashSet<Integer> seen = new HashSet<>();
                for (ApplicationInfo info : getPackageManager().getInstalledApplications(0)) {
                    if (info.uid == android.os.Process.myUid() || !seen.add(info.uid)) continue;
                    if ((info.flags & ApplicationInfo.FLAG_SYSTEM) != 0 && getPackageManager().getLaunchIntentForPackage(info.packageName) == null) continue;
                    entries.add(new Entry(info, getPackageManager().getApplicationLabel(info).toString(), app.grants.allowed(info.uid), app.grants.samePublisher(info.uid)));
                }
                entries.sort(Comparator.comparing(entry -> entry.label, String.CASE_INSENSITIVE_ORDER));
                app.main.post(() -> {
                    if (isFinishing() || isDestroyed() || generation != version) return;
                    root.removeView(status); showApps(root, entries);
                });
            } catch (Exception error) {
                app.main.post(() -> { if (!isFinishing() && !isDestroyed() && generation == version) status.setText("Installed apps could not be read. Reopen Agent access to retry."); });
            }
        }, "agent-app-list").start();
    }
    private void showApps(LinearLayout root, List<Entry> entries) {
        for (Entry entry : entries) {
            ApplicationInfo info = entry.info;
            boolean allowed = entry.allowed, same = entry.same;
            Button row = new Button(this); row.setAllCaps(false);
            row.setText(entry.label + "\n" + info.packageName + "\n" + (allowed ? "Allowed" : "Not allowed") + (same ? " · Same publisher" : ""));
            row.setContentDescription("Agent access " + info.packageName); root.addView(row);
            row.setOnClickListener(view -> {
                String fingerprint = app.grants.identity(info.uid);
                new AlertDialog.Builder(this).setTitle(allowed ? "Revoke app access?" : "Allow browser control?")
                    .setMessage(info.packageName + "\n\n" + (allowed ? "This stops its browser control and invalidates its file transfers." : "This app can read and act in ordinary browsing tabs, including signed-in pages. Approval applies to its installed signing identity.") + "\n\n" + fingerprint)
                    .setNegativeButton("Cancel", null).setPositiveButton(allowed ? "Revoke" : "Allow", (dialog, which) -> {
                        app.grants.setAllowed(info.uid, !allowed);
                        if (allowed) app.closeUnapprovedTabs(); else app.keepAlive();
                        render();
                    }).show();
            });
        }
    }
}
