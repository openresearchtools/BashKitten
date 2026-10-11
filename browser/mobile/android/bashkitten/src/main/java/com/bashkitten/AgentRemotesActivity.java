// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AlertDialog;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import androidx.lifecycle.ViewModelProvider;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Arrays;
import org.json.JSONObject;

/** Native acquisition/password consent only. Settings live in the owned Gecko page. */
public final class AgentRemotesActivity extends ProductActivity {
    private static final int OPEN_CONNECTION = 42;
    private ImportState state;
    private TextView status;
    private AlertDialog passwordDialog;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        state = new ViewModelProvider(this).get(ImportState.class);
        state.app = BrowserApp.get(this);
        setTitle("Connect to remote");
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        status = new TextView(this); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(status); showContent(root, true);
        state.changes.observe(this, ignored -> render());
        if (!state.acquiring) {
            state.acquiring = true;
            try {
                if ("scan".equals(getIntent().getStringExtra("method"))) {
                    new IntentIntegrator(this).setCaptureActivity(OnionCaptureActivity.class)
                        .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("Scan the encrypted connection QR")
                        .setBeepEnabled(false).setOrientationLocked(false).initiateScan();
                } else startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE), OPEN_CONNECTION);
            } catch (Exception error) { state.fatal("The QR scanner or image picker could not be opened."); }
        }
        render();
    }
    private void render() {
        if (isFinishing() || isDestroyed()) return;
        if (state.connected) { setResult(RESULT_OK); finish(); return; }
        if (!state.fatal.isEmpty()) { setResult(RESULT_CANCELED, new Intent().putExtra("error", state.fatal)); finish(); return; }
        status.setText(state.busy ? state.progress : "");
        if (!state.busy && !state.encrypted.isEmpty() && passwordDialog == null) {
            EditText password = new EditText(this); password.setSingleLine();
            password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            password.setSaveEnabled(false); password.setFreezesText(false); password.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
            passwordDialog = new MaterialAlertDialogBuilder(this).setTitle("Connection password")
                .setMessage((state.error.isEmpty() ? "" : state.error + "\n\n") + "Use the host’s account password to decrypt the image. Then sign in on the host’s Authelia page.")
                .setView(password).setNegativeButton("Cancel", (dialog, which) -> finish())
                .setPositiveButton("Connect", (dialog, which) -> {
                    String supplied = password.getText().toString(); password.setText(""); state.decrypt(supplied);
                }).create();
            passwordDialog.setOnCancelListener(dialog -> finish());
            passwordDialog.setOnDismissListener(dialog -> { password.setText(""); passwordDialog = null; });
            passwordDialog.show();
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == OPEN_CONNECTION) {
            if (result == RESULT_OK && data != null && data.getData() != null) state.readImage(data.getData());
            else finish();
            return;
        }
        IntentResult scanned = IntentIntegrator.parseActivityResult(request, result, data);
        if (scanned != null) {
            if (scanned.getContents() != null) state.accept(scanned.getContents());
            else finish();
        }
    }
    @Override protected void onDestroy() {
        if (passwordDialog != null) { passwordDialog.dismiss(); passwordDialog = null; }
        if (isFinishing()) {
            state.cancel();
            finishActivity(OPEN_CONNECTION); finishActivity(IntentIntegrator.REQUEST_CODE);
        }
        super.onDestroy();
    }
    /** Only transient encrypted input survives rotation; it never enters Gecko. */
    public static final class ImportState extends ViewModel {
        final MutableLiveData<Integer> changes = new MutableLiveData<>(0);
        BrowserApp app;
        String encrypted = "", progress = "", error = "", fatal = "";
        boolean busy, connected, acquiring;
        volatile boolean closed;
        private volatile InputStream imageInput;
        void changed() { changes.setValue(changes.getValue() + 1); }
        void failed(String message) { if (!closed) { busy = false; error = message; changed(); } }
        void fatal(String message) { if (!closed) { busy = false; fatal = message; changed(); } }
        void accept(String value) {
            if (closed || busy) return;
            if (!value.startsWith("TK2:")) { fatal("Choose the host’s encrypted connection QR image."); return; }
            encrypted = value; error = ""; changed();
        }
        void readImage(Uri uri) {
            if (busy || closed) return;
            busy = true; progress = "Reading connection image…"; error = ""; changed();
            Context context = app.getApplicationContext();
            new Thread(() -> {
                String text = null;
                try (InputStream input = context.getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new IllegalArgumentException();
                    imageInput = input;
                    if (closed) return;
                    byte[] buffer = new byte[16384]; int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    byte[] image = output.toByteArray();
                    try { text = NativeRemote.readImage(context, image); } finally { Arrays.fill(image, (byte) 0); }
                } catch (Exception ignored) { /* Never log connection material. */ }
                finally { imageInput = null; }
                final String result = text;
                app.main.post(() -> {
                    if (closed) return;
                    busy = false;
                    if (result == null) fatal("The image could not be read as a connection QR."); else accept(result);
                });
            }, "agent-qr-image").start();
        }
        void decrypt(String password) {
            if (busy || closed || encrypted.isEmpty()) return;
            final String image = encrypted;
            error = ""; busy = true; progress = "Decrypting connection…"; changed();
            new Thread(() -> {
                JSONObject bundle = null;
                try { bundle = NativeRemote.decrypt(app, image, password); }
                catch (Exception ignored) { /* Preserve existing enrollments on native validation failure. */ }
                final JSONObject result = bundle;
                app.main.post(() -> {
                    if (closed) return;
                    if (result == null) { failed("Incorrect password or invalid connection image."); return; }
                    progress = "Saving connection…"; changed();
                    app.agent.importRemote(result, () -> {
                        if (closed) return;
                        busy = false; encrypted = ""; connected = true; changed();
                    }, message -> failed("The connection could not be saved: " + message));
                });
            }, "agent-qr-decrypt").start();
        }
        void cancel() {
            closed = true; encrypted = "";
            InputStream input = imageInput;
            if (input != null) new Thread(() -> {
                try { input.close(); } catch (Exception ignored) {}
            }, "agent-qr-close").start();
        }
        @Override protected void onCleared() { cancel(); }
    }
}
