// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Base64;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import androidx.lifecycle.ViewModelProvider;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import org.json.JSONObject;

import java.io.OutputStream;
import java.util.Arrays;
import java.util.function.Consumer;

/** Host administration is native-only. Nothing here is a web/automation command. */
public final class AgentShareActivity extends ProductActivity {
    private static final int SAVE_QR = 1;
    private ShareState state;
    private LinearLayout body;
    private TextView message;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        setTitle("Share Local");
        state = new ViewModelProvider(this).get(ShareState.class);
        if (state.runtime == null) state.runtime = BrowserApp.get(this).agent;
        LinearLayout root = column();
        root.addView(text("Publish this device’s Local Agent through Tor. Other devices use your password and authenticator code.", 16));
        body = column(); root.addView(body);
        message = text("", 14); message.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); root.addView(message);
        showContent(root, true);
        state.changes.observe(this, ignored -> render());
        if (!state.loaded && !state.runtime.shareNeedsSetup()) state.load();
        else render();
    }

    @Override protected void onResume() {
        super.onResume();
        // Returning from an authenticator/picker must keep the pending factor and
        // form. Only refresh completed host state, without a background poll.
        if (state != null && state.loaded && state.screen.equals("status") && !state.busy
            && !state.runtime.shareNeedsSetup()) state.load();
    }

    private void render() {
        body.removeAllViews();
        message.setText(state.busy ? state.progress : state.error);
        if (state.runtime.shareNeedsSetup() || state.missingPackages) {
            body.addView(text("Set up Local on this device before sharing it. Your saved remote connections are kept.", 16));
            button("Set up Local", () -> {
                if (state.runtime.selected.equals("local")) state.runtime.turnOn();
                else state.runtime.select("local");
                setResult(RESULT_FIRST_USER); finish();
            });
            return;
        }
        if (state.screen.equals("account")) { account(); return; }
        if (state.screen.equals("factor")) { factor(); return; }
        JSONObject value = state.value;
        if (value == null) {
            if (!state.busy) button("Retry", state::load);
            return;
        }
        if (!value.optString("phase").equals("ready")) {
            boolean migration = value.optBoolean("migrationRequired");
            if (migration) body.addView(text("Replace the previous remote identity to use encrypted connections. Old connection exports will stop working.", 15));
            button(migration ? "Reissue identity" : "Turn on", () -> begin(migration));
            return;
        }
        boolean enabled = value.optBoolean("enabled");
        body.addView(text(enabled ? (value.optBoolean("running") ? "Publishing is on" : "Publishing resumes when Local is turned on") : "Publishing is off", 18));
        button(enabled ? "Turn off" : "Turn on", () -> state.publish(!enabled));
        CheckBox allow = checkbox(value.optBoolean("allowFileManager"));
        allow.setOnCheckedChangeListener((button, checked) -> state.files(checked));
        TextView address = text(value.optString("address"), 14); address.setTextIsSelectable(true); body.addView(address);
        body.addView(text("Connection QR — encrypted with your account password.", 15));
        ImageView qr = qr(value.optString("qrDataUrl"), "Download encrypted connection QR");
        if (qr != null) {
            qr.setOnClickListener(view -> saveQr()); qr.setEnabled(!state.busy);
            button("Download QR image", this::saveQr);
        }
        button("Reissue identity", () -> begin(true));
    }

    private void begin(boolean reissue) {
        Runnable show = () -> {
            state.reissue = reissue; state.screen = "account"; state.error = "";
            state.username = state.password = state.confirmation = ""; state.allowFiles = false;
            render();
        };
        if (!reissue) { show.run(); return; }
        new MaterialAlertDialogBuilder(this).setTitle("Reissue identity?")
            .setMessage("Disconnect all old clients and replace the remote account, authenticator and connection keys? Local chats and provider logins are kept.")
            .setNegativeButton("Cancel", null).setPositiveButton("Reissue", (dialog, which) -> show.run()).show();
    }

    private void account() {
        field("Username", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD, state.username, value -> state.username = value);
        int password = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD;
        field("Password", password, state.password, value -> state.password = value);
        field("Confirm password", password, state.confirmation, value -> state.confirmation = value);
        CheckBox allow = checkbox(state.allowFiles);
        allow.setOnCheckedChangeListener((button, checked) -> state.allowFiles = checked);
        button("Set up authenticator", state::begin);
    }

    private void factor() {
        body.addView(text("Add this account to your authenticator, then enter its six-digit code.", 16));
        qr(state.value.optString("qrDataUrl"), "Authenticator setup QR");
        Uri uri = Uri.parse(state.value.optString("otpauthUrl"));
        if ("otpauth".equals(uri.getScheme()) && "totp".equals(uri.getHost())) {
            button("Open authenticator", () -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (ActivityNotFoundException error) { message.setText("No authenticator app is installed. Scan the QR with your authenticator on another device."); }
            });
        }
        field("Authenticator code", InputType.TYPE_CLASS_NUMBER, state.code, value -> state.code = value);
        button("Verify and publish", state::confirm);
    }

    private void saveQr() {
        if (state.busy) return;
        state.export = state.value.optString("qrDataUrl");
        try {
            startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("image/png").putExtra(Intent.EXTRA_TITLE, "bashkitten-connection.png"), SAVE_QR);
        } catch (ActivityNotFoundException error) { state.export = null; message.setText("Android could not open the save picker."); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != SAVE_QR) return;
        String encoded = state.export; state.export = null;
        if (result != RESULT_OK || data == null || data.getData() == null || encoded == null) return;
        Uri file = data.getData();
        android.content.ContentResolver resolver = getApplicationContext().getContentResolver();
        ShareState owner = state;
        owner.busy = true; owner.progress = "Saving QR image…"; owner.notifyChanged();
        new Thread(() -> {
            byte[] bytes = null;
            String error = "";
            try {
                bytes = png(encoded);
                try (OutputStream stream = resolver.openOutputStream(file, "wt")) {
                    if (stream == null) throw new IllegalStateException();
                    stream.write(bytes);
                }
            } catch (Exception failure) { error = "The QR image could not be saved. Choose a writable location and retry."; }
            finally { if (bytes != null) Arrays.fill(bytes, (byte) 0); }
            String failure = error;
            owner.runtime.app.main.post(() -> { owner.busy = false; owner.error = failure.isEmpty() ? "QR image saved." : failure; owner.notifyChanged(); });
        }, "agent-connection-export").start();
    }

    private static byte[] png(String value) {
        if (!value.startsWith("data:image/png;base64,")) throw new IllegalArgumentException("Invalid QR image");
        return Base64.decode(value.substring("data:image/png;base64,".length()), Base64.NO_WRAP);
    }
    private ImageView qr(String encoded, String label) {
        byte[] bytes = null;
        try {
            bytes = png(encoded); Bitmap image = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (image == null) throw new IllegalArgumentException();
            ImageView view = new ImageView(this); view.setImageBitmap(image); view.setAdjustViewBounds(true);
            view.setContentDescription(label); view.setScaleType(ImageView.ScaleType.FIT_CENTER);
            LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, dp(280));
            layout.setMargins(0, dp(12), 0, dp(12)); body.addView(view, layout); return view;
        } catch (Exception error) { message.setText("The controller returned an invalid QR image."); return null; }
        finally { if (bytes != null) Arrays.fill(bytes, (byte) 0); }
    }
    private LinearLayout column() { LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); return layout; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setPadding(0, dp(8), 0, dp(8)); return view; }
    private void button(String label, Runnable action) {
        MaterialButton view = new MaterialButton(this); view.setText(label); view.setAllCaps(false); view.setCornerRadius(dp(24));
        view.setEnabled(!state.busy); view.setOnClickListener(ignored -> { if (!state.busy) action.run(); });
        body.addView(view, new LinearLayout.LayoutParams(-1, -2));
    }
    private CheckBox checkbox(boolean checked) {
        CheckBox view = new CheckBox(this); view.setText("Allow remote file manager"); view.setChecked(checked); view.setEnabled(!state.busy);
        body.addView(view); return view;
    }
    private void field(String label, int input, String value, Consumer<String> changed) {
        EditText field = new EditText(this); field.setHint(label); field.setSingleLine(); field.setInputType(input);
        // Credentials survive rotation only in this ViewModel, never instance
        // state, autofill, preferences or a web document.
        field.setSaveEnabled(false); field.setFreezesText(false); field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        field.setText(value); field.setEnabled(!state.busy); body.addView(field);
        field.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) { changed.accept(s.toString()); }
            public void afterTextChanged(Editable value) {}
        });
    }
    @Override protected void onDestroy() {
        body.removeAllViews();
        super.onDestroy();
    }

    /** Transient native flow retained across rotation, never saved to disk. */
    public static final class ShareState extends ViewModel {
        final MutableLiveData<Integer> changes = new MutableLiveData<>(0);
        AgentRuntime runtime;
        JSONObject value;
        String screen = "status", error = "", progress = "", username = "", password = "", confirmation = "", code = "", export;
        boolean loaded, busy, reissue, allowFiles, closed, missingPackages;
        void notifyChanged() { if (!closed) changes.setValue(changes.getValue() + 1); }
        void load() {
            if (busy || closed) return;
            busy = true; progress = "Checking Local packages…"; error = ""; notifyChanged();
            runtime.termux.probe(result -> {
                if (closed) return;
                busy = false; missingPackages = !result.optBoolean("packages");
                if (missingPackages) notifyChanged();
                else run("share-status", new JSONObject(), false, this::status);
            }, this::failed);
        }
        void status(JSONObject result) { value = result; loaded = true; screen = "status"; code = ""; }
        void begin() {
            if (!password.equals(confirmation)) { error = "The passwords do not match."; notifyChanged(); return; }
            try {
                JSONObject args = new JSONObject().put("username", username.trim()).put("password", password).put("allowFileManager", allowFiles);
                password = confirmation = "";
                run(reissue ? "share-reissue" : "share-setup", args, true, result -> { value = result; screen = "factor"; });
            } catch (Exception failure) { failed("The setup request could not be prepared."); }
        }
        void confirm() {
            try {
                JSONObject args = new JSONObject().put("setupId", value.getString("setupId")).put("code", code);
                code = ""; run("share-confirm", args, false, this::status);
            } catch (Exception failure) { failed("Setup expired. Return to Share Local and start again."); }
        }
        void publish(boolean enabled) {
            try { run("share-publish", new JSONObject().put("enabled", enabled), enabled, this::status); }
            catch (Exception failure) { failed("The publishing request could not be prepared."); }
        }
        void files(boolean allowed) {
            try { run("share-files", new JSONObject().put("allowed", allowed), false, this::status); }
            catch (Exception failure) { failed("The file-manager permission could not be changed."); }
        }
        void run(String command, JSONObject args, boolean start, Consumer<JSONObject> done) {
            if (busy || closed) return;
            busy = true; error = ""; progress = start ? "Starting Local…" : "Updating Share Local…"; notifyChanged();
            Runnable send = () -> {
                if (closed) { args.remove("password"); return; }
                progress = "Updating Share Local…"; notifyChanged();
                runtime.command(command, args, result -> {
                    if (closed) { cancel(result); return; }
                    busy = false; done.accept(result); notifyChanged();
                }, this::failed);
                args.remove("password"); args.remove("code");
            };
            if (start) runtime.startShareLocal(send, message -> { args.remove("password"); failed(message); });
            else send.run();
        }
        void failed(String message) { if (closed) return; busy = false; error = message; notifyChanged(); }
        void cancel(JSONObject setup) {
            if (setup == null || !setup.has("setupId")) return;
            try { runtime.command("share-cancel", new JSONObject().put("setupId", setup.getString("setupId")), ignored -> {}, ignored -> {}); }
            catch (Exception ignored) { /* The controller also expires abandoned setup. */ }
        }
        @Override protected void onCleared() {
            closed = true; cancel(value);
            password = confirmation = code = username = ""; value = null; export = null;
        }
    }
}
