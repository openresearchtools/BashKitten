// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import androidx.lifecycle.ViewModelProvider;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/** Native TK2 import. Neither encrypted input nor keys become browser navigation. */
public final class AgentRemotesActivity extends ProductActivity {
    private static final int OPEN_CONNECTION = 42, SHARE_LOCAL = 43;
    private BrowserApp app;
    private ImportState state;
    private LinearLayout body;
    private TextView status;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        app = BrowserApp.get(this);
        state = new ViewModelProvider(this).get(ImportState.class);
        state.app = app;
        setTitle("Agent connections");
        LinearLayout root = column();
        root.addView(text("Connect with the encrypted QR from the host’s Share Local page. Termux is only needed to run Agent on this device.", 15));
        body = column(); root.addView(body);
        status = text("", 14); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); root.addView(status);
        showContent(root, true);
        state.changes.observe(this, ignored -> render());
        render();
    }

    private void render() {
        if (state.connected) { finish(); return; }
        body.removeAllViews();
        status.setText(state.busy ? state.progress : state.error);
        if (!state.encrypted.isEmpty()) {
            body.addView(text("Connection password", 20));
            body.addView(text("Use the host’s account password. The image is decrypted here; sign-in still requires the authenticator code.", 15));
            EditText password = new EditText(this);
            password.setHint("Password"); password.setSingleLine();
            password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            password.setSaveEnabled(false); password.setFreezesText(false);
            password.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
            password.setText(state.password); password.setEnabled(!state.busy);
            password.addTextChangedListener(new TextWatcher() {
                @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                @Override public void onTextChanged(CharSequence s, int start, int before, int count) { state.password = s.toString(); }
                @Override public void afterTextChanged(Editable value) {}
            });
            body.addView(password);
            button(body, "Connect", state::decrypt);
            button(body, "Cancel", () -> { state.encrypted = ""; state.password = ""; state.error = ""; render(); });
            return;
        }
        card("Local", "This device · Termux", "local", false);
        try {
            JSONObject saved = app.agent.remotes();
            List<String> ids = new ArrayList<>();
            saved.keys().forEachRemaining(id -> { if (saved.optJSONObject(id) != null) ids.add(id); });
            ids.sort(Comparator.comparing((String id) -> saved.optJSONObject(id).optString("name", id), String.CASE_INSENSITIVE_ORDER));
            for (String id : ids) {
                JSONObject record = saved.getJSONObject(id);
                card(record.optString("name", id), record.optInt("version") == 2 ? id
                    : "Import a new encrypted QR from this host’s Share Local page.", id, true);
            }
        } catch (Exception error) { status.setText("Saved connections could not be opened."); }
        button(body, "Share Local", () -> startActivityForResult(new Intent(this, AgentShareActivity.class), SHARE_LOCAL));
        TextView title = text("Add a remote Agent", 20); title.setPadding(0, dp(24), 0, dp(8)); body.addView(title);
        button(body, "Scan QR", () -> new IntentIntegrator(this).setCaptureActivity(OnionCaptureActivity.class)
            .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("Scan the encrypted connection QR")
            .setBeepEnabled(false).setOrientationLocked(false).initiateScan());
        button(body, "Upload QR image", () -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType("image/*").addCategory(Intent.CATEGORY_OPENABLE), OPEN_CONNECTION));
    }

    private void card(String title, String description, String id, boolean removable) {
        LinearLayout card = column(); card.setPadding(0, dp(18), 0, dp(8)); body.addView(card);
        boolean current = app.agent.selected.equals(id);
        card.addView(text((current ? "✓  " : "") + title, 18));
        TextView location = text(description, 13); location.setTextIsSelectable(true); card.addView(location);
        LinearLayout actions = new LinearLayout(this); card.addView(actions);
        MaterialButton open = button(actions, current ? "Open" : "Connect", () -> { app.agent.select(id); finish(); });
        open.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        if (removable) {
            MaterialButton remove = button(actions, "Remove", () -> new MaterialAlertDialogBuilder(this)
                .setTitle("Remove " + title + "?")
                .setMessage("Close this device’s connection and forget its saved keys and sign-in session.")
                .setNegativeButton("Cancel", null).setPositiveButton("Remove", (dialog, which) -> {
                    try { app.agent.removeRemote(id); render(); }
                    catch (Exception error) { status.setText("The connection could not be removed. Retry."); }
                }).show());
            remove.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == SHARE_LOCAL) { if (result == RESULT_FIRST_USER) finish(); return; }
        if (request == OPEN_CONNECTION) {
            if (result == RESULT_OK && data != null && data.getData() != null) state.readImage(data.getData());
            return;
        }
        IntentResult scanned = IntentIntegrator.parseActivityResult(request, result, data);
        if (scanned != null && scanned.getContents() != null) state.accept(scanned.getContents());
    }

    /** Transient import/password survive rotation, never Bundle or disk storage. */
    public static final class ImportState extends ViewModel {
        final MutableLiveData<Integer> changes = new MutableLiveData<>(0);
        BrowserApp app;
        String encrypted = "", password = "", progress = "", error = "";
        boolean busy, connected, closed;
        void changed() { changes.setValue(changes.getValue() + 1); }
        void accept(String value) {
            if (closed || busy) return;
            if (!value.startsWith("TK2:")) { error = "Choose the host’s encrypted connection QR image."; changed(); return; }
            encrypted = value; password = ""; error = ""; changed();
        }
        void readImage(Uri uri) {
            if (busy || closed) return;
            busy = true; progress = "Reading connection image…"; error = ""; changed();
            Context context = app.getApplicationContext();
            new Thread(() -> {
                String text = null;
                try (InputStream input = context.getContentResolver().openInputStream(uri);
                        ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new IllegalArgumentException();
                    byte[] buffer = new byte[16384];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    byte[] image = output.toByteArray();
                    try { text = NativeRemote.readImage(context, image); }
                    finally { Arrays.fill(image, (byte) 0); }
                } catch (Exception ignored) { /* Never log connection material. */ }
                final String result = text;
                app.main.post(() -> {
                    if (closed) return;
                    busy = false;
                    if (result == null) { error = "The image could not be read as a connection QR."; changed(); }
                    else accept(result);
                });
            }, "agent-qr-image").start();
        }
        void decrypt() {
            if (busy || closed || encrypted.isEmpty()) return;
            final String supplied = password, image = encrypted;
            password = ""; error = ""; busy = true; progress = "Decrypting connection…"; changed();
            new Thread(() -> {
                JSONObject bundle = null;
                try { bundle = NativeRemote.decrypt(app, image, supplied); }
                catch (Exception ignored) { /* Native validation failed; preserve existing connections. */ }
                final JSONObject result = bundle;
                app.main.post(() -> {
                    if (closed) return;
                    busy = false;
                    if (result == null) { error = "Incorrect password or invalid connection image."; changed(); return; }
                    try {
                        app.agent.importRemote(result, supplied);
                        encrypted = ""; connected = true;
                    } catch (Exception error) { this.error = "The connection could not be saved: " + error.getMessage(); }
                    changed();
                });
            }, "agent-qr-decrypt").start();
        }
        @Override protected void onCleared() { closed = true; password = ""; encrypted = ""; }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private LinearLayout column() { LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); return layout; }
    private TextView text(String value, int size) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); return view; }
    private MaterialButton button(LinearLayout parent, String label, Runnable action) {
        MaterialButton button = new MaterialButton(this); button.setText(label); button.setAllCaps(false);
        button.setEnabled(!state.busy); button.setOnClickListener(view -> { if (!state.busy) action.run(); });
        parent.addView(button); return button;
    }
}
