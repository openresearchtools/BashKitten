// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Dialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatDialogFragment;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import androidx.lifecycle.ViewModelProvider;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import org.json.JSONObject;

/** Local-only view of the same command/lifecycle used by Termux Pi. */
public final class AgentDisplayDialog extends AppCompatDialogFragment implements AgentRuntime.Listener {
    private static final String X11 = "com.termux.x11";
    private static final String PROMPT = "Use the termux-display skill to set up XFCE for this device and save a working launch command, using supported GPU acceleration if available.";
    // Official Termux GitHub signer; installer package names cannot prove this.
    private static final String GITHUB_SIGNER = "B6DA01480EEFD5FBF2CD3771B8D1021EC791304BDD6C4BF41D3FAABAD48EE5E1";
    private DisplayState state;
    private LinearLayout body;

    @Override public Dialog onCreateDialog(Bundle saved) {
        state = new ViewModelProvider(this).get(DisplayState.class);
        if (state.runtime == null) state.runtime = BrowserApp.get(requireContext()).agent;
        body = column(); body.setPadding(dp(20), 0, dp(20), dp(8));
        ScrollView scroll = new ScrollView(requireContext()); scroll.addView(body);
        Dialog dialog = new MaterialAlertDialogBuilder(requireContext()).setTitle("Display")
            .setView(scroll).setNegativeButton("Close", null).create();
        state.changes.observe(this, ignored -> render());
        render(); return dialog;
    }
    @Override public void onStart() {
        super.onStart(); state.runtime.observe(this);
        requireDialog().getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        changed();
    }
    @Override public void onStop() { state.runtime.detach(this); super.onStop(); }
    @Override public void onResume() {
        super.onResume();
        if (local() && !state.editing && !state.runtime.shareNeedsSetup()) state.call("display-status", new JSONObject());
        render();
    }
    @Override public void changed() {
        if (!local()) dismissAllowingStateLoss();
        else if (body != null && !state.editing) render();
    }
    private boolean local() { return state.runtime.selected.equals("local"); }
    private boolean installed() {
        try { return requireContext().getPackageManager().getApplicationInfo(X11, 0).enabled; }
        catch (PackageManager.NameNotFoundException error) { return false; }
    }
    private void render() {
        if (body == null || !isAdded()) return;
        body.removeAllViews();
        if (!local()) return;
        text(body, "Run desktop apps in an XFCE desktop using Termux:X11.");
        if (state.runtime.shareNeedsSetup()) {
            button(body, "Set up Local", () -> { state.runtime.turnOn(); dismiss(); }); return;
        }
        if (!installed()) {
            text(body, "Install Termux:X11, then return to Display.");
            button(body, "Download X11", this::download);
        }
        JSONObject value = state.value;
        TextView status = text(body, state.busy ? state.progress : value == null ? "Display status unavailable" : "Display · " + value.optString("state"));
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        if (!state.error.isEmpty()) text(body, state.error);
        if (value == null) { if (!state.busy) button(body, "Retry", () -> state.call("display-status", new JSONObject())); return; }
        String error = value.optString("error");
        if (!error.isEmpty() && !error.equals(state.error)) text(body, error);
        org.json.JSONArray others = value.optJSONArray("otherDisplaySockets");
        if (others != null && others.length() > 0) {
            java.util.List<String> displays = new java.util.ArrayList<>();
            for (int i = 0; i < others.length(); i++) displays.add(others.optString(i));
            text(body, "Other X display sockets: " + String.join(", ", displays) + ". These are not managed here.");
        }
        if (state.editing) {
            EditText editor = new EditText(requireContext()); editor.setTypeface(Typeface.MONOSPACE); editor.setTextSize(13);
            editor.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
            editor.setMinLines(3); editor.setMaxLines(4); editor.setText(state.draft); editor.setEnabled(!state.busy);
            editor.setSaveEnabled(false); body.addView(editor);
            editor.addTextChangedListener(new TextWatcher() {
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                public void onTextChanged(CharSequence s, int start, int before, int count) { state.draft = s.toString(); }
                public void afterTextChanged(Editable s) {}
            });
            LinearLayout actions = row();
            button(actions, "Save", () -> state.save(false));
            button(actions, "Cancel", () -> { state.editing = false; state.call("display-status", new JSONObject()); });
            button(body, "Restore default", () -> state.save(true));
        } else {
            code(value.optString("command"), 4);
            LinearLayout actions = row();
            button(actions, "Copy", () -> copy(value.optString("command"), "Command copied"));
            button(actions, "Edit", () -> { state.editing = true; state.draft = value.optString("command"); state.revision = value.optString("revision"); render(); });
            if (value.optBoolean("savedForNextStart")) text(body, "Saved for next start");
            boolean running = value.optString("state").equals("running"), stopping = value.optString("state").equals("stopping");
            LinearLayout controls = row();
            if (running || stopping) button(controls, "Stop", () -> state.call("display-stop", new JSONObject()));
            else if (installed()) button(controls, "Start", () -> state.call("display-start", new JSONObject()));
            if (running && installed()) button(controls, "Open X11", () -> {
                Intent intent = requireContext().getPackageManager().getLaunchIntentForPackage(X11);
                if (intent == null) { state.error = "Termux:X11 has no enabled launch activity."; render(); }
                else startActivity(intent);
            });
        }
        if (!value.optString("output").isEmpty()) {
            button(body, state.showOutput ? "Hide output" : "Show output", () -> { state.showOutput = !state.showOutput; render(); });
            if (state.showOutput) code(value.optString("output"), 4);
        }
        text(body, "Ask your agent"); code(PROMPT, 3);
        button(body, "Copy prompt", () -> copy(PROMPT, "Prompt copied"));
    }
    private void download() {
        PackageManager packages = requireContext().getPackageManager();
        byte[] digest = new byte[GITHUB_SIGNER.length() / 2];
        for (int i = 0; i < digest.length; i++) digest[i] = (byte) Integer.parseInt(GITHUB_SIGNER.substring(i * 2, i * 2 + 2), 16);
        boolean matching = packages.hasSigningCertificate(TermuxConnection.PACKAGE, digest, PackageManager.CERT_INPUT_SHA256);
        if (!matching) {
            new MaterialAlertDialogBuilder(requireContext()).setTitle("Termux:X11")
                .setMessage("This Termux uses a different signing key. Download the official standalone X11 APK; your Termux installation stays in place.")
                .setPositiveButton("Download", (d, w) -> download(false)).setNegativeButton("Cancel", null).show();
            return;
        }
        new MaterialAlertDialogBuilder(requireContext()).setTitle("Termux:X11")
            .setMessage("The shared-UID version matches your GitHub Termux. If Android rejects that version, choose the standalone APK.")
            .setPositiveButton("Shared UID", (d, w) -> download(true))
            .setNeutralButton("Standalone", (d, w) -> download(false)).setNegativeButton("Cancel", null).show();
    }
    private void download(boolean shared) {
        if (!local()) return;
        String url = "https://github.com/termux/termux-x11/releases/download/nightly/termux-x11-universal-" + (shared ? "sharedUid-" : "") + "debug.apk";
        BrowserApp app = state.runtime.app;
        app.create(BrowserApp.USER, false, url, tab -> { app.show(tab); dismissAllowingStateLoss(); }, error -> { state.error = error; render(); });
    }
    private void copy(String value, String feedback) {
        ((ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Display", value));
        Toast.makeText(requireContext(), feedback, Toast.LENGTH_SHORT).show();
    }
    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private LinearLayout column() { LinearLayout view = new LinearLayout(requireContext()); view.setOrientation(LinearLayout.VERTICAL); return view; }
    private LinearLayout row() { LinearLayout view = new LinearLayout(requireContext()); body.addView(view); return view; }
    private TextView text(LinearLayout parent, String value) {
        TextView view = new TextView(requireContext()); view.setText(value); view.setTextSize(14); view.setPadding(0, dp(6), 0, dp(6)); parent.addView(view); return view;
    }
    private void code(String value, int lines) {
        TextView view = new TextView(requireContext()); view.setText(value); view.setTypeface(Typeface.MONOSPACE); view.setTextSize(12);
        view.setTextIsSelectable(true); view.setPadding(dp(10), dp(8), dp(10), dp(8));
        ScrollView scroll = new ScrollView(requireContext()); scroll.setNestedScrollingEnabled(true); scroll.setClipToOutline(true); scroll.addView(view);
        GradientDrawable background = new GradientDrawable(); background.setCornerRadius(dp(12));
        background.setColor(com.google.android.material.color.MaterialColors.getColor(body, com.google.android.material.R.attr.colorSurface));
        background.setStroke(dp(1), view.getCurrentTextColor()); scroll.setBackground(background);
        body.addView(scroll, new LinearLayout.LayoutParams(-1, view.getLineHeight() * lines + dp(16)));
    }
    private void button(LinearLayout parent, String label, Runnable action) {
        MaterialButton view = new MaterialButton(requireContext()); view.setText(label); view.setAllCaps(false); view.setCornerRadius(dp(24));
        view.setEnabled(!state.busy); view.setOnClickListener(ignored -> { if (local() && !state.busy) action.run(); });
        parent.addView(view, new LinearLayout.LayoutParams(parent.getOrientation() == LinearLayout.HORIZONTAL ? 0 : -1, -2, parent.getOrientation() == LinearLayout.HORIZONTAL ? 1 : 0));
    }
    @Override public void onDestroyView() { body = null; super.onDestroyView(); }

    public static final class DisplayState extends ViewModel {
        final MutableLiveData<Integer> changes = new MutableLiveData<>(0);
        AgentRuntime runtime;
        JSONObject value;
        String error = "", progress = "", draft = "", revision = "";
        boolean busy, editing, showOutput, closed;
        void changed() { if (!closed) changes.setValue(changes.getValue() + 1); }
        void call(String action, JSONObject input) {
            if (closed || busy || !runtime.selected.equals("local")) return;
            busy = true; error = ""; progress = action.equals("display-start") ? "Starting desktop…" : action.equals("display-stop") ? "Stopping desktop…" : action.equals("display-save") ? "Saving command…" : "Checking display…"; changed();
            runtime.command(action, input, result -> {
                busy = false; value = result; if (action.equals("display-save")) editing = false; changed();
            }, failure -> {
                busy = false; error = failure; changed();
                if (!closed && !action.equals("display-status") && runtime.selected.equals("local")) {
                    runtime.command("display-status", new JSONObject(), result -> { value = result; changed(); }, ignored -> {});
                }
            });
        }
        void save(boolean reset) {
            try { call("display-save", new JSONObject().put("revision", revision).put("command", draft).put("reset", reset)); }
            catch (Exception failure) { error = failure.getMessage(); changed(); }
        }
        @Override protected void onCleared() { closed = true; }
    }
}
