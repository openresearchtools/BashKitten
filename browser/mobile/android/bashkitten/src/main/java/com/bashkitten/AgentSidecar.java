// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import androidx.appcompat.widget.SwitchCompat;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;

/** Native narrow-screen drawer. Names are text; only stable backend/session IDs route. */
public final class AgentSidecar {
    private final Activity activity;
    private final AgentRuntime runtime;
    private final BrowserApp app;
    private final Map<String, JSONObject> snapshots = new LinkedHashMap<>();
    private final Set<String> collapsed = new HashSet<>();
    private final Set<AgentRuntime.Listener> pendingSelections = new HashSet<>();
    private final ScrollView scroll;
    private final LinearLayout body;
    private final TextView notice;
    private PopupWindow popup;
    private JSONObject remotes = new JSONObject();
    private boolean loading;
    private int generation;
    private final Runnable poll = () -> refresh();

    AgentSidecar(Activity activity, AgentRuntime runtime) {
        this.activity = activity; this.runtime = runtime; app = BrowserApp.get(activity);
        scroll = new ScrollView(activity); scroll.setFillViewport(true);
        body = column(); body.setPadding(dp(12), dp(12), dp(12), dp(20)); scroll.addView(body);
        notice = text(""); notice.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private LinearLayout column() { LinearLayout result = new LinearLayout(activity); result.setOrientation(LinearLayout.VERTICAL); return result; }
    private LinearLayout row() { LinearLayout result = new LinearLayout(activity); result.setGravity(Gravity.CENTER_VERTICAL); return result; }
    private TextView text(String value) { TextView result = new TextView(activity); result.setText(value); result.setPadding(dp(6), dp(4), dp(6), dp(4)); return result; }
    private Button button(String label, Runnable action) {
        androidx.appcompat.widget.AppCompatButton result = new androidx.appcompat.widget.AppCompatButton(activity, null, androidx.appcompat.R.attr.borderlessButtonStyle);
        result.setText(label); result.setAllCaps(false); result.setMinWidth(0); result.setMinimumWidth(0); result.setPadding(dp(6), 0, dp(6), 0);
        result.setOnClickListener(ignored -> action.run()); return result;
    }
    private void error(String value) { notice.setText(value); }
    private JSONObject value(Object... pairs) { JSONObject value = new JSONObject(); try { for (int i = 0; i < pairs.length; i += 2) value.put((String) pairs[i], pairs[i + 1]); } catch (JSONException error) { throw new IllegalArgumentException(error); } return value; }
    public void show(View anchor) {
        if (popup != null && popup.isShowing()) { popup.dismiss(); return; }
        android.content.res.TypedArray theme = activity.obtainStyledAttributes(new int[]{android.R.attr.colorBackground});
        int color; try { color = theme.getColor(0, Color.DKGRAY); } finally { theme.recycle(); }
        popup = new PopupWindow(scroll, Math.min(dp(360), activity.getResources().getDisplayMetrics().widthPixels), -1, true);
        popup.setBackgroundDrawable(new ColorDrawable(color)); popup.setOutsideTouchable(true); popup.setElevation(dp(16));
        popup.setOnDismissListener(this::cancelSelection);
        popup.showAtLocation(anchor, Gravity.START | Gravity.TOP, 0, 0); render(); refresh();
    }
    private void cancelSelection() {
        generation++; app.main.removeCallbacks(poll);
        for (AgentRuntime.Listener listener : pendingSelections) runtime.detach(listener);
        pendingSelections.clear();
    }
    public void close() { cancelSelection(); if (popup != null) popup.dismiss(); }
    public void changed() { if (popup != null && popup.isShowing()) { render(); refresh(); } }
    private void refresh() {
        if (loading || popup == null || !popup.isShowing()) return;
        loading = true; final int epoch = generation;
        runtime.remotes(value -> { if (epoch == generation) { remotes = value; render(); } }, this::error);
        final String backend = runtime.selected;
        runtime.navigation("snapshot", value(), snapshot -> {
            loading = false; if (epoch != generation) return;
            snapshots.put(backend, snapshot); render(); app.main.removeCallbacks(poll); app.main.postDelayed(poll, 2000);
        }, message -> { loading = false; if (epoch != generation) return; app.main.removeCallbacks(poll); app.main.postDelayed(poll, 2000); });
    }
    private void awaitReady(String backend, Runnable ready, int epoch, long until) {
        if (epoch != generation || !backend.equals(runtime.selected)) return;
        runtime.navigation("snapshot", value(), snapshot -> {
            if (epoch != generation || !backend.equals(runtime.selected)) return;
            snapshots.put(backend, snapshot); ready.run();
        }, message -> {
            if (epoch != generation || !backend.equals(runtime.selected)) return;
            if (!runtime.state.equals("on") || android.os.SystemClock.elapsedRealtime() >= until) { error(message); return; }
            app.main.postDelayed(() -> awaitReady(backend, ready, epoch, until), 200);
        });
    }
    private void select(String backend, Runnable ready) {
        if (backend.equals(runtime.selected) && runtime.state.equals("on")) { awaitReady(backend, ready, generation, android.os.SystemClock.elapsedRealtime() + 30000); return; }
        if (backend.equals(runtime.selected) && !runtime.isOnRequested()) runtime.turnOn();
        else runtime.select(backend);
        final int epoch = generation;
        AgentRuntime.Listener observer = new AgentRuntime.Listener() {
            @Override public void changed() {
                if (epoch != generation || !backend.equals(runtime.selected)) { runtime.detach(this); pendingSelections.remove(this); return; }
                if (runtime.state.equals("on")) { runtime.detach(this); pendingSelections.remove(this); awaitReady(backend, ready, epoch, android.os.SystemClock.elapsedRealtime() + 30000); }
                else if (Arrays.asList("failed", "off", "stop-failed", "setup").contains(runtime.state)) { runtime.detach(this); pendingSelections.remove(this); error(runtime.error); }
            }
        };
        pendingSelections.add(observer); runtime.observe(observer); observer.changed();
    }
    private void navigate(String backend, String action, JSONObject value, boolean dismiss) {
        select(backend, () -> runtime.navigation(action, value, snapshot -> {
            if (snapshot.has("sessions")) snapshots.put(backend, snapshot);
            render(); if (dismiss && popup != null) popup.dismiss();
        }, this::error));
    }
    private void render() {
        final int y = scroll.getScrollY(); body.removeAllViews();
        body.addView(button("Close", () -> popup.dismiss())); body.addView(notice);
        backend("local", "Local", false);
        for (Iterator<String> keys = remotes.keys(); keys.hasNext();) { String id = keys.next(); JSONObject record = remotes.optJSONObject(id); if (record != null) backend(id, record.optString("name", id), true); }
        scroll.post(() -> scroll.scrollTo(0, y));
    }
    private void backend(String id, String name, boolean remote) {
        LinearLayout heading = row(); Button title = button(name, () -> select(id, this::refresh)); title.setSingleLine(); title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        heading.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
        SwitchCompat power = new SwitchCompat(activity); power.setShowText(false); power.setContentDescription(name + " power");
        power.setChecked(remote ? runtime.remoteConnected(id) : runtime.localIsOnRequested());
        power.setOnCheckedChangeListener((button, checked) -> runtime.setBackendOn(id, checked, this::error)); heading.addView(power);
        if (remote) heading.addView(button("⋯", () -> remoteActions(id, name)));
        else { heading.addView(button("⚙", this::localSettings)); heading.addView(button("▣", () -> com.bashkitten.display.DisplayTabs.open(activity, "local"))); }
        body.addView(heading);
        String status = id.equals(runtime.selected) ? runtime.state : remote ? (runtime.remoteConnected(id) ? "Connected" : "Disconnected") : (runtime.localIsOnRequested() ? "On requested" : "Off");
        body.addView(text(status));
        if (id.equals(runtime.selected) && !runtime.error.isEmpty()) body.addView(text(runtime.error));
        LinearLayout tools = row(); tools.addView(button("+ Chat", () -> navigate(id, "new", value(), true)));
        tools.addView(button("+ Project", () -> select(id, () -> projectPicker(id)))); body.addView(tools);
        JSONObject snapshot = snapshots.get(id);
        if (snapshot == null) { body.addView(text("Select to load chats")); return; }
        JSONArray chats = snapshot.optJSONArray("sessions"), projects = snapshot.optJSONArray("projects");
        if (chats == null) return;
        Set<String> ids = new HashSet<>(); for (int i = 0; i < chats.length(); i++) ids.add(chats.optJSONObject(i).optString("id"));
        for (int i = 0; i < chats.length(); i++) { JSONObject chat = chats.optJSONObject(i); if ((chat.isNull("projectId") || chat.optString("projectId").isEmpty()) && !ids.contains(chat.optString("subagentParent"))) chat(id, chat, chats, projects, 0, new HashSet<>()); }
        if (projects != null) for (int i = 0; i < projects.length(); i++) {
            JSONObject project = projects.optJSONObject(i); String projectId = project.optString("id"), expansionKey = id + ":project:" + projectId;
            LinearLayout group = row(); group.addView(button((collapsed.contains(expansionKey) ? "▸ " : "▾ ") + project.optString("name"), () -> { if (!collapsed.remove(expansionKey)) collapsed.add(expansionKey); render(); }), new LinearLayout.LayoutParams(0, dp(44), 1));
            group.addView(button("+", () -> navigate(id, "new", value("projectId", projectId), true)));
            group.addView(button("⋯", () -> select(id, () -> projectActions(id, project)))); body.addView(group);
            if (!collapsed.contains(expansionKey)) for (int j = 0; j < chats.length(); j++) { JSONObject chat = chats.optJSONObject(j); if (projectId.equals(chat.optString("projectId")) && !ids.contains(chat.optString("subagentParent"))) chat(id, chat, chats, projects, 1, new HashSet<>()); }
        }
        if (!snapshot.isNull("nextOffset")) body.addView(button("Load more chats", () -> navigate(id, "more", value(), false)));
    }
    private void chat(String backend, JSONObject chat, JSONArray all, JSONArray projects, int depth, Set<String> seen) {
        String id = chat.optString("id"); if (!seen.add(id)) return;
        LinearLayout row = row(); row.setPadding(dp(depth * 12), 0, 0, 0);
        String expansionKey = backend + ":chat:" + id; boolean hasChildren = false;
        for (int i = 0; i < all.length(); i++) if (id.equals(all.optJSONObject(i).optString("subagentParent"))) { hasChildren = true; break; }
        if (hasChildren) row.addView(button(collapsed.contains(expansionKey) ? "▸" : "▾", () -> { if (!collapsed.remove(expansionKey)) collapsed.add(expansionKey); render(); }));
        Button open = button((chat.optBoolean("running") ? "● " : "") + chat.optString("title"), () -> navigate(backend, "open", value("id", id), true));
        open.setTypeface(null, backend.equals(runtime.selected) && id.equals(snapshots.get(backend).optString("selected")) ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        open.setSingleLine(); open.setEllipsize(android.text.TextUtils.TruncateAt.END); row.addView(open, new LinearLayout.LayoutParams(0, dp(44), 1));
        row.addView(button("⋯", () -> select(backend, () -> chatActions(backend, chat, projects)))); body.addView(row);
        if (!collapsed.contains(expansionKey)) for (int i = 0; i < all.length(); i++) { JSONObject child = all.optJSONObject(i); if (id.equals(child.optString("subagentParent"))) chat(backend, child, all, projects, depth + 1, seen); }
    }
    private void name(String title, String initial, Consumer<String> save) {
        EditText input = new EditText(activity); input.setSingleLine(); input.setText(initial);
        new MaterialAlertDialogBuilder(activity).setTitle(title).setView(input).setNegativeButton("Cancel", null).setPositiveButton("Save", (dialog, which) -> save.accept(input.getText().toString())).show();
    }
    private void chatActions(String backend, JSONObject chat, JSONArray projects) {
        String id = chat.optString("id");
        new MaterialAlertDialogBuilder(activity).setTitle(chat.optString("title")).setItems(new String[]{"Rename chat", "Move to project", "Remove chat"}, (dialog, which) -> {
            if (which == 0) name("Rename chat", chat.optString("title"), name -> navigate(backend, "rename", value("id", id, "name", name), false));
            if (which == 1) {
                List<String> names = new ArrayList<>(), ids = new ArrayList<>(); names.add("No project"); ids.add("");
                if (projects != null) for (int i = 0; i < projects.length(); i++) { names.add(projects.optJSONObject(i).optString("name")); ids.add(projects.optJSONObject(i).optString("id")); }
                new MaterialAlertDialogBuilder(activity).setTitle("Move chat").setItems(names.toArray(new String[0]), (picker, index) -> navigate(backend, "move", value("id", id, "projectId", ids.get(index)), false)).show();
            }
            if (which == 2) new MaterialAlertDialogBuilder(activity).setTitle("Remove chat?").setMessage("Stop this chat and remove it from the list? Native Pi history and working files are kept.").setNegativeButton("Cancel", null).setPositiveButton("Remove", (confirm, index) -> navigate(backend, "remove", value("id", id), false)).show();
        }).show();
    }
    private void projectActions(String backend, JSONObject project) {
        new MaterialAlertDialogBuilder(activity).setTitle(project.optString("name")).setItems(new String[]{"Rename project", "Remove grouping; keep chats"}, (dialog, which) -> {
            if (which == 0) name("Rename project", project.optString("name"), name -> navigate(backend, "project-rename", value("id", project.optString("id"), "name", name), false));
            else new MaterialAlertDialogBuilder(activity).setTitle("Remove project grouping?").setMessage("Chats stay directly under this backend. Their working folders do not change.").setNegativeButton("Cancel", null).setPositiveButton("Remove", (confirm, index) -> navigate(backend, "project-remove", value("id", project.optString("id")), false)).show();
        }).show();
    }
    private void projectPicker(String backend) {
        final org.mozilla.geckoview.GeckoSession session = runtime.session;
        LinearLayout content = column(); EditText name = new EditText(activity); name.setHint("Project name"); name.setSingleLine(); content.addView(name);
        TextView path = text("Loading folders…"), failure = text(""); content.addView(path);
        ScrollView folders = new ScrollView(activity); LinearLayout choices = column(); folders.addView(choices); content.addView(folders, new LinearLayout.LayoutParams(-1, dp(320))); content.addView(failure);
        androidx.appcompat.app.AlertDialog dialog = new MaterialAlertDialogBuilder(activity).setTitle("Create project").setView(content).setNegativeButton("Cancel", null).setPositiveButton("Create", null).create();
        final String requestId = UUID.randomUUID().toString();
        dialog.setOnDismissListener(ignored -> { if (backend.equals(runtime.selected) && session == runtime.session) runtime.navigation("folders-cancel", value("requestId", requestId), result -> {}, message -> {}); });
        final String[] selected = {null}; final int[] request = {0};
        Consumer<String> load = new Consumer<>() {
            @Override public void accept(String directory) {
                if (!dialog.isShowing() || !backend.equals(runtime.selected) || session != runtime.session) { failure.setText("The selected backend changed."); return; }
                int epoch = ++request[0];
                runtime.navigation("folders", value("path", directory, "requestId", requestId), result -> {
                    if (!dialog.isShowing() || epoch != request[0] || !backend.equals(runtime.selected) || session != runtime.session) return;
                    selected[0] = result.optString("path"); path.setText(result.optString("displayPath")); choices.removeAllViews();
                    if (!result.isNull("parent")) choices.addView(button("↑ Parent", () -> accept(result.optString("parent"))));
                    JSONArray list = result.optJSONArray("folders"); if (list != null) for (int i = 0; i < list.length(); i++) { JSONObject folder = list.optJSONObject(i); choices.addView(button(folder.optString("name"), () -> accept(folder.optString("path")))); }
                }, failure::setText);
            }
        };
        dialog.setOnShowListener(ignored -> dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            if (selected[0] == null || !backend.equals(runtime.selected) || session != runtime.session) { failure.setText("Choose a folder on this backend."); return; }
            runtime.navigation("project-create", value("name", name.getText().toString(), "cwd", selected[0]), result -> { snapshots.put(backend, result); dialog.dismiss(); render(); }, failure::setText);
        })); dialog.show(); load.accept("~");
    }
    private void localSettings() {
        new MaterialAlertDialogBuilder(activity).setTitle("Local settings").setItems(new String[]{"Chat settings", "LocalAI", "Display setup", "Share Local"}, (dialog, which) -> {
            if (which == 0) navigate("local", "settings", value(), true);
            if (which == 1) new AgentLocalAIDialog().show(((androidx.fragment.app.FragmentActivity) activity).getSupportFragmentManager(), "agent-localai");
            if (which == 2) new AgentDisplayDialog().show(((androidx.fragment.app.FragmentActivity) activity).getSupportFragmentManager(), "agent-display");
            if (which == 3) activity.startActivity(new Intent(activity, AgentShareActivity.class));
        }).show();
    }
    private void remoteActions(String id, String name) {
        new MaterialAlertDialogBuilder(activity).setTitle(name).setItems(new String[]{"Rename", "Connect to phone", "Delete remote"}, (dialog, which) -> {
            if (which == 0) name("Rename remote", name, value -> runtime.renameRemote(id, value, this::refresh, this::error));
            if (which == 1) runtime.connectToPhone(id, this::refresh, this::error);
            if (which == 2) new MaterialAlertDialogBuilder(activity).setTitle("Delete remote?").setMessage("Forget its saved login? Its machine and chats are kept.").setNegativeButton("Cancel", null).setPositiveButton("Delete", (confirm, index) -> { try { runtime.removeRemote(id, () -> { snapshots.remove(id); refresh(); }, this::error); } catch (Exception error) { error(error.getMessage()); } }).show();
        }).show();
    }
}
