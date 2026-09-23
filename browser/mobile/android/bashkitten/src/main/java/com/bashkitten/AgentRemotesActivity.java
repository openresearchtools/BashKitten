// SPDX-License-Identifier: GPL-3.0-only
package com.bashkitten;

import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Native enrollment: connection keys are never navigated to or exposed to the tab dispatcher. */
public final class AgentRemotesActivity extends ProductActivity {
    private static final int OPEN_CONNECTION = 42;
    private BrowserApp app;
    private LinearLayout connections, manual;
    private EditText name, address, secret;
    private TextView status;
    private boolean busy;
    private final List<Button> controls = new ArrayList<>();
    private final List<Button> cardControls = new ArrayList<>();

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        app = BrowserApp.get(this);
        setTitle("Agent connections");
        LinearLayout root = column();
        TextView description = text("Use Agent on this device or connect privately through Tor. Remote sign-in still requires your password and second factor.", 15);
        root.addView(description);
        connections = column(); root.addView(connections);
        TextView addTitle = text("Add a remote Agent", 20); addTitle.setPadding(0, dp(24), 0, dp(8)); root.addView(addTitle);
        button(root, "Scan QR code", () -> new IntentIntegrator(this).setCaptureActivity(OnionCaptureActivity.class)
                .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("Scan an Agent connection QR code")
                .setBeepEnabled(false).setOrientationLocked(false).initiateScan());
        button(root, "Import connection file", () -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .setType("*/*").addCategory(Intent.CATEGORY_OPENABLE), OPEN_CONNECTION));
        button(root, "Enter address and key", () -> manual.setVisibility(manual.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE));
        manual = column(); manual.setVisibility(View.GONE); root.addView(manual);
        name = field("Name", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES); manual.addView(name);
        address = field("Agent onion address", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI); manual.addView(address);
        secret = field("Private connection key", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        secret.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        secret.setSaveEnabled(false); secret.setFreezesText(false); manual.addView(secret);
        button(manual, "Connect", () -> {
            try {
                JSONObject record = new JSONObject().put("version", 1).put("kind", "agent")
                        .put("name", name.getText().toString()).put("url", address.getText().toString())
                        .put("clientAuthorization", secret.getText().toString());
                confirm(normalize(record));
            } catch (Exception error) { message("Enter a valid Agent onion address and its 52-character private key."); }
        });
        status = text("", 14); status.setPadding(0, dp(12), 0, 0); root.addView(status);
        showContent(root, true);
        refresh();
    }

    private void refresh() {
        controls.removeAll(cardControls); cardControls.clear();
        connections.removeAllViews();
        connectionCard("Local", "This device · Termux", "local", false);
        try {
            JSONObject saved = app.agent.remotes();
            List<String> ids = new ArrayList<>(); saved.keys().forEachRemaining(id -> { if (saved.optJSONObject(id) != null) ids.add(id); });
            ids.sort(Comparator.comparing((String id) -> saved.optJSONObject(id).optString("name", id), String.CASE_INSENSITIVE_ORDER));
            for (String id : ids) {
                JSONObject record = saved.optJSONObject(id);
                if (record != null) connectionCard(record.optString("name", id), id, id, true);
            }
        } catch (Exception error) { message("Saved connections could not be opened."); }
    }

    private void connectionCard(String title, String endpoint, String id, boolean removable) {
        LinearLayout card = column();
        card.setPadding(0, dp(18), 0, dp(8)); connections.addView(card);
        boolean current = app.agent.selected.equals(id);
        card.addView(text((current ? "✓  " : "") + title, 18));
        TextView location = text(endpoint, 13); location.setTextIsSelectable(true); card.addView(location);
        LinearLayout actions = new LinearLayout(this); card.addView(actions);
        Button open = rowButton(actions, current ? "Selected" : "Connect", () -> { app.agent.select(id); finish(); });
        open.setTag(current);
        open.setEnabled(!busy && !current);
        if (removable) rowButton(actions, "Remove", () -> new AlertDialog.Builder(this)
                .setTitle("Remove " + title + "?")
                .setMessage("Forget this device's saved Agent connection and sign-in session.")
                .setNegativeButton("Cancel", null).setPositiveButton("Remove", (dialog, which) -> {
                    try { app.agent.removeRemote(id); refresh(); }
                    catch (Exception error) { message("The connection could not be removed. Retry."); }
                }).show());
    }

    private void confirm(JSONObject record) throws Exception {
        if (busy) return;
        String host = URI.create(record.getString("url")).getHost();
        LinearLayout form = column(); form.setPadding(dp(24), 0, dp(24), 0);
        EditText title = field("Name", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        title.setText(record.optString("name", "Remote Agent")); form.addView(title);
        TextView destination = text(host, 14); destination.setTextIsSelectable(true); form.addView(destination);
        TextView detail = text("The private connection key stays on this device. Sign in to the server after connecting.", 14);
        detail.setPadding(0, dp(12), 0, 0); form.addView(detail);
        new AlertDialog.Builder(this).setTitle("Connect to remote Agent")
                .setView(form).setNegativeButton("Cancel", null).setPositiveButton("Connect", (dialog, which) -> {
                    try {
                        String display = title.getText().toString().trim();
                        record.put("name", display.isEmpty() ? "Remote Agent" : display);
                        enroll(record);
                    } catch (Exception error) { message("The connection could not be saved."); }
                }).show();
    }

    private void enroll(JSONObject record) {
        secret.setText("");
        setBusy(true); status.setText("Verifying the remote Agent through Tor…");
        // Both imports and manual entry use the same native enrollment path. It verifies any supplied
        // CA pin before saving and never falls back to a direct connection or an ordinary browser tab.
        app.agent.enrollRemote(record, accepted -> {
            if (isFinishing() || isDestroyed()) return;
            setBusy(false);
            try {
                app.agent.select(URI.create(accepted.getString("url")).getHost());
                finish();
            } catch (Exception error) { message("The connection was saved. Select it to connect."); refresh(); }
        }, failure -> {
            if (isFinishing() || isDestroyed()) return;
            setBusy(false); message(failure);
        });
    }

    /** One connection envelope for QR, file and manual entry. Unknown fields are not retained. */
    private static JSONObject normalize(JSONObject input) throws Exception {
        if (input.optInt("version") != 1 || !input.optString("kind").equals("agent")) {
            throw new IllegalArgumentException("Not an Agent connection.");
        }
        String endpoint = input.getString("url").trim();
        if (!endpoint.contains("://")) endpoint = "https://" + endpoint;
        URI url = URI.create(endpoint);
        String host = url.getHost();
        if (host == null) throw new IllegalArgumentException("Invalid onion address.");
        host = host.toLowerCase(Locale.ROOT);
        if (!"https".equalsIgnoreCase(url.getScheme()) || !host.matches("[a-z2-7]{56}\\.onion")
                || url.getUserInfo() != null || url.getRawQuery() != null || url.getRawFragment() != null
                || (url.getRawPath() != null && !url.getRawPath().isEmpty() && !url.getRawPath().equals("/"))
                || url.getPort() == 0 || url.getPort() > 65535) {
            throw new IllegalArgumentException("Use the Agent's HTTPS onion root address.");
        }
        OnionKey key = new OnionKey(host, input.getString("clientAuthorization"));
        String label = input.optString("name", "Remote Agent").trim();
        if (label.isEmpty()) label = "Remote Agent";
        JSONObject record = new JSONObject().put("version", 1).put("kind", "agent").put("name", label)
                .put("url", new URI("https", null, host, url.getPort(), "/", null, null).toString())
                .put("clientAuthorization", key.key);
        String fingerprint = input.optString("caSha256", "").replace(":", "").toLowerCase(Locale.ROOT);
        if (!fingerprint.isEmpty() && !fingerprint.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid certificate identity.");
        String pem = input.optString("caPem", "").trim();
        if (!pem.isEmpty()) {
            X509Certificate ca = (X509Certificate) CertificateFactory.getInstance("X.509")
                    .generateCertificate(new java.io.ByteArrayInputStream(pem.getBytes(StandardCharsets.US_ASCII)));
            ca.checkValidity();
            if (ca.getBasicConstraints() < 0) throw new IllegalArgumentException("A CA certificate is required.");
            StringBuilder digest = new StringBuilder();
            for (byte value : MessageDigest.getInstance("SHA-256").digest(ca.getEncoded())) digest.append(String.format(Locale.ROOT, "%02x", value & 255));
            if (!fingerprint.isEmpty() && !fingerprint.equals(digest.toString())) throw new IllegalArgumentException("Certificate identity does not match.");
            record.put("caPem", pem); fingerprint = digest.toString();
        }
        if (!fingerprint.isEmpty()) record.put("caSha256", fingerprint);
        if (input.has("instanceId")) {
            String id = input.getString("instanceId");
            record.put("instanceId", id);
        }
        return record;
    }

    private void importConnection(String json) {
        try {
            confirm(normalize(new JSONObject(json)));
        } catch (Exception error) { message("Choose a valid Agent connection file or QR code."); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == OPEN_CONNECTION) {
            if (result != RESULT_OK || data == null || data.getData() == null) return;
            android.net.Uri file = data.getData();
            setBusy(true); status.setText("Reading connection file…");
            new Thread(() -> {
                String text = null;
                try (InputStream input = getContentResolver().openInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new IllegalArgumentException();
                    byte[] chunk = new byte[4096];
                    try {
                        int count;
                        while ((count = input.read(chunk)) != -1) {
                            output.write(chunk, 0, count);
                        }
                        text = new String(output.toByteArray(), StandardCharsets.UTF_8);
                    } finally { java.util.Arrays.fill(chunk, (byte) 0); }
                } catch (Exception ignored) { /* No credential-bearing input is written to logs. */ }
                final String connection = text;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    setBusy(false); status.setText("");
                    if (connection == null) message("The connection file could not be read.");
                    else importConnection(connection);
                });
            }, "agent-connection-import").start();
            return;
        }
        IntentResult scanned = IntentIntegrator.parseActivityResult(request, result, data);
        if (scanned != null && scanned.getContents() != null) importConnection(scanned.getContents());
    }

    private void setBusy(boolean value) {
        busy = value;
        for (Button control : controls) control.setEnabled(!value && !Boolean.TRUE.equals(control.getTag()));
        name.setEnabled(!value); address.setEnabled(!value); secret.setEnabled(!value);
    }
    private void message(String value) {
        status.setText(value);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private LinearLayout column() { LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); return layout; }
    private TextView text(String value, int size) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); return view; }
    private EditText field(String hint, int inputType) {
        EditText field = new EditText(this); field.setHint(hint); field.setSingleLine(); field.setInputType(inputType);
        return field;
    }
    private Button button(LinearLayout row, String label, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false);
        button.setOnClickListener(view -> { if (!busy) action.run(); }); row.addView(button); controls.add(button); return button;
    }
    private Button rowButton(LinearLayout row, String label, Runnable action) {
        Button button = button(row, label, action); cardControls.add(button); button.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1)); return button;
    }
}
