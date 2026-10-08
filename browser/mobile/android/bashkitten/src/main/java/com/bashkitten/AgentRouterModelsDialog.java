// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Dialog;
import android.os.*;
import android.text.*;
import android.view.View;
import android.widget.*;
import androidx.appcompat.app.AppCompatDialogFragment;
import androidx.lifecycle.*;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import org.json.*;
import java.util.*;

/** Native model form; upstream INI and process ownership remain in Termux. */
public final class AgentRouterModelsDialog extends AppCompatDialogFragment {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable polling = this::pollTest;
    private State state;
    private LinearLayout body;
    private TextView checkStatus;
    private Dialog picker;
    static AgentRouterModelsDialog create(String file) { AgentRouterModelsDialog dialog = new AgentRouterModelsDialog(); Bundle args = new Bundle(); args.putString("file", file); dialog.setArguments(args); return dialog; }
    @Override public Dialog onCreateDialog(Bundle saved) {
        state = new ViewModelProvider(this).get(State.class); state.runtime = BrowserApp.get(requireContext()).agent;
        if (state.file == null) state.file = requireArguments().getString("file");
        body = new LinearLayout(requireContext()); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(dp(20), 0, dp(20), 0);
        ScrollView scroll = new ScrollView(requireContext()); scroll.addView(body);
        Dialog dialog = new MaterialAlertDialogBuilder(requireContext()).setTitle("Router models").setView(scroll).setNegativeButton("Close", null).create();
        state.changes.observe(this, ignored -> render()); render(); return dialog;
    }
    @Override public void onResume() { super.onResume(); if (state.models == null && !state.busy) load(); }
    @Override public void onPause() { main.removeCallbacks(polling); cancelTest(); if (picker != null) picker.dismiss(); super.onPause(); }
    @Override public void onDestroyView() { body = null; checkStatus = null; super.onDestroyView(); }
    private boolean visible() { return isResumed() && body != null && state.runtime.selected.equals("local"); }
    private interface Result { void accept(JSONObject result) throws Exception; }
    private void call(String command, JSONObject input, Result next) {
        if (!visible() || state.busy) return;
        state.busy = true; state.error = ""; render();
        state.runtime.command(command, input, result -> {
            state.busy = false;
            try { next.accept(result); } catch (Exception error) { state.error = error.getMessage(); }
            state.changed();
        }, error -> { state.busy = false; state.error = error; state.changed(); });
    }
    private void load() { call("localai-router-models", object("file", state.file), result -> state.models = result); }
    private void render() {
        if (body == null) return; body.removeAllViews();
        text(state.file); if (!state.error.isEmpty()) text(state.error);
        if (state.busy) text("Working…");
        if (state.models == null) { button("Read router models", this::load); return; }
        String deviceError = state.models.optString("deviceError"); if (!deviceError.isEmpty()) text(deviceError);
        if (state.draft == null) {
            JSONArray models = state.models.optJSONArray("models");
            for (int i = 0; models != null && i < models.length(); i++) { JSONObject model = models.optJSONObject(i); button("Edit " + model.optString("name"), () -> { state.original = model.optString("name"); state.name = state.original; state.draft = copy(model.optJSONObject("config")); render(); }); }
            button("Add model", () -> { state.original = null; state.name = ""; state.draft = object("model", "", "projector", "", "contextSize", 8192, "device", "none", "gpuLayers", 0, "fit", true, "cacheGpu", false, "flashAttention", "auto", "idleMinutes", 0, "extra", ""); render(); });
            button("Refresh models and devices", this::load); return;
        }
        JSONObject config = state.draft;
        field("Model name", state.name, false, value -> state.name = value);
        path("Model GGUF", config, "model", "file"); path("Optional projector GGUF", config, "projector", "file");
        field("Context length (0 uses the model default)", config.optString("contextSize"), false, value -> put(config, "contextSize", value));
        List<String> deviceIds = new ArrayList<>(Arrays.asList("none", "")), deviceLabels = new ArrayList<>(Arrays.asList("CPU", "Engine default"));
        JSONArray devices = state.models.optJSONArray("devices");
        for (int i = 0; devices != null && i < devices.length(); i++) { JSONObject device = devices.optJSONObject(i); deviceIds.add(device.optString("id")); deviceLabels.add(device.optString("label", device.optString("id"))); }
        String current = config.optString("device"); if (!deviceIds.contains(current)) { deviceIds.add(current); deviceLabels.add(current + " (saved, unavailable)"); }
        choose("Device for this model", deviceIds, deviceLabels, current, value -> {
            put(config, "device", value);
            if (!value.isEmpty()) { put(config, "gpuLayers", value.equals("none") ? 0 : "all"); put(config, "cacheGpu", !value.equals("none")); put(config, "flashAttention", "auto"); }
            render();
        });
        text("GPU layers: " + config.optString("gpuLayers") + " · CPU uses 0; selecting GPU uses all layers. Expert presets remain editable in the INI.");
        check("Fit unset parameters to available memory", config, "fit"); check("Offload KV cache to selected GPU", config, "cacheGpu");
        choose("Flash attention", Arrays.asList("auto", "on", "off"), Arrays.asList("Auto", "On", "Off"), config.optString("flashAttention"), value -> put(config, "flashAttention", value));
        String minutes = config.optString("idleMinutes", "0");
        List<String> choices = Arrays.asList("0", "1", "5", "15", "30", "60", "custom");
        String chosen = state.customIdle ? "custom" : choices.contains(minutes) ? minutes : "custom";
        choose("Unload after inactivity", choices, Arrays.asList("Indefinitely", "1 minute", "5 minutes", "15 minutes", "30 minutes", "60 minutes", "Custom minutes"), chosen, value -> { state.customIdle = value.equals("custom"); if (!state.customIdle) put(config, "idleMinutes", value); render(); });
        if (state.customIdle || chosen.equals("custom")) field("Minutes since last use (0 is indefinite)", minutes, false, value -> put(config, "idleMinutes", value));
        text("Activity resets the idle timer. Unloading frees model and KV memory. Router capacity can still evict an idle model.");
        field("Additional INI parameters", config.optString("extra"), true, value -> put(config, "extra", value));
        button("Save model", () -> save(false)); button("Save and test load", () -> save(true));
        checkStatus = text(state.testMessage);
        if (!state.testOwner.isEmpty()) button("Cancel load check", this::cancelTest);
        button("Back / add another", () -> { cancelTest(); state.draft = null; state.original = null; state.customIdle = false; render(); });
    }
    private void save(boolean test) {
        try {
            JSONObject config = copy(state.draft); config.put("contextSize", Integer.parseInt(config.optString("contextSize")));
            String layers = config.optString("gpuLayers"); config.put("gpuLayers", layers.equals("all") || layers.equals("auto") ? layers : Integer.parseInt(layers));
            config.put("idleMinutes", Double.parseDouble(config.optString("idleMinutes")));
            JSONObject input = object("file", state.file, "revision", state.models.opt("revision"), "name", state.name, "config", config);
            if (state.original != null) input.put("originalName", state.original);
            call("localai-router-model-save", input, result -> {
                state.models = result; state.original = state.name; state.error = "Saved. Reload the router to apply changes.";
                JSONArray models = result.optJSONArray("models"); for (int i = 0; models != null && i < models.length(); i++) if (models.optJSONObject(i).optString("name").equals(state.name)) state.draft = copy(models.optJSONObject(i).optJSONObject("config"));
                if (test && visible()) startTest();
            });
        } catch (Exception error) { state.error = error.getMessage(); render(); }
    }
    private void startTest() {
        if (!visible() || !state.testOwner.isEmpty()) return;
        String owner = UUID.randomUUID().toString(); state.testPolling = false; state.testOwner = owner; state.testMessage = "Loading; the model is unloaded when this check ends…";
        state.runtime.command("localai-router-model-test", object("file", state.file, "revision", state.models.opt("revision"), "name", state.original, "owner", owner), result -> {
            if (!visible() || !state.testOwner.equals(owner)) { state.runtime.command("localai-router-model-test-cancel", object("owner", owner), ignored -> {}, ignored -> {}); return; }
            updateTest(result); main.postDelayed(polling, 1000);
        }, error -> { if (state.testOwner.equals(owner)) { state.testOwner = ""; state.testMessage = error; state.changed(); } });
        render();
    }
    private void pollTest() {
        if (!visible() || state.testOwner.isEmpty() || state.testPolling) return;
        String owner = state.testOwner; state.testPolling = true;
        state.runtime.command("localai-router-model-test-status", object("owner", owner), result -> {
            state.testPolling = false; if (!visible() || !state.testOwner.equals(owner)) return;
            updateTest(result); if (!state.testOwner.isEmpty()) main.postDelayed(polling, 1000);
        }, error -> { state.testPolling = false; if (visible() && state.testOwner.equals(owner)) { state.testMessage = error; if (checkStatus != null) checkStatus.setText(error); main.postDelayed(polling, 1000); } });
    }
    private void updateTest(JSONObject result) {
        String status = result.optString("state"); boolean active = status.equals("loading") || status.equals("checking");
        state.testMessage = status.equals("passed") ? "Check passed; model unloaded." : result.isNull("error") ? status : result.optString("error");
        if (!active) { state.testOwner = ""; render(); } else if (checkStatus != null) checkStatus.setText(state.testMessage);
    }
    private void cancelTest() {
        main.removeCallbacks(polling); if (state == null || state.testOwner.isEmpty()) return;
        String owner = state.testOwner; state.testOwner = ""; state.testMessage = "Cancelling and unloading…";
        state.runtime.command("localai-router-model-test-cancel", object("owner", owner), result -> { if (state.testOwner.isEmpty()) { state.testMessage = "Cancelled; temporary router stopped."; state.changed(); } }, error -> { if (state.testOwner.isEmpty()) { state.testMessage = error; state.changed(); } });
    }
    private interface Change { void set(String value); }
    private void path(String label, JSONObject config, String key, String kind) { field(label, config.optString(key), false, value -> put(config, key, value)); button("Browse " + label, () -> picker = AgentLocalAIFilePicker.show(requireContext(), state.runtime, config.optString(key), kind, value -> { put(config, key, value); render(); })); }
    private void field(String label, String value, boolean multiline, Change change) { text(label); EditText input = new EditText(requireContext()); input.setSingleLine(!multiline); input.setText(value); input.setSaveEnabled(false); if (multiline) { input.setMinLines(3); input.setMaxLines(6); } body.addView(input); input.addTextChangedListener(new TextWatcher() { public void beforeTextChanged(CharSequence s,int a,int c,int f) {} public void afterTextChanged(Editable s) {} public void onTextChanged(CharSequence s,int a,int b,int c) { change.set(s.toString()); } }); }
    private void choose(String label, List<String> ids, List<String> labels, String value, Change change) { text(label); Spinner spinner = new Spinner(requireContext()); ArrayAdapter<String> adapter = new ArrayAdapter<>(requireContext(), android.R.layout.simple_spinner_item, labels); adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); spinner.setAdapter(adapter); spinner.setSelection(Math.max(0, ids.indexOf(value))); body.addView(spinner); String[] current = {value}; spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() { public void onNothingSelected(AdapterView<?> p) {} public void onItemSelected(AdapterView<?> p,View v,int i,long id) { if (!ids.get(i).equals(current[0])) { current[0] = ids.get(i); change.set(current[0]); } } }); }
    private void check(String label, JSONObject config, String key) { CheckBox input = new CheckBox(requireContext()); input.setText(label); input.setChecked(config.optBoolean(key)); body.addView(input); input.setOnCheckedChangeListener((v, checked) -> put(config, key, checked)); }
    private TextView text(String value) { TextView text = new TextView(requireContext()); text.setText(value); text.setPadding(0, dp(6), 0, dp(6)); body.addView(text); return text; }
    private void button(String label, Runnable action) { MaterialButton button = new MaterialButton(requireContext()); button.setText(label); button.setAllCaps(false); button.setEnabled(!state.busy); body.addView(button); button.setOnClickListener(view -> { if (visible() && !state.busy) action.run(); }); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    static JSONObject object(Object... items) { JSONObject value = new JSONObject(); for (int i = 0; i < items.length; i += 2) put(value, (String) items[i], items[i + 1]); return value; }
    private static void put(JSONObject object, String key, Object value) { try { object.put(key, value == null ? JSONObject.NULL : value); } catch (JSONException error) { throw new IllegalArgumentException(error); } }
    private static JSONObject copy(JSONObject value) { try { return new JSONObject(value.toString()); } catch (JSONException error) { throw new IllegalArgumentException(error); } }
    public static final class State extends ViewModel {
        final MutableLiveData<Integer> changes = new MutableLiveData<>(0); AgentRuntime runtime; JSONObject models, draft; String file, original, name = "", error = "", testOwner = "", testMessage = ""; boolean busy, testPolling, customIdle;
        void changed() { changes.setValue(changes.getValue() + 1); }
    }
}
