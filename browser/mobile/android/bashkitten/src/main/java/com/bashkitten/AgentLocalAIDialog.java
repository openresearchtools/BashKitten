// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Dialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import androidx.appcompat.app.AppCompatDialogFragment;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import androidx.lifecycle.ViewModelProvider;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.color.MaterialColors;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import org.json.*;
import java.util.*;

/** Native Local-only editor. All execution/downloads use the shared controller. */
public final class AgentLocalAIDialog extends AppCompatDialogFragment implements AgentRuntime.Listener {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable poll = this::refreshProgress;
    private LocalState state;
    private LinearLayout body;
    private TextView progress;
    private Dialog childDialog;

    @Override public Dialog onCreateDialog(Bundle saved) {
        state = new ViewModelProvider(this).get(LocalState.class);
        if (state.runtime == null) state.runtime = BrowserApp.get(requireContext()).agent;
        MaterialAlertDialogBuilder builder = new MaterialAlertDialogBuilder(requireContext());
        body = new LinearLayout(builder.getContext()); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(dp(20), 0, dp(20), dp(8));
        ScrollView scroll = new ScrollView(body.getContext()); scroll.addView(body);
        Dialog dialog = builder.setTitle("LocalAI").setView(scroll).setNegativeButton("Close", null).create();
        state.changes.observe(this, ignored -> render()); render(); return dialog;
    }
    @Override public void onStart() { super.onStart(); state.runtime.observe(this); requireDialog().getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE); changed(); }
    @Override public void onResume() {
        super.onResume();
        if (local() && state.value == null && !state.runtime.shareNeedsSetup()) request("localai-status", new JSONObject(), result -> state.value = result);
        main.postDelayed(poll, 2000);
    }
    @Override public void onPause() { main.removeCallbacks(poll); super.onPause(); }
    @Override public void onStop() { state.runtime.detach(this); super.onStop(); }
    @Override public void onDestroyView() { body = null; progress = null; super.onDestroyView(); }
    @Override public void changed() { if (!local()) { if (childDialog != null) childDialog.dismiss(); dismissAllowingStateLoss(); } }
    private boolean local() { return state.runtime.selected.equals("local"); }
    private void request(String command, JSONObject input, Result result) {
        if (!local() || state.busy) return;
        state.busy = true; state.error = "";
        if (progress != null) progress.setText("Working…");
        state.runtime.command(command, input, value -> {
            state.busy = false;
            if (!local()) return;
            try { result.accept(value); } catch (Exception failure) { state.error = failure.getMessage(); }
            state.changed();
        }, error -> { state.busy = false; state.error = error; state.changed(); });
    }
    private interface Result { void accept(JSONObject value) throws Exception; }
    private void refreshProgress() {
        if (!isResumed() || !local() || body == null) return;
        if (!state.busy && !state.polling && state.value != null) {
            state.polling = true;
            boolean models = state.section.equals("models");
            state.runtime.command(models ? "native-models-status" : "localai-status", new JSONObject(), result -> {
                state.polling = false;
                if (!isResumed() || !local() || progress == null) return;
                if (models) {
                    state.downloads = result; JSONArray jobs = result.optJSONArray("jobs"); StringBuilder status = new StringBuilder();
                    for (int i = 0; jobs != null && i < jobs.length(); i++) { JSONObject job = jobs.optJSONObject(i); status.append(job.optString("repository")).append(" · ").append(job.optString("status")).append(String.format(Locale.getDefault(), " · %.1f / %.1f MB\n", job.optDouble("downloaded") / 1e6, job.optDouble("total") / 1e6)); }
                    progress.setText(status.toString());
                } else progress.setText(statusText(result));
            }, error -> { state.polling = false; if (isResumed() && progress != null) progress.setText(error); });
        }
        main.postDelayed(poll, 2000);
    }
    private String statusText(JSONObject value) {
        JSONObject job = value.optJSONObject("job");
        if (job != null && !job.optString("phase").isEmpty()) return job.optString("phase") + "\n" + job.optString("error");
        JSONObject engine = value.optJSONObject(state.section);
        if (engine == null) return "";
        if (state.section.equals("tts")) { JSONObject synthesis = engine.optJSONObject("synthesis"); return synthesis == null ? "" : synthesis.optString("state") + "\n" + synthesis.optString("output") + synthesis.optString("error"); }
        JSONObject service = engine.optJSONObject("service"), runtime = engine.optJSONObject("runtime");
        return (service == null ? "Not running" : service.optString("state") + " " + service.optString("error")) + "\n" + engine.optString("url", "")
            + (runtime == null ? "\nDownload the runtime to begin" : "\n" + runtime.optString("version") + " · " + runtime.optString("selectedBackend"))
            + (engine.optBoolean("savedForNextStart") ? "\nSaved changes apply on Reload" : "");
    }
    private void render() {
        if (body == null || !isAdded() || !local()) return;
        body.removeAllViews();
        if (state.runtime.shareNeedsSetup()) { text("Set up Termux Local before configuring local models."); button("Set up Local", () -> { state.runtime.turnOn(); dismiss(); }); return; }
        choose("Section", new String[]{"llama", "whisper", "tts", "models"}, new String[]{"llama.cpp router", "Whisper / Parakeet", "Speech synthesis", "Models"}, state.section, value -> { state.section = value; render(); });
        progress = text(state.value == null ? "Loading LocalAI…" : statusText(state.value));
        if (!state.error.isEmpty()) text(state.error);
        if (state.value == null) { button("Refresh", () -> request("localai-status", new JSONObject(), result -> state.value = result)); return; }
        if (state.section.equals("models")) { models(); return; }
        String engine = state.section;
        JSONObject current = state.value.optJSONObject(engine);
        if (current == null) { text("Update the Termux BashKitten package for this feature."); return; }
        JSONObject config = state.drafts.computeIfAbsent(engine, ignored -> copy(current.optJSONObject("config")));
        if (engine.equals("tts")) { tts(config); return; }
        if (engine.equals("llama")) {
            choose("Runtime", new String[]{"managed", "custom"}, new String[]{"Managed", "Custom binary"}, config.optString("mode"), value -> { put(config, "mode", value); render(); });
            if (config.optString("mode").equals("custom")) field("Termux llama-server executable", config, "binary", false);
        }
        choose("Device", new String[]{"cpu", "vulkan"}, new String[]{"CPU", "GPU (Vulkan, all layers)"}, config.optString("backend"), value -> put(config, "backend", value));
        if (config.optString("mode").equals("managed")) {
            button("Check runtime", () -> request("localai-check", object("engine", engine), result -> state.error = result.optString("version") + " · " + result.optString("backend") + (result.optBoolean("updateAvailable") ? " · Update available" : " · Up to date")));
            button("Download / update runtime", () -> request("localai-install", object("engine", engine), result -> state.error = result.optString("phase")));
            text("Save a changed device choice before downloading. GPU requires a working native Termux Vulkan driver.");
        }
        if (engine.equals("llama")) {
            field("Router INI path", config, "preset", false);
            button("Edit router INI", () -> request("localai-ini", object("file", config.optString("preset")), this::editINI));
            check("Keep router available while Agent is on (models load on demand)", config, "startup");
            check("Import this configuration into the coding agent", config, "importToPi");
            JSONObject imported = state.value.optJSONObject("import");
            if (imported != null) text("Pi import: " + imported.optString("state") + " " + imported.optString("error"));
            field("Optional application API-key file", config, "keyFile", false);
        } else {
            choose("Speech model", new String[]{"whisper", "parakeet"}, new String[]{"Whisper", "Parakeet"}, config.optString("modelKind", "whisper"), value -> {
                put(config, "modelKind", value); if (value.equals("parakeet")) { put(config, "argv", new JSONArray()); put(config, "keepRunning", false); } render();
            });
            field("Termux model path", config, "model", false);
            text("Use Models to download and select a model. The chat microphone records, transcribes and sends on this device; audio stays in memory.");
            check("Automatically send voice messages", config, "autoSend");
            if (!config.optString("modelKind").equals("parakeet")) check("Keep Whisper running after transcription", config, "keepRunning");
        }
        boolean parakeet = engine.equals("whisper") && config.optString("modelKind").equals("parakeet");
        if (!parakeet) {
            field("Port (0 chooses an available port)", config, "port", false);
            field("Command: JSON arguments, {port} for the assigned port; [] uses the starter command", config, "argv", true);
        }
        field("Working directory in Termux", config, "cwd", false);
        if (engine.equals("llama")) field("Environment (JSON object)", config, "env", true);
        JSONObject service = current.optJSONObject("service");
        if (service != null && service.optJSONObject("command") != null) {
            String command = service.optJSONObject("command").optJSONArray("argv").toString(); text(command).setTypeface(Typeface.MONOSPACE);
            button("Copy effective command", () -> copyText(command));
        }
        button("Save changes", () -> save(engine, config));
        if (!parakeet) for (String action : new String[]{"start", "stop", "reload"}) button(action.equals("start") ? "Start" : action.equals("stop") ? "Stop" : "Reload", () -> {
            Runnable dispatch = () -> request("localai-action", object("engine", engine, "action", action), result -> state.value = result);
            if (action.equals("reload")) new MaterialAlertDialogBuilder(requireContext()).setTitle("Reload engine?").setMessage("Active inference will end.").setPositiveButton("Reload", (d, w) -> dispatch.run()).setNegativeButton("Cancel", null).show(); else dispatch.run();
        });
        button("Models", () -> { state.section = "models"; render(); });
        button("Cancel runtime download", () -> request("localai-cancel", new JSONObject(), result -> state.error = result.optString("phase")));
    }
    private void save(String engine, JSONObject draft) {
        try {
            JSONObject config = copy(draft);
            config.put("port", Integer.parseInt(config.optString("port", "0")));
            if (config.opt("argv") instanceof String) config.put("argv", new JSONArray(config.getString("argv")));
            if (config.opt("env") instanceof String) config.put("env", new JSONObject(config.getString("env")));
            request("localai-save", object("engine", engine, "config", config, "revision", state.value.optString("revision")), result -> { state.value = result; state.drafts.remove(engine); state.error = "Saved. Reload applies command changes."; });
        } catch (Exception error) { state.error = error.getMessage(); render(); }
    }
    private void tts(JSONObject config) {
        text("Uses llama-tts from the managed llama.cpp runtime. Download that runtime in the router section. Reference speech is required for both model families.");
        choose("Model family", new String[]{"pocket", "qwen3"}, new String[]{"Pocket TTS", "Qwen3-TTS"}, config.optString("modelKind"), value -> put(config, "modelKind", value));
        choose("Device", new String[]{"cpu", "vulkan"}, new String[]{"CPU", "GPU (Vulkan, all layers)"}, config.optString("backend"), value -> put(config, "backend", value));
        field("Model GGUF", config, "model", false); field("Matching mmproj GGUF", config, "projector", false);
        field("Reference voice audio path", config, "voice", false); field("Language code", config, "language", false);
        button("Save changes", () -> save("tts", config));
        EditText prompt = plainField("Text to speak", state.prompt, true, value -> state.prompt = value);
        plainField("New output WAV path in Termux", state.output, false, value -> state.output = value);
        button("Generate speech", () -> request("localai-synthesize", object("text", prompt.getText().toString(), "output", state.output), result -> { state.value = result; state.prompt = ""; }));
        button("Stop synthesis", () -> request("localai-synthesis-cancel", new JSONObject(), result -> state.value = result));
        button("Models", () -> { state.section = "models"; render(); });
    }
    private void editINI(JSONObject file) {
        LinearLayout editor = new LinearLayout(body.getContext()); editor.setOrientation(LinearLayout.VERTICAL); editor.setPadding(dp(16), 0, dp(16), 0);
        EditText filename = new EditText(editor.getContext()); filename.setText(file.optString("file")); editor.addView(filename);
        EditText content = new EditText(editor.getContext()); content.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); content.setMinLines(4); content.setMaxLines(12); content.setTypeface(Typeface.MONOSPACE); content.setText(file.optString("content")); editor.addView(content);
        TextView error = new TextView(editor.getContext()); editor.addView(error);
        androidx.appcompat.app.AlertDialog dialog = new MaterialAlertDialogBuilder(requireContext()).setTitle("Router INI").setView(editor).setPositiveButton("Save", null).setNegativeButton("Cancel", null).create();
        childDialog = dialog;
        dialog.setOnShowListener(ignored -> dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            if (!local() || state.busy) return;
            String destination = filename.getText().toString();
            state.runtime.command("localai-ini", object("file", destination), existing -> {
                if (!local()) return;
                if (destination.equals(file.optString("file")) && !Objects.equals(existing.opt("revision"), file.opt("revision"))) { error.setText("The INI changed. Close and reopen the editor."); return; }
                state.runtime.command("localai-ini", object("file", destination, "revision", existing.opt("revision"), "content", content.getText().toString()), result -> {
                    JSONObject config = state.drafts.get("llama"); if (config != null) put(config, "preset", destination);
                    dialog.dismiss(); state.error = "INI saved. Save changes to select its path; Reload applies it."; render();
                }, error::setText);
            }, error::setText);
        })); dialog.show();
    }
    private void models() {
        if (state.catalogue == null) { request("native-models-catalogue", new JSONObject(), value -> state.catalogue = value); return; }
        JSONArray all = state.catalogue.optJSONArray("presets"); List<JSONObject> choices = new ArrayList<>();
        choose("Model type", new String[]{"llama", "whisper", "tts"}, new String[]{"llama.cpp", "Whisper / Parakeet", "Pocket / Qwen3-TTS"}, state.modelType, value -> { state.modelType = value; state.preset = ""; render(); });
        for (int i = 0; i < all.length(); i++) if (all.optJSONObject(i).optString("engine").equals(state.modelType)) choices.add(all.optJSONObject(i));
        String[] ids = new String[choices.size()], labels = new String[choices.size()];
        for (int i = 0; i < choices.size(); i++) { JSONObject item = choices.get(i); ids[i] = item.optString("id"); labels[i] = item.optString("title") + String.format(Locale.getDefault(), " · %.2f GB", item.optDouble("bytes") / 1e9); }
        if (state.preset.isEmpty() && ids.length > 0) state.preset = ids[0];
        choose("Download (smallest first)", ids, labels, state.preset, value -> state.preset = value);
        button("Download selected model", () -> request("native-models-preset", object("id", state.preset), result -> state.error = "Download started. It continues with this panel closed."));
        button("Refresh downloads", () -> request("native-models-status", new JSONObject(), result -> state.downloads = result));
        button("Hugging Face token", () -> {
            EditText token = new EditText(body.getContext()); token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD); token.setSaveEnabled(false); token.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
            childDialog = new MaterialAlertDialogBuilder(requireContext()).setTitle("Optional Hugging Face token").setMessage("Saved privately in Termux for gated models.").setView(token)
                .setPositiveButton("Save", (d, w) -> { String value = token.getText().toString(); token.setText(""); request("native-models-settings", object("token", value), result -> state.error = "Token saved privately"); })
                .setNeutralButton("Remove token", (d, w) -> request("native-models-settings", object("token", ""), result -> state.error = "Token removed"))
                .setNegativeButton("Cancel", (d, w) -> token.setText("")).show();
        });
        if (state.downloads != null) {
            JSONObject settings = state.settings;
            if (settings == null) { settings = object("directory", state.downloads.optString("directory")); state.settings = settings; }
            field("Models directory in Termux home", settings, "directory", false);
            JSONObject finalSettings = settings;
            button("Save models directory", () -> request("native-models-settings", finalSettings, result -> state.error = "Models directory saved"));
            JSONArray jobs = state.downloads.optJSONArray("jobs");
            for (int i = 0; jobs != null && i < jobs.length(); i++) {
                JSONObject job = jobs.optJSONObject(i); text(job.optString("repository") + " · " + job.optString("status"));
                if (!job.optString("error").isEmpty()) text(job.optString("error"));
                JSONArray files = job.optJSONArray("files");
                for (int j = 0; files != null && j < files.length(); j++) { JSONObject file = files.optJSONObject(j); text(file.optString("path") + String.format(Locale.getDefault(), " · %.1f / %.1f MB", file.optDouble("downloaded") / 1e6, file.optDouble("size") / 1e6)); }
                if (job.optString("status").equals("complete")) {
                    for (int j = 0; j < all.length(); j++) {
                        JSONObject preset = all.optJSONObject(j); if (!preset.optString("repository").equals(job.optString("repository"))) continue;
                        JSONArray required = preset.optJSONArray("files"); List<String> paths = new ArrayList<>();
                        for (int k = 0; k < required.length(); k++) for (int n = 0; n < files.length(); n++) { JSONObject file = files.optJSONObject(n); if (file.optString("path").equals(required.optString(k)) && file.optString("status").equals("complete")) paths.add(job.optString("directory") + "/" + file.optString("outputPath")); }
                        if (paths.size() != required.length()) continue;
                        button("Use " + preset.optString("title"), () -> request("localai-model-use", object("engine", preset.optString("engine"), "kind", preset.optString("kind"), "file", paths.get(0), "projector", paths.size() > 1 ? paths.get(1) : ""), result -> { state.value = result; state.drafts.remove(preset.optString("engine")); state.error = "Model selected. Reload the router to apply a new entry."; }));
                    }
                } else if (!job.optString("status").equals("cancelled")) for (String action : new String[]{"pause", "resume", "cancel"}) button(action + " download", () -> request("native-models-action", object("id", job.optString("id"), "action", action), result -> state.error = "Download " + action));
            }
        }
        plainField("Search Hugging Face / owner/repository", state.query, false, value -> state.query = value);
        button("Search", () -> request("native-models-search", object("query", state.query, "type", state.modelType.equals("whisper") ? "whisper" : "llama"), result -> state.search = result));
        button("Open repository", () -> request("native-models-repository", object("id", state.query), this::repository));
        JSONArray results = state.search == null ? null : state.search.optJSONArray("models");
        for (int i = 0; results != null && i < results.length(); i++) { String id = results.optJSONObject(i).optString("id"); button(id, () -> request("native-models-repository", object("id", id), this::repository)); }
    }
    private void repository(JSONObject repository) {
        JSONArray files = repository.optJSONArray("files"); List<String> names = new ArrayList<>(); List<String> labels = new ArrayList<>();
        for (int i = 0; i < files.length(); i++) { JSONObject file = files.optJSONObject(i); if (state.modelType.equals("whisper") ? file.optBoolean("whisper") : file.optBoolean("gguf")) { names.add(file.optString("path")); labels.add(file.optString("path") + String.format(Locale.getDefault(), " · %.2f GB", file.optDouble("size") / 1e9)); } }
        boolean[] selected = new boolean[names.size()];
        childDialog = new MaterialAlertDialogBuilder(requireContext()).setTitle(repository.optString("id")).setMultiChoiceItems(labels.toArray(new String[0]), selected, (d, which, checked) -> selected[which] = checked)
            .setPositiveButton("Download", (d, w) -> { JSONArray chosen = new JSONArray(); for (int i = 0; i < names.size(); i++) if (selected[i]) chosen.put(names.get(i)); request("native-models-download", object("id", repository.optString("id"), "revision", repository.optString("revision"), "files", chosen), result -> state.error = "Download started"); }).setNegativeButton("Cancel", null).show();
    }
    private interface Changed { void accept(String value); }
    private void choose(String label, String[] ids, String[] labels, String current, Changed changed) {
        text(label); Spinner spinner = new Spinner(body.getContext()); ArrayAdapter<String> adapter = new ArrayAdapter<>(body.getContext(), android.R.layout.simple_spinner_item, labels); adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); spinner.setAdapter(adapter);
        int index = Arrays.asList(ids).indexOf(current); spinner.setSelection(Math.max(0, index)); body.addView(spinner);
        String[] selected = { current };
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() { public void onNothingSelected(AdapterView<?> p) {} public void onItemSelected(AdapterView<?> p, View view, int position, long id) { if (position >= 0 && position < ids.length && !ids[position].equals(selected[0])) { selected[0] = ids[position]; changed.accept(ids[position]); } } });
    }
    private EditText plainField(String label, String value, boolean multiline, Changed changed) {
        text(label); EditText input = new EditText(body.getContext()); input.setText(value); input.setSingleLine(!multiline); input.setSaveEnabled(false);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS | (multiline ? InputType.TYPE_TEXT_FLAG_MULTI_LINE : 0));
        if (multiline) { input.setMinLines(3); input.setMaxLines(4); input.setTypeface(Typeface.MONOSPACE); }
        body.addView(input); input.addTextChangedListener(new TextWatcher() { public void beforeTextChanged(CharSequence s, int a, int c, int f) {} public void afterTextChanged(Editable s) {} public void onTextChanged(CharSequence s, int a, int b, int c) { changed.accept(s.toString()); } }); return input;
    }
    private void field(String label, JSONObject config, String key, boolean multiline) { plainField(label, config.optString(key), multiline, value -> put(config, key, value)); }
    private void check(String label, JSONObject config, String key) { CheckBox box = new CheckBox(body.getContext()); box.setText(label); box.setChecked(config.optBoolean(key)); body.addView(box); box.setOnCheckedChangeListener((view, checked) -> put(config, key, checked)); }
    private TextView text(String value) { TextView view = new TextView(body.getContext()); view.setText(value); view.setTextSize(14); view.setTextColor(MaterialColors.getColor(view, com.google.android.material.R.attr.colorOnSurface)); view.setPadding(0, dp(6), 0, dp(6)); body.addView(view); return view; }
    private void button(String label, Runnable action) { MaterialButton button = new MaterialButton(body.getContext()); button.setText(label); button.setAllCaps(false); button.setCornerRadius(dp(24)); button.setEnabled(!state.busy); body.addView(button, new LinearLayout.LayoutParams(-1, -2)); button.setOnClickListener(ignored -> { if (local() && !state.busy) action.run(); }); }
    private void copyText(String text) { ((ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("LocalAI", text)); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private static JSONObject object(Object... items) { JSONObject value = new JSONObject(); for (int i = 0; i < items.length; i += 2) put(value, (String) items[i], items[i + 1]); return value; }
    private static void put(JSONObject value, String key, Object item) { try { value.put(key, item); } catch (JSONException error) { throw new IllegalArgumentException(error); } }
    private static JSONObject copy(JSONObject value) { try { return new JSONObject(value.toString()); } catch (JSONException error) { throw new IllegalArgumentException(error); } }
    public static final class LocalState extends ViewModel {
        final MutableLiveData<Integer> changes = new MutableLiveData<>(0);
        final Map<String, JSONObject> drafts = new HashMap<>();
        AgentRuntime runtime; JSONObject value, catalogue, downloads, search, settings;
        String section = "llama", modelType = "llama", preset = "", query = "", prompt = "", output = "", error = "";
        boolean busy, polling, closed;
        void changed() { if (!closed) changes.setValue(changes.getValue() + 1); }
        @Override protected void onCleared() { closed = true; prompt = ""; }
    }
}
