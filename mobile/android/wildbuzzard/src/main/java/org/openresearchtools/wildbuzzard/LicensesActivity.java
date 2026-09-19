// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.text.method.LinkMovementMethod;
import android.text.util.Linkify;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

public final class LicensesActivity extends Activity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(20, 55, 20, 20);
        Button mozilla = new Button(this); mozilla.setText("Mozilla and Gecko license notices");
        mozilla.setOnClickListener(v -> {
            BrowserApp app = BrowserApp.get(this);
            app.create(BrowserApp.USER, false, "about:blank", tab -> { app.show(tab); tab.session.loadUri("about:license"); finish(); }, app::message);
        }); root.addView(mozilla);
        Button dependencies = new Button(this); dependencies.setText("Android library licenses");
        dependencies.setOnClickListener(v -> dependencyLicenses()); root.addView(dependencies);
        ScrollView scroll = new ScrollView(this); TextView text = new TextView(this); text.setTextSize(13); text.setTextIsSelectable(true);
        try (InputStream input = getAssets().open("THIRD-PARTY-NOTICES.txt"); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n; while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
            text.setText(new String(output.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception error) { text.setText("Notices unavailable: this build is incomplete."); }
        Linkify.addLinks(text, Linkify.WEB_URLS); text.setMovementMethod(LinkMovementMethod.getInstance());
        scroll.addView(text); root.addView(scroll); setContentView(root);
    }
    private byte[] resource(int id) throws IOException {
        try (InputStream input = getResources().openRawResource(id); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n; while ((n = input.read(buffer)) != -1) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }
    private void dependencyLicenses() {
        try {
            String[] entries = new String(resource(getResources().getIdentifier("third_party_license_metadata", "raw", getPackageName())), StandardCharsets.UTF_8).trim().split("\\n");
            byte[] licenses = resource(getResources().getIdentifier("third_party_licenses", "raw", getPackageName()));
            String[] names = new String[entries.length];
            for (int i = 0; i < names.length; i++) names[i] = entries[i].substring(entries[i].indexOf(' ') + 1);
            new AlertDialog.Builder(this).setTitle("Android library licenses").setItems(names, (d, i) -> {
                String[] range = entries[i].substring(0, entries[i].indexOf(' ')).split(":");
                int start = Integer.parseInt(range[0]), length = Integer.parseInt(range[1]);
                TextView text = new TextView(this); text.setPadding(18, 18, 18, 18); text.setTextIsSelectable(true);
                text.setText(new String(licenses, start, length, StandardCharsets.UTF_8));
                ScrollView scroll = new ScrollView(this); scroll.addView(text);
                new AlertDialog.Builder(this).setTitle(names[i]).setView(scroll).setPositiveButton("Close", null).show();
            }).show();
        } catch (Exception error) { new AlertDialog.Builder(this).setMessage("Dependency notices unavailable").setPositiveButton("Close", null).show(); }
    }
}
