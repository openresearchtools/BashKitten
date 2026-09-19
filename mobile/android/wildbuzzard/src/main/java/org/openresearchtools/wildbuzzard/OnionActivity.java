// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.app.*;
import android.content.*;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowManager;
import android.widget.*;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import java.io.*;
import java.nio.charset.StandardCharsets;

public final class OnionActivity extends Activity {
    EditText address, secret;
    TextView status;
    BrowserApp app;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); app = BrowserApp.get(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(24, 60, 24, 24);
        TextView heading = new TextView(this); heading.setText("Private onion sites"); heading.setTextSize(22); root.addView(heading);
        TextView description = new TextView(this); description.setText("Scan a TorKitten / Orbot key QR, import an .auth_private file, or enter the onion address and X25519 private key. Keys stay encrypted on this device."); root.addView(description);
        address = new EditText(this); address.setHint("56-character address.onion"); address.setSingleLine(); root.addView(address);
        secret = new EditText(this); secret.setHint("52-character private key"); secret.setSingleLine();
        secret.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        secret.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO); root.addView(secret);
        add(root, "Import key", () -> { try { save(new OnionKey(address.getText().toString(), secret.getText().toString())); } catch (Exception error) { message(error.getMessage()); } });
        add(root, "Scan QR code", () -> new IntentIntegrator(this).setPrompt("Scan the private onion key QR").setBeepEnabled(false).setOrientationLocked(false).initiateScan());
        add(root, "Choose .auth_private file", () -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE), 20));
        add(root, "Remove an imported key", () -> app.tor.list(hosts -> new AlertDialog.Builder(this).setTitle("Remove key")
            .setItems(hosts.toArray(new String[0]), (d, i) -> app.tor.remove(hosts.get(i), this::message)).show()));
        status = new TextView(this); root.addView(status);
        setContentView(root);
    }
    private void add(LinearLayout root, String text, Runnable action) { Button b = new Button(this); b.setText(text); b.setOnClickListener(v -> action.run()); root.addView(b); }
    private void save(OnionKey key) { secret.setText(""); status.setText("Importing key…"); app.tor.save(key, this::message); }
    private void message(String value) { status.setText(value); Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        try {
            if (request == 20 && result == RESULT_OK && data != null && data.getData() != null) {
                try (InputStream input = getContentResolver().openInputStream(data.getData())) {
                    byte[] bytes = new byte[2049]; int total = 0, count;
                    while (total < bytes.length && (count = input.read(bytes, total, bytes.length - total)) > 0) total += count;
                    if (total > 2048) throw new IllegalArgumentException("Credential file too large");
                    save(OnionKey.parse(new String(bytes, 0, total, StandardCharsets.UTF_8)));
                    java.util.Arrays.fill(bytes, (byte) 0);
                }
            } else {
                IntentResult scanned = IntentIntegrator.parseActivityResult(request, result, data);
                if (scanned != null && scanned.getContents() != null) save(OnionKey.parse(scanned.getContents()));
            }
        } catch (Exception error) { message("Could not read a valid onion credential"); }
    }
}
