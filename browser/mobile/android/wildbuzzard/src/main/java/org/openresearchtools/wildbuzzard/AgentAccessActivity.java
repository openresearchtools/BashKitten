// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.widget.*;
import androidx.appcompat.app.AlertDialog;
import java.util.*;

public final class AgentAccessActivity extends ProductActivity {
    private BrowserApp app;
    @Override public void onCreate(Bundle state) { super.onCreate(state); app = BrowserApp.get(this); setTitle("Agent access"); render(); }
    private void render() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        TextView description = new TextView(this);
        description.setText("Allowed apps can browse and control their own tabs. Terminal programs inherit their terminal app's identity. Access lasts until revoked."); root.addView(description);
        CheckBox publisher = new CheckBox(this); publisher.setText("Automatically allow apps signed by this publisher");
        publisher.setChecked(app.grants.publisherTrusted()); root.addView(publisher);
        publisher.setOnCheckedChangeListener((button, enabled) -> { app.grants.publisherTrusted(enabled); if (!enabled) app.closeUnapprovedTabs(); render(); });
        ArrayList<ApplicationInfo> apps = new ArrayList<>(getPackageManager().getInstalledApplications(0));
        apps.sort(Comparator.comparing(info -> getPackageManager().getApplicationLabel(info).toString(), String.CASE_INSENSITIVE_ORDER));
        HashSet<Integer> seen = new HashSet<>();
        for (ApplicationInfo info : apps) {
            if (info.uid == android.os.Process.myUid() || !seen.add(info.uid)) continue;
            if ((info.flags & ApplicationInfo.FLAG_SYSTEM) != 0 && getPackageManager().getLaunchIntentForPackage(info.packageName) == null) continue;
            boolean allowed = app.grants.allowed(info.uid), same = app.grants.samePublisher(info.uid);
            Button row = new Button(this); row.setAllCaps(false);
            row.setText(getPackageManager().getApplicationLabel(info) + "\n" + info.packageName + "\n" + (allowed ? "Allowed" : "Not allowed") + (same ? " · Same publisher" : ""));
            row.setContentDescription("Agent access " + info.packageName); root.addView(row);
            row.setOnClickListener(view -> {
                String fingerprint = app.grants.identity(info.uid);
                new AlertDialog.Builder(this).setTitle(allowed ? "Revoke app access?" : "Allow browser control?")
                    .setMessage(info.packageName + "\n\n" + (allowed ? "This closes its agent tabs and invalidates its file transfers." : "This app can read and act in its own tabs, including signed-in pages. Approval applies to its installed signing identity.") + "\n\n" + fingerprint)
                    .setNegativeButton("Cancel", null).setPositiveButton(allowed ? "Revoke" : "Allow", (dialog, which) -> {
                        app.grants.setAllowed(info.uid, !allowed);
                        if (allowed) app.closeUnapprovedTabs(); else app.keepAlive();
                        render();
                    }).show();
            });
        }
        showContent(root, true);
    }
}
