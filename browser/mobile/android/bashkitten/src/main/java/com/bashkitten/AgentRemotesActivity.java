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
import android.widget.CheckBox;
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
import org.json.JSONArray;
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
        if (!state.serviceHost.isEmpty()) { services(); return; }
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
            if (app.agent.remoteConnected(id)) {
                card.addView(text("Connected", 14));
                button(card, "Services", () -> { state.serviceHost = id; state.services = new JSONObject(); state.refreshServices(); });
                button(card, "Disconnect", () -> { app.agent.disconnectRemote(id); render(); });
            }
        }
    }

    private void services() {
        button(body, "Back to connections", () -> { state.serviceHost = ""; state.error = ""; render(); });
        JSONArray services = state.services.optJSONArray("services");
        if (services != null) for (int i = 0; i < services.length(); i++) {
            JSONObject service = services.optJSONObject(i);
            String id = service.optString("id");
            LinearLayout card = column(); card.setPadding(0, dp(18), 0, dp(8)); body.addView(card);
            card.addView(text(service.optString("name"), 18));
            card.addView(text(service.optString("state") + " · " + (service.optBoolean("reachable") ? "Target reachable" : "Target unavailable"), 14));
            if (!service.optString("error").isEmpty()) card.addView(text(service.optString("error"), 14));
            if (id.equals("agent")) {
                button(card, "Open Agent", () -> { app.agent.openRemoteService(state.serviceHost, id, this::finish, message -> status.setText(message)); }); continue;
            }
            JSONArray actions = service.optJSONArray("actions");
            if (actions != null) for (int j = 0; j < actions.length(); j++) {
                String action = actions.optString(j);
                if (!Arrays.asList("start", "stop", "reload").contains(action)) continue;
                String label = action.equals("start") ? "Start" : action.equals("stop") ? "Stop" : "Reload";
                button(card, label + " on host", () -> {
                    if (action.equals("start")) state.serviceAction(id, action);
                    else new MaterialAlertDialogBuilder(this).setTitle(label + " on host?")
                        .setMessage("This affects every client. Active streams will end.").setNegativeButton("Cancel", null)
                        .setPositiveButton(label, (dialog, which) -> state.serviceAction(id, action)).show();
                });
            }
            JSONObject choice = service.optJSONObject("choice");
            CheckBox enabled = new CheckBox(this); enabled.setText("Local access"); enabled.setChecked(choice.optBoolean("enabled")); card.addView(enabled);
            EditText port = new EditText(this); port.setInputType(InputType.TYPE_CLASS_NUMBER); port.setSingleLine(); port.setHint("Port — blank for Automatic");
            port.setText(choice.optInt("port") == 0 ? "" : String.valueOf(choice.optInt("port"))); card.addView(port);
            enabled.setEnabled(!state.busy); port.setEnabled(!state.busy);
            enabled.setOnCheckedChangeListener((button, checked) -> { try { choice.put("enabled", checked); } catch (Exception ignored) {} });
            port.addTextChangedListener(new TextWatcher() {
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                public void afterTextChanged(Editable value) {}
                public void onTextChanged(CharSequence s, int start, int before, int count) {
                    try { choice.put("portText", s.toString()); } catch (Exception ignored) {}
                }
            });
            if (choice.has("portText")) port.setText(choice.optString("portText"));
            CheckBox piImport = new CheckBox(this); piImport.setText("Import this configuration into the coding agent");
            piImport.setChecked(choice.optBoolean("importToPi")); piImport.setEnabled(!state.busy);
            EditText apiKey = new EditText(this); apiKey.setHint("Service API key (if required)"); apiKey.setSingleLine();
            apiKey.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            apiKey.setSaveEnabled(false); apiKey.setFreezesText(false); apiKey.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
            apiKey.setText(choice.optString("apiKey")); apiKey.setEnabled(!state.busy);
            if (service.optString("kind").equals("llama")) {
                button(card, "Add to Pi", () -> piImport.setChecked(true)); card.addView(piImport); card.addView(apiKey);
                piImport.setOnCheckedChangeListener((button, checked) -> { try { choice.put("importToPi", checked); } catch (Exception ignored) {} });
                apiKey.addTextChangedListener(new TextWatcher() {
                    public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                    public void afterTextChanged(Editable value) {}
                    public void onTextChanged(CharSequence s, int start, int before, int count) { try { choice.put("apiKey", s.toString()); } catch (Exception ignored) {} }
                });
                if (!service.optString("importState").isEmpty()) card.addView(text(service.optString("importState"), 14));
            }
            button(card, "Save changes", () -> {
                try {
                    int selectedPort = port.getText().toString().trim().isEmpty() ? 0 : Integer.parseInt(port.getText().toString());
                    state.begin("Saving local access…");
                    app.agent.saveRemoteMapping(state.serviceHost, id, enabled.isChecked(), selectedPort, piImport.isChecked(), apiKey.getText().toString(), state::servicesResult, state::failed);
                } catch (Exception error) { state.failed("Choose Automatic or a port from 1 to 65535."); }
            });
            String mappingError = service.optString("mappingError");
            JSONObject mapping = service.optJSONObject("mapping");
            if (mappingError.isEmpty() && mapping != null) mappingError = mapping.optString("error");
            if (!mappingError.isEmpty()) card.addView(text(mappingError, 14));
            String url = service.optString("url");
            if (!url.isEmpty()) {
                TextView address = text(url, 14); address.setTextIsSelectable(true); card.addView(address);
                button(card, "Open", () -> app.agent.openRemoteService(state.serviceHost, id, this::finish, message -> status.setText(message)));
                button(card, "Copy URL", () -> {
                    getSystemService(android.content.ClipboardManager.class).setPrimaryClip(android.content.ClipData.newPlainText("Service URL", url));
                    address.setText(url + " · Copied");
                });
                if (service.optString("kind").equals("llama")) card.addView(text(Uri.parse(url).buildUpon().path("/v1").query(null).fragment(null).build().toString(), 14));
            }
        }
        button(body, "Refresh services", state::refreshServices);
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
        String serviceHost = "";
        JSONObject services = new JSONObject();
        boolean busy, connected, closed;
        void changed() { changes.setValue(changes.getValue() + 1); }
        void begin(String message) { busy = true; progress = message; error = ""; changed(); }
        void failed(String message) { if (!closed) { busy = false; error = message; changed(); } }
        void servicesResult(JSONObject result) { if (!closed) { busy = false; services = result; changed(); } }
        void refreshServices() {
            if (busy || closed) return;
            begin("Reading remote services…"); app.agent.remoteServices(serviceHost, this::servicesResult, this::failed);
        }
        void serviceAction(String id, String action) {
            if (busy || closed) return;
            begin("Updating host service…"); app.agent.remoteServiceAction(serviceHost, id, action, this::servicesResult, this::failed);
        }
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
