// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.app.*;
import android.content.*;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowManager;
import android.widget.*;
import androidx.appcompat.app.AlertDialog;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import java.io.*;
import java.nio.charset.StandardCharsets;

public final class OnionActivity extends ProductActivity {
    EditText address, secret;
    TextView status;
    LinearLayout manual, imported;
    BrowserApp app;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); app = BrowserApp.get(this);
        setTitle("Private Tor sites");
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(24, 60, 24, 24);
        TextView description = new TextView(this); description.setText("Onion addresses open through Tor automatically. To add a private site, scan its credential QR or choose its .auth_private file. Both include the address and key."); root.addView(description);
        add(root, "Scan QR code", () -> new IntentIntegrator(this).setCaptureActivity(OnionCaptureActivity.class)
            .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("Scan the private onion key QR")
            .setBeepEnabled(false).setOrientationLocked(false).initiateScan());
        add(root, "Choose .auth_private file", () -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE), 20));
        add(root, "Enter manually", () -> manual.setVisibility(manual.getVisibility() == android.view.View.VISIBLE ? android.view.View.GONE : android.view.View.VISIBLE));
        manual = new LinearLayout(this); manual.setOrientation(LinearLayout.VERTICAL); manual.setVisibility(android.view.View.GONE); root.addView(manual);
        address = new EditText(this); address.setHint("56-character address.onion"); address.setSingleLine();
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI); manual.addView(address);
        secret = new EditText(this); secret.setHint("52-character private key"); secret.setSingleLine();
        secret.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        secret.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO); manual.addView(secret);
        add(manual, "Import key", () -> { try { confirmImport(new OnionKey(address.getText().toString(), secret.getText().toString())); } catch (Exception error) { message(error.getMessage()); } });
        status = new TextView(this); root.addView(status);
        imported = new LinearLayout(this); imported.setOrientation(LinearLayout.VERTICAL); root.addView(imported);
        showContent(root, true);
        refreshImported();
    }
    private void add(LinearLayout root, String text, Runnable action) { Button b = new Button(this); b.setText(text); b.setOnClickListener(v -> action.run()); root.addView(b); }
    private void confirmImport(OnionKey key) {
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(20 * getResources().getDisplayMetrics().density); form.setPadding(padding, 0, padding, 0);
        TextView host = new TextView(this); host.setText(key.host); host.setTextIsSelectable(true); form.addView(host);
        EditText name = new EditText(this); name.setHint("Site name"); name.setSingleLine();
        name.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(120)});
        name.setText(siteName(key.host)); form.addView(name);
        CheckBox bookmark = new CheckBox(this); bookmark.setText("Add to quick access"); bookmark.setChecked(true); form.addView(bookmark);
        new AlertDialog.Builder(this).setTitle("Add private Tor site").setView(form)
            .setNegativeButton("Cancel", null).setPositiveButton("Save site", (dialog, which) -> {
                String title = name.getText().toString().trim();
                save(key, title.isEmpty() ? key.host : title, bookmark.isChecked());
            }).show();
    }
    private String siteName(String host) { return app.policies.getString("onion." + host + ".title", host); }
    private void bookmark(String host) {
        app.host.quickAccess("https://" + host + "/", siteName(host), this::message, this::message);
    }
    private void save(OnionKey key, String title, boolean bookmark) {
        address.setText(key.host); secret.setText(""); manual.setVisibility(android.view.View.GONE);
        status.setText("Importing " + key.host + "…");
        app.tor.save(key, () -> {
            app.policies.edit().putString("onion." + key.host + ".title", title).apply();
            refreshImported();
            if (bookmark) bookmark(key.host);
        }, value -> { message(value); refreshImported(); });
    }
    private void refreshImported() {
        app.tor.list(hosts -> {
            if (isFinishing() || isDestroyed()) return;
            imported.removeAllViews();
            if (hosts.isEmpty()) return;
            TextView label = new TextView(this); label.setText("Saved private sites"); label.setTextSize(20); imported.addView(label);
            java.util.Collections.sort(hosts);
            for (String host : hosts) {
                TextView name = new TextView(this); name.setText(siteName(host)); name.setTextSize(18); imported.addView(name);
                if (!siteName(host).equals(host)) { TextView url = new TextView(this); url.setText(host); imported.addView(url); }
                LinearLayout actions = new LinearLayout(this); imported.addView(actions);
                siteAction(actions, "Open", "Open " + host, () ->
                    app.create(BrowserApp.USER, false, "https://" + host + "/", tab -> { app.show(tab); finish(); }, this::message));
                siteAction(actions, "Quick access", "Quick access " + host, () -> bookmark(host));
                siteAction(actions, "Remove", "Remove " + host, () -> new AlertDialog.Builder(this)
                    .setTitle("Remove private site?").setMessage("Remove the saved key for " + siteName(host) + "? Quick-access entries and bookmarks will remain.")
                    .setNegativeButton("Cancel", null).setPositiveButton("Remove", (dialog, which) ->
                        app.tor.remove(host, value -> { message(value); refreshImported(); })).show());
            }
        });
    }
    private void siteAction(LinearLayout row, String label, String description, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false); button.setContentDescription(description);
        button.setOnClickListener(view -> action.run()); row.addView(button, new LinearLayout.LayoutParams(0, -2, 1));
    }
    private void message(String value) { status.setText(value); Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        try {
            if (request == 20 && result == RESULT_OK && data != null && data.getData() != null) {
                try (InputStream input = getContentResolver().openInputStream(data.getData())) {
                    byte[] bytes = new byte[2049]; int total = 0, count;
                    while (total < bytes.length && (count = input.read(bytes, total, bytes.length - total)) > 0) total += count;
                    if (total > 2048) throw new IllegalArgumentException("Credential file too large");
                    confirmImport(OnionKey.parse(new String(bytes, 0, total, StandardCharsets.UTF_8)));
                    java.util.Arrays.fill(bytes, (byte) 0);
                }
            } else {
                IntentResult scanned = IntentIntegrator.parseActivityResult(request, result, data);
                if (scanned != null && scanned.getContents() != null) confirmImport(OnionKey.parse(scanned.getContents()));
            }
        } catch (Exception error) { message("Could not read a valid onion credential"); }
    }
}
