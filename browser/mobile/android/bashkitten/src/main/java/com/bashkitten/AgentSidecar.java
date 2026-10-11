// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.content.res.TypedArray;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.drawable.StateListDrawable;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import androidx.appcompat.widget.SwitchCompat;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;

/** Native responsive sidebar. Names are text; only stable backend/session IDs route. */
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
    private final FrameLayout drawer;
    private final View backdrop;
    private FrameLayout content;
    private View chatBody;
    private boolean compact = true;
    private final androidx.activity.OnBackPressedCallback back = new androidx.activity.OnBackPressedCallback(false) {
        @Override public void handleOnBackPressed() { close(); }
    };
    private JSONObject remotes = new JSONObject();
    private int background, foreground, muted, selected, line, accent, success;
    private boolean loading;
    private int generation;
    private final Runnable poll = () -> refresh();

    AgentSidecar(Activity activity, AgentRuntime runtime) {
        this.activity = activity; this.runtime = runtime; app = BrowserApp.get(activity);
        scroll = new ScrollView(activity); scroll.setFillViewport(true);
        readPalette();
        body = column(); body.setPadding(dp(8), dp(7), dp(8), dp(16)); scroll.addView(body);
        notice = text(""); notice.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        drawer = new FrameLayout(activity); drawer.setVisibility(View.GONE);
        backdrop = new View(activity); backdrop.setBackgroundColor(0x66000000); backdrop.setContentDescription("Close sidebar"); backdrop.setOnClickListener(ignored -> close());
        drawer.addView(backdrop, new FrameLayout.LayoutParams(-1, -1));
        scroll.setClickable(true); scroll.setClipToOutline(true);
        drawer.addView(scroll, new FrameLayout.LayoutParams(dp(300), -1, Gravity.START));
    }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private LinearLayout column() { LinearLayout result = new LinearLayout(activity); result.setOrientation(LinearLayout.VERTICAL); return result; }
    private LinearLayout row() { LinearLayout result = new LinearLayout(activity); result.setGravity(Gravity.CENTER_VERTICAL); return result; }
    // Same palette and geometry as web_ui.html's sidebar; follow the browser's
    // effective theme, including an explicit choice that differs from Android.
    private void readPalette() {
        TypedArray theme = activity.obtainStyledAttributes(new int[]{android.R.attr.colorBackground});
        int base; try { base = theme.getColor(0, Color.WHITE); } finally { theme.recycle(); }
        boolean dark = Color.red(base) * .299 + Color.green(base) * .587 + Color.blue(base) * .114 < 128;
        background = Color.parseColor(dark ? "#252526" : "#e8e8e8");
        foreground = Color.parseColor(dark ? "#e8e8e8" : "#242426");
        muted = Color.parseColor(dark ? "#a6a6aa" : "#66666b");
        selected = Color.parseColor(dark ? "#333337" : "#e5e5e7");
        line = Color.parseColor(dark ? "#343438" : "#dcdcdf");
        accent = Color.parseColor(dark ? "#a0a0a5" : "#5f5f65");
        success = Color.parseColor(dark ? "#6fbd86" : "#34804e");
    }
    private GradientDrawable shape(int color, int radius) {
        GradientDrawable result = new GradientDrawable(); result.setColor(color); result.setCornerRadius(dp(radius)); return result;
    }
    private void rowBackground(View view, boolean active, int radius) {
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[]{android.R.attr.state_hovered}, shape(selected, radius));
        states.addState(new int[]{android.R.attr.state_focused}, shape(selected, radius));
        states.addState(new int[]{}, shape(active ? selected : Color.TRANSPARENT, radius));
        view.setBackground(new RippleDrawable(ColorStateList.valueOf((foreground & 0x00ffffff) | 0x22000000), states, shape(Color.WHITE, radius)));
    }
    private TextView text(String value) {
        TextView result = new TextView(activity); result.setText(value); result.setTextColor(muted); result.setTextSize(13);
        result.setPadding(dp(9), dp(4), dp(9), dp(4)); return result;
    }
    private Button button(String label, Runnable action) {
        androidx.appcompat.widget.AppCompatButton result = new androidx.appcompat.widget.AppCompatButton(activity, null, androidx.appcompat.R.attr.borderlessButtonStyle);
        result.setText(label); result.setTextColor(foreground); result.setTextSize(14); result.setTypeface(null, Typeface.NORMAL);
        result.setAllCaps(false); result.setMinWidth(0); result.setMinimumWidth(0); result.setMinHeight(0); result.setMinimumHeight(0);
        result.setGravity(Gravity.START | Gravity.CENTER_VERTICAL); result.setPadding(dp(10), 0, dp(10), 0);
        result.setSingleLine(); result.setEllipsize(android.text.TextUtils.TruncateAt.END);
        result.setLayoutParams(new LinearLayout.LayoutParams(-1, dp(41)));
        result.setSupportBackgroundTintList(null); rowBackground(result, false, 12);
        result.setOnClickListener(ignored -> action.run()); return result;
    }
    private ImageButton icon(String label, int resource, Runnable action) {
        ImageButton result = AgentPanel.iconButton(activity, label, resource, action);
        result.setImageTintList(ColorStateList.valueOf(muted)); result.setPadding(dp(7), dp(7), dp(7), dp(7));
        result.setLayoutParams(new LinearLayout.LayoutParams(dp(34), dp(34))); rowBackground(result, false, 17); return result;
    }
    private void divider() { View view = new View(activity); view.setBackgroundColor(line); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(1)); params.setMargins(0, dp(7), 0, dp(7)); body.addView(view, params); }
    private MaterialAlertDialogBuilder dialog() { return new MaterialAlertDialogBuilder(activity, R.style.BashKittenSidecarDialogTheme); }
    private EditText input() {
        EditText input = new EditText(dialog().getContext()); input.setTextColor(foreground); input.setHintTextColor(muted);
        input.setBackgroundTintList(ColorStateList.valueOf(accent)); return input;
    }
    private void error(String value) { notice.setText(value); notice.setVisibility(value == null || value.isEmpty() ? View.GONE : View.VISIBLE); }
    private JSONObject value(Object... pairs) { JSONObject value = new JSONObject(); try { for (int i = 0; i < pairs.length; i += 2) value.put((String) pairs[i], pairs[i + 1]); } catch (JSONException error) { throw new IllegalArgumentException(error); } return value; }
    void attach(FrameLayout content, View chatBody) {
        this.content = content; this.chatBody = chatBody;
        content.addView(drawer, new FrameLayout.LayoutParams(-1, -1, Gravity.START));
        content.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> layout());
        layout();
    }
    public boolean isOpen() { return drawer.getVisibility() == View.VISIBLE; }
    private void layout() {
        if (content == null || content.getWidth() <= 0) return;
        compact = content.getWidth() < dp(720);
        int width = compact ? Math.min(dp(300), Math.round(content.getWidth() * .86f)) : dp(300);
        int overlayWidth = compact ? -1 : width;
        if (drawer.getLayoutParams().width != overlayWidth) { drawer.getLayoutParams().width = overlayWidth; drawer.requestLayout(); }
        if (scroll.getLayoutParams().width != width) { scroll.getLayoutParams().width = width; scroll.requestLayout(); }
        backdrop.setVisibility(compact ? View.VISIBLE : View.GONE);
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) chatBody.getLayoutParams();
        int inset = isOpen() && !compact ? width : 0;
        if (params.getMarginStart() != inset) { params.setMarginStart(inset); chatBody.setLayoutParams(params); }
        GradientDrawable surface = shape(background, 0);
        if (compact) surface.setCornerRadii(new float[]{0, 0, dp(24), dp(24), dp(24), dp(24), 0, 0});
        scroll.setBackground(surface);
    }
    public void toggle() {
        if (isOpen()) { close(); return; }
        readPalette();
        drawer.setVisibility(View.VISIBLE); layout();
        if (activity instanceof androidx.activity.ComponentActivity) {
            back.setEnabled(true); ((androidx.activity.ComponentActivity) activity).getOnBackPressedDispatcher().addCallback(back);
        }
        render(); refresh();
    }
    private void cancelSelection() {
        generation++; loading = false; app.main.removeCallbacks(poll);
        for (AgentRuntime.Listener listener : pendingSelections) runtime.detach(listener);
        pendingSelections.clear();
    }
    public void close() { cancelSelection(); back.setEnabled(false); back.remove(); drawer.setVisibility(View.GONE); layout(); }
    public void changed() { if (isOpen()) { render(); refresh(); } }
    private void refresh() {
        if (loading || !isOpen()) return;
        loading = true; final int epoch = generation;
        runtime.remotes(value -> { if (epoch == generation) { remotes = value; render(); } }, message -> { if (epoch == generation) error(message); });
        final String backend = runtime.selected;
        runtime.navigation("snapshot", value(), snapshot -> {
            if (epoch != generation) return; loading = false;
            snapshots.put(backend, snapshot); render(); app.main.removeCallbacks(poll); app.main.postDelayed(poll, 2000);
        }, message -> { if (epoch != generation) return; loading = false; app.main.removeCallbacks(poll); app.main.postDelayed(poll, 2000); });
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
            render(); if (dismiss && compact) close();
        }, this::error));
    }
    private void render() {
        final int y = scroll.getScrollY(); body.removeAllViews();
        notice.setVisibility(notice.getText().length() == 0 ? View.GONE : View.VISIBLE); body.addView(notice);
        backend("local", "Local", false);
        divider();
        section("Remotes", "Connect to remote", () -> AgentSettingsActivity.open(activity, "remotes"));
        boolean firstRemote = true;
        for (Iterator<String> keys = remotes.keys(); keys.hasNext();) {
            String id = keys.next(); JSONObject record = remotes.optJSONObject(id); if (record == null) continue;
            if (!firstRemote) divider(); firstRemote = false;
            backend(id, record.optString("name", id), true);
        }
        scroll.post(() -> scroll.scrollTo(0, y));
    }
    private void section(String title, String description, Runnable action) {
        LinearLayout heading = row(); TextView label = text(title); label.setTypeface(null, Typeface.BOLD);
        heading.addView(label, new LinearLayout.LayoutParams(0, dp(36), 1));
        Button add = button("+", action); add.setContentDescription(description); add.setTooltipText(description); add.setTextSize(20); add.setGravity(Gravity.CENTER);
        heading.addView(add, new LinearLayout.LayoutParams(dp(34), dp(34))); body.addView(heading);
    }
    private void backend(String id, String name, boolean remote) {
        LinearLayout heading = row(); Button title = button(name, () -> select(id, this::refresh)); title.setTypeface(null, Typeface.BOLD);
        heading.addView(title, new LinearLayout.LayoutParams(0, dp(41), 1));
        SwitchCompat power = new SwitchCompat(activity); power.setShowText(false); power.setContentDescription(name + " power");
        power.setSwitchMinWidth(dp(34)); power.setMinWidth(0); power.setMinimumWidth(0); power.setPadding(dp(3), 0, dp(3), 0);
        power.setThumbTintList(new ColorStateList(new int[][]{new int[]{android.R.attr.state_checked}, new int[]{}}, new int[]{accent, muted}));
        power.setTrackTintList(new ColorStateList(new int[][]{new int[]{android.R.attr.state_checked}, new int[]{}}, new int[]{(accent & 0x00ffffff) | 0x66000000, line}));
        power.setChecked(remote ? runtime.remoteConnected(id) : runtime.localIsOnRequested());
        power.setOnCheckedChangeListener((button, checked) -> runtime.setBackendOn(id, checked, this::error)); heading.addView(power);
        if (remote) heading.addView(icon(name + " actions", R.drawable.ic_agent_more, () -> remoteActions(id, name)));
        body.addView(heading);
        String status = id.equals(runtime.selected) ? runtime.state : remote ? (runtime.remoteConnected(id) ? "Connected" : "Disconnected") : (runtime.localIsOnRequested() ? "On requested" : "Off");
        title.setContentDescription(name + ", " + status); title.setTooltipText(status);
        if (id.equals(runtime.selected) && !runtime.error.isEmpty()) body.addView(text(runtime.error));
        section("Projects", "Create project in " + name, () -> select(id, () -> projectPicker(id)));
        JSONObject snapshot = snapshots.get(id);
        if (snapshot == null) { section("Chats", "New standalone chat in " + name, () -> navigate(id, "new", value(), true)); body.addView(text("Select to load chats")); return; }
        JSONArray chats = snapshot.optJSONArray("sessions"), projects = snapshot.optJSONArray("projects");
        if (chats == null) return;
        Set<String> ids = new HashSet<>(); for (int i = 0; i < chats.length(); i++) ids.add(chats.optJSONObject(i).optString("id"));
        if (projects != null) for (int i = 0; i < projects.length(); i++) {
            JSONObject project = projects.optJSONObject(i); String projectId = project.optString("id"), expansionKey = id + ":project:" + projectId;
            LinearLayout group = row();
            ImageButton expand = icon(collapsed.contains(expansionKey) ? "Expand project" : "Collapse project", R.drawable.ic_agent_folder, () -> { if (!collapsed.remove(expansionKey)) collapsed.add(expansionKey); render(); });
            group.addView(expand);
            Button projectTitle = button(project.optString("name"), () -> { if (!collapsed.remove(expansionKey)) collapsed.add(expansionKey); render(); });
            projectTitle.setTextSize(13); projectTitle.setTextColor(muted); group.addView(projectTitle, new LinearLayout.LayoutParams(0, dp(34), 1));
            Button newChat = button("+", () -> navigate(id, "new", value("projectId", projectId), true));
            newChat.setContentDescription("New chat in " + project.optString("name")); newChat.setTooltipText(newChat.getContentDescription()); newChat.setTextSize(20); newChat.setGravity(Gravity.CENTER);
            group.addView(newChat, new LinearLayout.LayoutParams(dp(34), dp(34)));
            group.addView(icon("Project actions", R.drawable.ic_agent_more, () -> select(id, () -> projectActions(id, project)))); body.addView(group);
            if (!collapsed.contains(expansionKey)) for (int j = 0; j < chats.length(); j++) { JSONObject chat = chats.optJSONObject(j); if (projectId.equals(chat.optString("projectId")) && !ids.contains(chat.optString("subagentParent"))) chat(id, chat, chats, projects, 1, new HashSet<>()); }
        }
        section("Chats", "New standalone chat in " + name, () -> navigate(id, "new", value(), true));
        for (int i = 0; i < chats.length(); i++) { JSONObject chat = chats.optJSONObject(i); if ((chat.isNull("projectId") || chat.optString("projectId").isEmpty()) && !ids.contains(chat.optString("subagentParent"))) chat(id, chat, chats, projects, 0, new HashSet<>()); }
        if (!snapshot.isNull("nextOffset")) body.addView(button("Load more chats", () -> navigate(id, "more", value(), false)));
    }
    private void chat(String backend, JSONObject chat, JSONArray all, JSONArray projects, int depth, Set<String> seen) {
        String id = chat.optString("id"); if (!seen.add(id)) return;
        LinearLayout row = row(); row.setPadding(dp(depth * 12), 0, 0, 0);
        String expansionKey = backend + ":chat:" + id; boolean hasChildren = false;
        for (int i = 0; i < all.length(); i++) if (id.equals(all.optJSONObject(i).optString("subagentParent"))) { hasChildren = true; break; }
        if (hasChildren) {
            ImageButton expand = icon(collapsed.contains(expansionKey) ? "Expand subagents" : "Collapse subagents", R.drawable.ic_agent_chevron, () -> { if (!collapsed.remove(expansionKey)) collapsed.add(expansionKey); render(); });
            expand.setRotation(collapsed.contains(expansionKey) ? 0 : 90); row.addView(expand);
        }
        Button open = button(chat.optString("title"), () -> navigate(backend, "open", value("id", id), true)); open.setTextSize(13);
        boolean active = backend.equals(runtime.selected) && id.equals(snapshots.get(backend).optString("selected"));
        rowBackground(row, active, 12); open.setSelected(active); row.addView(open, new LinearLayout.LayoutParams(0, dp(36), 1));
        if (chat.optBoolean("running")) { View dot = new View(activity); dot.setBackground(shape(success, 3)); dot.setContentDescription("Running"); LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(dp(6), dp(6)); size.setMargins(dp(3), 0, dp(3), 0); row.addView(dot, size); }
        row.addView(icon("Chat actions", R.drawable.ic_agent_more, () -> select(backend, () -> chatActions(backend, chat, projects)))); body.addView(row);
        if (!collapsed.contains(expansionKey)) for (int i = 0; i < all.length(); i++) { JSONObject child = all.optJSONObject(i); if (id.equals(child.optString("subagentParent"))) chat(backend, child, all, projects, depth + 1, seen); }
    }
    private void name(String title, String initial, Consumer<String> save) {
        EditText input = input(); input.setSingleLine(); input.setText(initial);
        dialog().setTitle(title).setView(input).setNegativeButton("Cancel", null).setPositiveButton("Save", (dialog, which) -> save.accept(input.getText().toString())).show();
    }
    private void chatActions(String backend, JSONObject chat, JSONArray projects) {
        String id = chat.optString("id");
        dialog().setTitle(chat.optString("title")).setItems(new String[]{"Rename chat", "Move to project", "Remove chat"}, (dialog, which) -> {
            if (which == 0) name("Rename chat", chat.optString("title"), name -> navigate(backend, "rename", value("id", id, "name", name), false));
            if (which == 1) {
                List<String> names = new ArrayList<>(), ids = new ArrayList<>(); names.add("No project"); ids.add("");
                if (projects != null) for (int i = 0; i < projects.length(); i++) { names.add(projects.optJSONObject(i).optString("name")); ids.add(projects.optJSONObject(i).optString("id")); }
                dialog().setTitle("Move chat").setItems(names.toArray(new String[0]), (picker, index) -> navigate(backend, "move", value("id", id, "projectId", ids.get(index)), false)).show();
            }
            if (which == 2) dialog().setTitle("Remove chat?").setMessage("Stop this chat and remove it from the list? Native Pi history and working files are kept.").setNegativeButton("Cancel", null).setPositiveButton("Remove", (confirm, index) -> navigate(backend, "remove", value("id", id), false)).show();
        }).show();
    }
    private void projectActions(String backend, JSONObject project) {
        dialog().setTitle(project.optString("name")).setItems(new String[]{"Rename project", "Remove grouping; keep chats"}, (dialog, which) -> {
            if (which == 0) name("Rename project", project.optString("name"), name -> navigate(backend, "project-rename", value("id", project.optString("id"), "name", name), false));
            else dialog().setTitle("Remove project grouping?").setMessage("Chats stay directly under this backend. Their working folders do not change.").setNegativeButton("Cancel", null).setPositiveButton("Remove", (confirm, index) -> navigate(backend, "project-remove", value("id", project.optString("id")), false)).show();
        }).show();
    }
    private void projectPicker(String backend) {
        final org.mozilla.geckoview.GeckoSession session = runtime.session;
        LinearLayout content = column(); EditText name = input(); name.setHint("Project name"); name.setSingleLine(); content.addView(name);
        TextView path = text("Loading folders…"), failure = text(""); content.addView(path);
        ScrollView folders = new ScrollView(activity); LinearLayout choices = column(); folders.addView(choices); content.addView(folders, new LinearLayout.LayoutParams(-1, dp(320))); content.addView(failure);
        androidx.appcompat.app.AlertDialog dialog = dialog().setTitle("Create project").setView(content).setNegativeButton("Cancel", null).setPositiveButton("Create", null).create();
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
    private void remoteActions(String id, String name) {
        dialog().setTitle(name).setItems(new String[]{"Rename", "Connect to phone", "Delete remote"}, (dialog, which) -> {
            if (which == 0) name("Rename remote", name, value -> runtime.renameRemote(id, value, this::refresh, this::error));
            if (which == 1) runtime.connectToPhone(id, this::refresh, this::error);
            if (which == 2) dialog().setTitle("Delete remote?").setMessage("Forget its saved login? Its machine and chats are kept.").setNegativeButton("Cancel", null).setPositiveButton("Delete", (confirm, index) -> { try { runtime.removeRemote(id, () -> { snapshots.remove(id); refresh(); }, this::error); } catch (Exception error) { error(error.getMessage()); } }).show();
        }).show();
    }
}
