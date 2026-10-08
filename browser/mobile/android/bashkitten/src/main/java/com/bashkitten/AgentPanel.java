// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.res.TypedArray;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import androidx.appcompat.widget.AppCompatButton;
import androidx.appcompat.widget.SwitchCompat;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import java.io.*;
import java.net.URI;
import java.util.*;
import org.json.*;
import org.mozilla.geckoview.*;

/** Browser-owned protected panel, outside the ordinary tab registry and extension APIs. */
public final class AgentPanel extends LinearLayout implements AgentRuntime.Listener {
    private final Activity activity;
    private final BrowserApp app;
    private final AgentRuntime runtime;
    private final View browser;
    private final LinearLayout agent, bar, body;
    private final Button location, hideAgent;
    private final SwitchCompat power;
    private final ImageButton display, localAI;
    private final GeckoView view;
    private final ScrollView setup;
    private final ScrollView logScroll;
    private final TextView message, log, connectionStatus;
    private final LinearLayout actions;
    private GeckoSession attached;
    private AgentMicrophone microphone;
    private String renderedState = "";
    private String connectionError = "";
    private boolean shown = true;
    private boolean split;
    private boolean browserUi;
    private boolean destroyed;
    private boolean updatingPower;
    private GeckoSession.PromptDelegate.FilePrompt filePrompt;
    private GeckoResult<GeckoSession.PromptDelegate.PromptResponse> fileResult;
    public static final int FILE_REQUEST = 7310, TERMUX_PERMISSION = 7311, NOTIFICATION_PERMISSION = 7312, BATTERY_PERMISSION = 7313;
    public AgentPanel(Activity activity, View browser, GeckoRuntime engine, int agentIcon, Runnable openBrowserMenu) {
        super(activity); this.activity = activity; this.browser = browser;
        app = BrowserApp.get(activity); runtime = app.agent;
        runtime.activity = new java.lang.ref.WeakReference<>(activity);
        setOrientation(HORIZONTAL);
        // Weighted panes must keep a bounded height: baseline alignment first
        // measures them with UNSPECIFIED constraints, which Compose cannot scroll in.
        setBaselineAligned(false);
        agent = new LinearLayout(activity); agent.setOrientation(VERTICAL);
        bar = new LinearLayout(activity); bar.setGravity(Gravity.CENTER_VERTICAL); agent.addView(bar, new LayoutParams(-1, dp(48)));
        TypedArray barTheme = activity.obtainStyledAttributes(new int[]{android.R.attr.colorBackground});
        try { bar.setBackgroundColor(barTheme.getColor(0, 0)); } finally { barTheme.recycle(); }
        androidx.appcompat.widget.AppCompatImageButton toggle = new androidx.appcompat.widget.AppCompatImageButton(activity);
        toggle.setImageResource(agentIcon); toggle.setContentDescription("Agent");
        toggle.setScaleType(ImageView.ScaleType.FIT_CENTER); toggle.setPadding(dp(10), dp(10), dp(10), dp(10));
        TypedArray buttonTheme = activity.obtainStyledAttributes(new int[]{android.R.attr.selectableItemBackgroundBorderless});
        try { toggle.setBackground(buttonTheme.getDrawable(0)); } finally { buttonTheme.recycle(); }
        toggle.setOnClickListener(v -> toggle()); bar.addView(toggle, new LayoutParams(dp(48), -1));
        power = new SwitchCompat(activity);
        power.setShowText(false); power.setTextOn("On"); power.setTextOff("Off");
        power.setContentDescription("Agent power"); power.setGravity(Gravity.CENTER);
        power.setSwitchMinWidth(dp(40)); power.setMinWidth(0); power.setMinimumWidth(0);
        power.setPadding(dp(4), 0, dp(4), 0);
        power.setOnCheckedChangeListener((button, checked) -> {
            if (updatingPower) return;
            if (!checked || runtime.state.equals("stop-failed")) runtime.turnOff(); else runtime.turnOn();
            updatePower();
        });
        bar.addView(power, new LayoutParams(dp(56), -1));
        location = barButton("Local", () -> activity.startActivity(new Intent(activity, AgentRemotesActivity.class))); bar.addView(location, new LayoutParams(0, -1, 1));
        display = barIcon("Display", R.drawable.ic_agent_display, () -> {
            if (runtime.selected.equals("local")) new AgentDisplayDialog().show(
                ((androidx.fragment.app.FragmentActivity) activity).getSupportFragmentManager(), "agent-display");
        });
        bar.addView(display, new LayoutParams(dp(40), -1));
        localAI = barIcon("LocalAI", R.drawable.ic_agent_localai, () -> {
            if (runtime.selected.equals("local")) new AgentLocalAIDialog().show(
                ((androidx.fragment.app.FragmentActivity) activity).getSupportFragmentManager(), "agent-localai");
        });
        bar.addView(localAI, new LayoutParams(dp(40), -1));
        bar.addView(barIcon("Performance", R.drawable.ic_agent_performance, () -> new AgentPerformanceDialog().show(
            ((androidx.fragment.app.FragmentActivity) activity).getSupportFragmentManager(), "agent-performance")), new LayoutParams(dp(40), -1));
        Button menu = barButton("☰", openBrowserMenu); menu.setContentDescription("Browser menu"); bar.addView(menu, new LayoutParams(dp(48), -1));
        hideAgent = barButton("−", () -> { split = false; layoutPanels(); });
        hideAgent.setContentDescription("Hide Agent pane"); bar.addView(hideAgent, new LayoutParams(dp(40), -1));
        body = new LinearLayout(activity); body.setOrientation(VERTICAL); agent.addView(body, new LayoutParams(-1, 0, 1));
        connectionStatus = text();
        connectionStatus.setPadding(dp(16), dp(8), dp(16), dp(8));
        connectionStatus.setText("Connecting to Agent…"); connectionStatus.setVisibility(GONE);
        body.addView(connectionStatus, new LayoutParams(-1, -2));
        view = new GeckoView(activity); body.addView(view, new LayoutParams(-1, 0, 1));
        setup = new ScrollView(activity); setup.setFillViewport(true);
        LinearLayout setupBody = new LinearLayout(activity); setupBody.setPadding(dp(24), dp(28), dp(24), dp(24)); setupBody.setOrientation(VERTICAL); setup.addView(setupBody);
        ImageView logo = new ImageView(activity); logo.setImageResource(agentIcon);
        logo.setContentDescription("BashKitten"); logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        setupBody.addView(logo, new LayoutParams(dp(32), dp(32)));
        message = text(); message.setTextSize(16); message.setPadding(0, dp(12), 0, dp(20)); setupBody.addView(message);
        actions = new LinearLayout(activity); actions.setOrientation(VERTICAL); setupBody.addView(actions);
        log = text(); log.setTextSize(12); log.setTypeface(android.graphics.Typeface.MONOSPACE); log.setTextIsSelectable(true);
        logScroll = new ScrollView(activity); logScroll.setNestedScrollingEnabled(true); logScroll.addView(log); logScroll.setVisibility(GONE);
        setupBody.addView(logScroll, new LayoutParams(-1, dp(240)));
        body.addView(setup, new LayoutParams(-1, 0, 1));
        addView(agent); addView(browser);
        runtime.attach(engine, this);
        setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                int types = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout();
                // Fenix enables edge-to-edge from API 33. Its ordinary browser
                // fragment handles IME space, but this separate Agent GeckoView
                // must resize too, including while it shows account/2FA pages.
                // Older activities retain the framework's adjustResize behavior.
                if (Build.VERSION.SDK_INT >= 33) types |= WindowInsets.Type.ime();
                android.graphics.Insets i = insets.getInsets(types);
                // Fenix pads the content root for browser fragments but forwards
                // their insets unchanged. Apply only the remaining inset to Agent.
                View content = activity.findViewById(android.R.id.content);
                agent.setPadding(
                    Math.max(0, i.left - content.getPaddingLeft()),
                    Math.max(0, i.top - content.getPaddingTop()),
                    Math.max(0, i.right - content.getPaddingRight()),
                    Math.max(0, i.bottom - content.getPaddingBottom()));
            }
            return insets;
        });
        layoutPanels(); changed();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text() {
        TextView label = new TextView(activity);
        TypedArray theme = activity.obtainStyledAttributes(new int[]{android.R.attr.textColorPrimary});
        try { label.setTextColor(theme.getColorStateList(0)); } finally { theme.recycle(); }
        return label;
    }
    private Button barButton(String label, Runnable action) {
        AppCompatButton b = new AppCompatButton(activity, null, androidx.appcompat.R.attr.borderlessButtonStyle);
        // Fenix supplies a stateful foreground for its current light/dark/private
        // surface; do not combine it with the framework's default button fill.
        TypedArray theme = activity.obtainStyledAttributes(new int[]{android.R.attr.textColorPrimary});
        try { b.setTextColor(theme.getColorStateList(0)); } finally { theme.recycle(); }
        return button(b, label, action);
    }
    private ImageButton barIcon(String label, int icon, Runnable action) {
        androidx.appcompat.widget.AppCompatImageButton button = new androidx.appcompat.widget.AppCompatImageButton(activity);
        button.setImageResource(icon); button.setContentDescription(label); button.setTooltipText(label);
        button.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.setPadding(dp(8), dp(8), dp(8), dp(8));
        TypedArray theme = activity.obtainStyledAttributes(new int[]{android.R.attr.textColorPrimary, android.R.attr.selectableItemBackgroundBorderless});
        try { button.setImageTintList(theme.getColorStateList(0)); button.setBackground(theme.getDrawable(1)); } finally { theme.recycle(); }
        button.setOnClickListener(ignored -> action.run()); return button;
    }
    private Button button(String label, Runnable action) {
        MaterialButton b = new MaterialButton(activity);
        b.setCornerRadius(dp(24));
        return button(b, label, action);
    }
    private Button button(Button b, String label, Runnable action) { b.setAllCaps(false); b.setText(label); b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(8),0,dp(8),0); b.setOnClickListener(v -> action.run()); return b; }
    private void action(String label, Runnable action) { actions.addView(button(label, action), new LayoutParams(-1, dp(52))); }
    public void showAgent() { shown = true; split = false; browserUi = false; layoutPanels(); }
    public void showBrowser() { shown = false; split = true; browserUi = false; layoutPanels(); }
    public Bundle saveLayoutState() {
        Bundle state = new Bundle(); state.putBoolean("shown", shown); state.putBoolean("split", split); return state;
    }
    public void restoreLayoutState(Bundle state) {
        if (state == null) return;
        shown = state.getBoolean("shown", true); split = state.getBoolean("split", false); layoutPanels();
    }
    public void setBrowserUiVisible(boolean visible) { browserUi = visible; layoutPanels(); }
    public boolean isShownAgent() { return shown && !browserUi; }
    public void toggle() { if (shown) showBrowser(); else showAgent(); }
    private void layoutPanels() {
        boolean sideBySide = !browserUi && split && !shown && getResources().getConfiguration().screenWidthDp >= 600;
        boolean agentVisible = !browserUi && (shown || sideBySide);
        agent.setVisibility(agentVisible ? VISIBLE : GONE);
        hideAgent.setVisibility(sideBySide ? VISIBLE : GONE);
        agent.setLayoutParams(new LayoutParams(sideBySide ? 0 : -1, -1, sideBySide ? .46f : 0));
        browser.setVisibility(browserUi || sideBySide || !shown ? VISIBLE : GONE);
        browser.setLayoutParams(new LayoutParams(0, -1, sideBySide ? .54f : 1));
        runtime.visible = agentVisible;
        if (microphone != null) microphone.changed();
        if (runtime.session != null) runtime.session.setActive(agentVisible);
    }
    public void resume() {
        app.showPendingApproval(activity);
        if (runtime.state.equals("on")) {
            runtime.refresh();
            runtime.agentPageReady(runtime.session, runtime.url);
        }
        else if (runtime.state.equals("setup") && runtime.isOnRequested()) {
            boolean returnedFromTermux = app.policies.getBoolean("agent.termuxSetupPending", false);
            app.policies.edit().remove("agent.termuxSetupPending").apply();
            if (returnedFromTermux || runtime.setupStep.equals("termux") && runtime.termux.installed()
                    || runtime.setupStep.equals("permission") && runtime.termux.permissionGranted()) runtime.turnOn();
        }
        layoutPanels();
    }
    public void destroy() { destroyed = true; if (microphone != null) microphone.close(); runtime.detach(this); if (attached != null) { view.releaseSession(); attached = null; } runtime.visible = false; }
    @Override protected void onConfigurationChanged(android.content.res.Configuration c) { super.onConfigurationChanged(c); layoutPanels(); }
    private void updatePower() {
        boolean stopping = runtime.state.equals("stopping"), stopFailed = runtime.state.equals("stop-failed");
        // The switch controls the complete Agent group for Local and Remote.
        // Keep an unconfirmed stop visibly on so toggling off retries shutdown.
        updatingPower = true;
        try { power.setChecked(runtime.isOnRequested() || stopFailed); }
        finally { updatingPower = false; }
        power.setEnabled(!stopping);
        String status = runtime.state.equals("starting") ? "Starting" : stopping ? "Stopping"
            : stopFailed ? "Shutdown not confirmed; toggle off to retry" : runtime.isOnRequested() ? "On" : "Off";
        power.setTooltipText("Agent: " + status);
        if (Build.VERSION.SDK_INT >= 30) power.setStateDescription(status);
    }
    @Override public void changed() {
        if (microphone != null) microphone.changed();
        updatePower();
        location.setText(runtime.selected.equals("local") ? "Local ▾" : "Remote ▾");
        display.setVisibility(runtime.selected.equals("local") ? VISIBLE : GONE);
        localAI.setVisibility(runtime.selected.equals("local") ? VISIBLE : GONE);
        connectionStatus.setText("Connecting to Agent…");
        boolean online = runtime.state.equals("on") || runtime.state.equals("login");
        if (runtime.session != null && runtime.session != attached) {
            connectionError = "";
            // An existing local document can return without another navigation.
            // Only onPageStart should show loading for a newly attached session.
            connectionStatus.setVisibility(GONE);
            if (attached != null) view.releaseSession(); attached = runtime.session;
            bindSession(attached); view.setSession(attached);
        }
        view.setVisibility(online && connectionError.isEmpty() ? VISIBLE : GONE);
        setup.setVisibility(online && connectionError.isEmpty() ? GONE : VISIBLE);
        if (!online) connectionStatus.setVisibility(GONE);
        String setupState = runtime.selected + runtime.state + runtime.setupStep + runtime.error
            + runtime.remoteConnected(app.policies.getString("agent.lastRemote", ""));
        if (!renderedState.equals(setupState)) { renderedState = setupState; renderSetup(); }
        if (online && !connectionError.isEmpty()) {
            message.setText(connectionError); actions.removeAllViews();
            action("Reconnect", runtime::recoverSession);
        }
        if (runtime.state.equals("setup") && runtime.setupStep.equals("permission") && runtime.permissionPromptPending) {
            runtime.permissionPromptPending = false;
            app.main.post(() -> {
                if (!destroyed && runtime.state.equals("setup") && runtime.setupStep.equals("permission") && runtime.isOnRequested()) requestTermuxPermission();
            });
        }
        if (runtime.state.equals("setup") && runtime.setupStep.equals("battery") && runtime.batteryPromptPending) {
            app.main.post(() -> {
                if (!destroyed && runtime.batteryPromptPending && runtime.state.equals("setup") && runtime.setupStep.equals("battery") && runtime.isOnRequested()) {
                    runtime.batteryPromptPending = false;
                    requestBatteryPermission();
                }
            });
        }
        if (runtime.state.equals("stopping")) {
            JSONObject packages = runtime.status.optJSONObject("packages");
            JSONObject job = packages == null ? null : packages.optJSONObject("job");
            if (job != null) showLog(job.optString("phase") + "\n" + job.optString("log"));
        }
        layoutPanels();
    }
    private void bindSession(GeckoSession session) {
        if (microphone != null) microphone.close();
        final AgentMicrophone microphonePermission = new AgentMicrophone(activity, runtime, session);
        microphone = microphonePermission;
        session.setPermissionDelegate(microphonePermission);
        final String[] currentLocation = {""};
        final boolean[] oauthCallbackLoad = {false};
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override public void onLocationChange(GeckoSession s, String address, List<GeckoSession.PermissionDelegate.ContentPermission> permissions, Boolean hasUserGesture) {
                microphonePermission.navigated();
                currentLocation[0] = address == null ? "" : address;
            }
            @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession s, LoadRequest request) {
                if (request.uri.equals("about:blank")) return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                if (runtime.isRemoteCallback(request.uri)) {
                    // Let only the pending protected login reach Gecko's POST
                    // interceptor; that observer cancels it before any network I/O.
                    boolean pending = request.target == TARGET_WINDOW_CURRENT && !request.isDownload &&
                        !request.isDirectNavigation && runtime.pendingRemoteCallback(s, request.uri, request.triggerUri);
                    oauthCallbackLoad[0] = pending;
                    return GeckoResult.fromValue(pending ? AllowOrDeny.ALLOW : AllowOrDeny.DENY);
                }
                try {
                    URI target = URI.create(request.uri), own = URI.create(runtime.url);
                    if ("blob".equals(target.getScheme())) {
                        // Only Gecko's native download marker may admit an own-origin Blob.
                        // The triggering principal remains available across panel recreation.
                        boolean download = s == runtime.session && request.isDownload
                            && request.hasUserGesture && !request.isRedirect && !request.isDirectNavigation
                            && request.target == TARGET_WINDOW_CURRENT && request.triggerUri != null
                            && sameAgentOrigin(URI.create(request.triggerUri), own)
                            && sameAgentOrigin(URI.create(target.getRawSchemeSpecificPart()), own);
                        return GeckoResult.fromValue(download ? AllowOrDeny.ALLOW : AllowOrDeny.DENY);
                    }
                    if (Objects.equals(target.getScheme(), own.getScheme()) && Objects.equals(target.getHost(), own.getHost()) && target.getPort() == own.getPort() ) {
                        String path = target.getRawPath();
                        if ("/api/files/content".equals(path) || (path != null && path.matches("/api/sessions/[a-f0-9-]{36}/attachments/[^/]+/[^/]+"))) {
                            Uri file = Uri.parse(request.uri);
                            if (!"true".equals(file.getQueryParameter("download"))) {
                                Uri.Builder download = file.buildUpon().clearQuery();
                                for (String name : file.getQueryParameterNames()) if (!name.equals("download"))
                                    for (String value : file.getQueryParameters(name)) download.appendQueryParameter(name, value);
                                s.loadUri(download.appendQueryParameter("download", "true").build().toString());
                                return GeckoResult.fromValue(AllowOrDeny.DENY);
                            }
                        }
                        if (target.getPath().startsWith("/login")) { app.remoteControl.disconnect(); }
                        if (request.target == TARGET_WINDOW_NEW) { s.loadUri(request.uri); return GeckoResult.fromValue(AllowOrDeny.DENY); }
                        return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                    }
                    if (target.getScheme().equals("http") || target.getScheme().equals("https")) app.create(BrowserApp.USER, BrowserApp.onion(request.uri), request.uri, tab -> { app.show(tab); showBrowser(); }, app::message);
                } catch (Exception ignored) {}
                return GeckoResult.fromValue(AllowOrDeny.DENY);
            }
            @Override public GeckoResult<String> onLoadError(GeckoSession s, String uri, WebRequestError error) {
                if (oauthCallbackLoad[0] && AgentRuntime.OAUTH_CALLBACK.equals(uri)) return null;
                if (s == runtime.session && runtime.isOnRequested()) {
                    connectionError = "Agent connection failed (" + error.code + "). Reconnect checks its current address and saved certificate.";
                    connectionStatus.setVisibility(GONE); changed();
                }
                return null;
            }
        });
        session.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override public void onPageStart(GeckoSession s, String uri) {
                microphonePermission.navigated();
                if (!AgentRuntime.OAUTH_CALLBACK.equals(uri)) oauthCallbackLoad[0] = false;
                if (s != runtime.session || !runtime.isOnRequested() || "about:blank".equals(uri)) return;
                connectionError = ""; connectionStatus.setVisibility(VISIBLE); changed();
            }
            @Override public void onPageStop(GeckoSession s, boolean success) {
                if (s != runtime.session || !runtime.isOnRequested() || "about:blank".equals(currentLocation[0])) return;
                connectionStatus.setVisibility(GONE);
                if (oauthCallbackLoad[0]) return; // The private interceptor intentionally cancels this navigation.
                if (!success && connectionError.isEmpty()) connectionError = "Agent could not finish loading. Reconnect to try again.";
                changed();
                if (success) runtime.agentPageReady(s, currentLocation[0]);
            }
        });
        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override public void onCloseRequest(GeckoSession s) { /* Protected Agent is never a closeable tab. */ }
            @Override public void onCrash(GeckoSession s) { runtime.recoverSession(); }
            @Override public void onKill(GeckoSession s) { runtime.recoverSession(); }
            @Override public void onExternalResponse(GeckoSession s, WebResponse response) { download(response); }
        });
        session.setPromptDelegate(new GeckoSession.PromptDelegate() {
            @Override public GeckoResult<PromptResponse> onChoicePrompt(GeckoSession s, ChoicePrompt prompt) {
                return AgentChoicePrompt.show(activity, prompt);
            }
            @Override public GeckoResult<PromptResponse> onFilePrompt(GeckoSession s, FilePrompt prompt) {
                if (fileResult != null) return GeckoResult.fromValue(prompt.dismiss());
                filePrompt = prompt; fileResult = new GeckoResult<>();
                Intent pick = new Intent(prompt.type == FilePrompt.Type.FOLDER ? Intent.ACTION_OPEN_DOCUMENT_TREE : Intent.ACTION_OPEN_DOCUMENT);
                if (prompt.type != FilePrompt.Type.FOLDER) {
                    pick.setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, prompt.type == FilePrompt.Type.MULTIPLE);
                    if (prompt.mimeTypes != null && prompt.mimeTypes.length > 0) pick.putExtra(Intent.EXTRA_MIME_TYPES, prompt.mimeTypes);
                }
                activity.startActivityForResult(pick, FILE_REQUEST); return fileResult;
            }
            @Override public GeckoResult<PromptResponse> onAlertPrompt(GeckoSession s, AlertPrompt p) {
                GeckoResult<PromptResponse> result = new GeckoResult<>(); new MaterialAlertDialogBuilder(activity).setMessage(p.message).setPositiveButton("OK", (d,w) -> result.complete(p.dismiss())).setOnCancelListener(d -> result.complete(p.dismiss())).show(); return result;
            }
        });
    }
    private static boolean sameAgentOrigin(URI candidate, URI own) {
        return "https".equals(own.getScheme()) && own.getHost() != null
            && own.getUserInfo() == null && candidate.getUserInfo() == null
            && Objects.equals(candidate.getScheme(), own.getScheme())
            && Objects.equals(candidate.getHost(), own.getHost())
            && candidate.getPort() == own.getPort();
    }
    public boolean activityResult(int request, int result, Intent data) {
        if (request == BATTERY_PERMISSION) { runtime.batteryPermissionReturned(); return true; }
        if (request != FILE_REQUEST || fileResult == null) return false;
        GeckoSession.PromptDelegate.FilePrompt prompt = filePrompt;
        GeckoResult<GeckoSession.PromptDelegate.PromptResponse> response = fileResult;
        filePrompt = null; fileResult = null;
        if (result == Activity.RESULT_OK && data != null) {
            ArrayList<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) for (int i=0;i<data.getClipData().getItemCount();i++) uris.add(data.getClipData().getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
            if (uris.isEmpty()) response.complete(prompt.dismiss());
            else if (prompt.type == GeckoSession.PromptDelegate.FilePrompt.Type.FOLDER)
                response.complete(prompt.confirm(activity, uris.toArray(new Uri[0])));
            else new Thread(() -> {
                try {
                    Uri[] files = AgentFilePicker.copy(app, uris);
                    app.main.post(() -> { if (!prompt.isComplete()) response.complete(prompt.confirm(app, files)); });
                } catch (Exception exception) {
                    app.main.post(() -> {
                        if (!prompt.isComplete()) response.complete(prompt.dismiss());
                        error("Selected files could not be read. Choose readable files and try again.");
                    });
                }
            }, "agent-file-picker").start();
        } else response.complete(prompt.dismiss());
        return true;
    }
    public void permissionResult(int request) {
        if (request == AgentMicrophone.REQUEST) {
            if (microphone != null) microphone.permissionResult();
            return;
        }
        if (request != TERMUX_PERMISSION) return;
        runtime.permissionRequestInFlight = false;
        if (runtime.termux.permissionGranted()) { if (runtime.isOnRequested()) runtime.turnOn(); }
        else {
            app.policies.edit().putBoolean("agent.termuxPermissionBlocked", !activity.shouldShowRequestPermissionRationale(TermuxConnection.PERMISSION)).apply();
            renderSetup();
        }
    }
    private boolean permissionNeedsSettings() {
        return app.policies.getBoolean("agent.termuxPermissionBlocked", false)
            && !activity.shouldShowRequestPermissionRationale(TermuxConnection.PERMISSION);
    }
    private void requestTermuxPermission() {
        if (runtime.permissionRequestInFlight) return;
        if (runtime.termux.permissionGranted()) { runtime.turnOn(); return; }
        if (permissionNeedsSettings()) { renderSetup(); return; }
        runtime.permissionRequestInFlight = true;
        runtime.termux.requestPermission(activity, TERMUX_PERMISSION);
    }
    private void requestBatteryPermission() {
        if (!runtime.batteryRequestInFlight.isEmpty()) return;
        String packageName = runtime.batteryPackage;
        if (packageName.isEmpty()) return;
        if (runtime.batteryExempt(packageName)) { runtime.turnOn(); return; }
        runtime.batteryRequestInFlight = packageName;
        try {
            boolean canRequest = activity.getPackageManager().checkPermission(
                Manifest.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageName) == PackageManager.PERMISSION_GRANTED;
            Intent intent = new Intent(canRequest ? Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
                : Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + packageName));
            activity.startActivityForResult(intent, BATTERY_PERMISSION);
        } catch (ActivityNotFoundException | SecurityException error) {
            runtime.batteryPermissionFailed("Android could not open battery access. Allow background running for BashKitten and Termux in Android Settings, then retry.");
        }
    }
    private void renderSetup() {
        actions.removeAllViews(); showLog("");
        String state = runtime.state;
        String description = "Starting your Agent…";
        if (state.equals("off")) description = "Agent off. Your chats and projects are saved.";
        else if (state.equals("stopping")) description = "Stopping your Agent…";
        message.setText(runtime.error.isEmpty() ? description : runtime.error);
        if (runtime.selected.equals("local") && (state.equals("setup") || state.equals("off") || state.equals("failed"))) {
            String previous = app.policies.getString("agent.lastRemote", "");
            if (runtime.remoteConnected(previous)) action("Back to remote", () -> runtime.select(previous));
            action("Connect to remote", () -> activity.startActivity(new Intent(activity, AgentRemotesActivity.class)));
        }
        if (state.equals("off") || state.equals("failed") || state.equals("stop-failed")) return;
        if (!state.equals("setup")) return;
        if (runtime.setupStep.equals("battery")) {
            if (!runtime.batteryPromptPending && runtime.batteryRequestInFlight.isEmpty()) {
                action("Allow background running", runtime::retryBatteryPermission);
                action("Continue with battery restrictions", runtime::deferBatteryPermission);
            }
            return;
        }
        if (!runtime.selected.equals("local")) {
            action("Retry connection", runtime::turnOn);
            action("Connect to remote", () -> activity.startActivity(new Intent(activity, AgentRemotesActivity.class)));
            return;
        }
        if (!runtime.termux.installed()) { action("Download Termux", this::downloadTermux); return; }
        if (runtime.setupStep.equals("permission")) {
            if (permissionNeedsSettings()) {
                message.setText("Android has denied Termux command access. Open Permissions, then Additional permissions, and allow BashKitten to run commands in Termux. Startup continues when you return.");
                action("Open Android permission settings", runtime.termux::openPermissionSettings);
            } else message.setText("Approve Android’s Termux permission prompt to continue. If you dismissed it, turn Agent off and on to try again.");
        } else if (runtime.setupStep.equals("connection")) {
            TextView guide = text();
            guide.setText("Copy this command, open Termux, paste it and press Enter. It enables Open Research Tools stable and nightly packages and installs BashKitten with its dependencies through pkg. These are testing releases. Progress appears in Termux. After installation, it returns here and starts Agent automatically.");
            actions.addView(guide);
            if (Build.VERSION.SDK_INT >= 34) {
                TextView processGuide = text();
                processGuide.setText("One-time Android setting for local Agent: in Developer options, turn on Disable child process restrictions. This prevents Android's child-process limit from killing Termux commands. If Developer options is hidden, open About phone and tap Build number seven times. Keep Developer options enabled. Battery permission and wake locks do not change this setting.");
                processGuide.setPadding(0, dp(12), 0, dp(8)); actions.addView(processGuide);
                action("Open Android process settings", () -> {
                    boolean enabled = Settings.Global.getInt(activity.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) != 0;
                    try { activity.startActivity(new Intent(enabled ? Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS : Settings.ACTION_DEVICE_INFO_SETTINGS)); }
                    catch (ActivityNotFoundException error) { activity.startActivity(new Intent(Settings.ACTION_SETTINGS)); }
                });
            }
            TextView command = text();
            command.setTypeface(android.graphics.Typeface.MONOSPACE); command.setTextSize(12);
            command.setText(runtime.termux.setupCommand()); command.setTextIsSelectable(true);
            command.setPadding(dp(12), dp(12), dp(12), dp(12));
            action("Copy command", () -> {
                ((android.content.ClipboardManager)activity.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Set up BashKitten", runtime.termux.setupCommand()));
                Toast.makeText(activity, "Command copied", Toast.LENGTH_SHORT).show();
            });
            ScrollView commandScroll = new ScrollView(activity);
            commandScroll.setNestedScrollingEnabled(true);
            commandScroll.setVerticalScrollBarEnabled(true);
            commandScroll.setScrollbarFadingEnabled(false);
            commandScroll.setClipToOutline(true);
            TypedArray colors = activity.obtainStyledAttributes(new int[]{android.R.attr.colorBackground});
            int background;
            try { background = colors.getColor(0, 0); } finally { colors.recycle(); }
            android.graphics.drawable.GradientDrawable block = new android.graphics.drawable.GradientDrawable();
            block.setCornerRadius(dp(12));
            block.setColor(com.google.android.material.color.MaterialColors.layer(background, command.getCurrentTextColor(), .06f));
            block.setStroke(dp(1), com.google.android.material.color.MaterialColors.layer(background, command.getCurrentTextColor(), .16f));
            commandScroll.setBackground(block);
            commandScroll.addView(command);
            LayoutParams commandLayout = new LayoutParams(-1, command.getLineHeight() * 4 + dp(24));
            commandLayout.setMargins(0, dp(4), 0, dp(8));
            actions.addView(commandScroll, commandLayout);
            action("Open Termux", () -> {
                app.policies.edit().putBoolean("agent.termuxSetupPending", true).apply();
                runtime.termux.openTermux();
            });
        } else {
            action("Retry start", runtime::turnOn);
        }
    }
    private void showLog(String text) {
        boolean follow = !logScroll.canScrollVertically(1);
        log.setText(text);
        logScroll.setVisibility(text.isEmpty() ? GONE : VISIBLE);
        if (follow && !text.isEmpty()) logScroll.post(() -> logScroll.fullScroll(View.FOCUS_DOWN));
    }
    private void downloadTermux() {
        message.setText("Finding the official Termux release…");
        new Thread(() -> {
            try {
                String abi = TermuxConnection.downloadAbi();
                JSONObject release = new JSONObject(releaseMetadata("https://api.github.com/repos/termux/termux-app/releases/latest"));
                JSONArray assets=release.getJSONArray("assets");String apk=null;
                for(int i=0;i<assets.length();i++){JSONObject a=assets.getJSONObject(i);if(a.getString("name").endsWith("_"+abi+".apk")){apk=a.getString("browser_download_url");break;}}
                if(apk==null)throw new IOException("The official Termux release has no " + abi + " APK.");String link=apk;
                app.main.post(() -> app.create(BrowserApp.USER,false,link,tab->{app.show(tab);showBrowser();},this::error));
            }catch(Exception e){app.main.post(()->error("Unable to read the official Termux release: " + e.getMessage()));}
        },"termux-release").start();
    }
    public void browserControl() {
        if (runtime.selected.equals("local")) {
            app.remoteControl.connectLocal(activity, runtime.session, runtime.url, true);
            return;
        }
        if (app.remoteControl.active()) {
            new MaterialAlertDialogBuilder(activity).setTitle("Agent browser control")
                .setMessage("This Agent can control ordinary browser tabs.")
                .setPositiveButton("Disconnect", (d,w) -> app.remoteControl.disconnect())
                .setNegativeButton("Cancel", null).show();
        } else app.remoteControl.authorize(activity, runtime.session, runtime.url, "Remote Agent");
    }
    public void notifications() {
        boolean[] enabled = {app.policies.getBoolean("agent.notifications", false), app.policies.getBoolean("agent.notifications.hidden", true), app.policies.getBoolean("agent.notifications.preview", true)};
        new MaterialAlertDialogBuilder(activity).setTitle("Completed turns")
            .setMultiChoiceItems(new String[]{"Notify when a turn completes", "Only while Agent is hidden", "Include message preview"}, enabled, (d,i,checked) -> enabled[i] = checked)
            .setPositiveButton("Save", (d,w) -> {
                app.policies.edit().putBoolean("agent.notifications", enabled[0]).putBoolean("agent.notifications.hidden", enabled[1]).putBoolean("agent.notifications.preview", enabled[2]).apply();
                if (runtime.selected.equals("local")) try { runtime.command("notification-settings", new JSONObject().put("settings", new JSONObject().put("enabled", enabled[0]).put("onlyWhenHidden", enabled[1]).put("preview", enabled[2])), ignored -> {}, this::error); } catch (JSONException ignored) {}
                if (enabled[0] && Build.VERSION.SDK_INT >= 33) activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
            }).setNegativeButton("Cancel", null).show();
    }
    public void checkBrowserUpdate() {
        app.message("Checking for a BashKitten update…");
        new Thread(() -> {
            try {
                String abi = TermuxConnection.downloadAbi(), download = null, available = null;
                long newest = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).getLongVersionCode();
                // The published APK's versionCode decides upgrades across stable
                // and nightly; tag dates and prerelease suffixes do not order APKs.
                for (int page = 1; ; page++) {
                    JSONArray releases = new JSONArray(releaseMetadata("https://api.github.com/repos/openresearchtools/bashkitten/releases?per_page=100&page=" + page));
                    for (int i = 0; i < releases.length(); i++) {
                        JSONObject release = releases.getJSONObject(i);
                        if (release.optBoolean("draft")) continue;
                        JSONArray assets = release.getJSONArray("assets");
                        Map<String, String> downloads = new HashMap<>();
                        for (int j = 0; j < assets.length(); j++) {
                            JSONObject asset = assets.getJSONObject(j);
                            downloads.put(asset.getString("name"), asset.getString("browser_download_url"));
                        }
                        String manifestUrl = downloads.get("release.json");
                        if (manifestUrl == null) continue;
                        JSONArray apps = new JSONObject(releaseMetadata(manifestUrl)).getJSONArray("apps");
                        for (int j = 0; j < apps.length(); j++) {
                            JSONObject candidate = apps.getJSONObject(j);
                            if (!candidate.getString("packageId").equals(activity.getPackageName()) || !candidate.getString("abi").equals(abi)) continue;
                            long code = candidate.getLong("versionCode");
                            if (code <= newest) continue;
                            String name = candidate.getString("asset"), link = downloads.get(name);
                            if (link == null || !name.endsWith(".apk")) throw new IOException("Release " + release.getString("tag_name") + " is missing its " + abi + " APK.");
                            newest = code; download = link; available = release.getString("tag_name");
                        }
                    }
                    if (releases.length() < 100) break;
                }
                if (download == null) { app.main.post(() -> app.message("BashKitten is up to date.")); return; }
                String link = download, version = available;
                app.main.post(() -> new MaterialAlertDialogBuilder(activity).setTitle("BashKitten " + version).setMessage("A browser update is available. Testing release only; not ready for production.").setPositiveButton("Download", (d,w) -> app.create(BrowserApp.USER, false, link, tab -> { app.show(tab); showBrowser(); }, app::message)).setNegativeButton("Later", null).show());
            } catch (Exception error) { app.main.post(() -> app.message("The update check failed: " + error.getMessage())); }
        }, "bashkitten-update").start();
    }
    private static String releaseMetadata(String url) throws IOException {
        java.net.HttpURLConnection connection = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        try (InputStream input = connection.getInputStream()) { return new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8); }
        finally { connection.disconnect(); }
    }
    public void packages(){LinearLayout content=new LinearLayout(activity);content.setOrientation(VERTICAL);TextView output=new TextView(activity);output.setTypeface(android.graphics.Typeface.MONOSPACE);output.setTextIsSelectable(true);ScrollView scroll=new ScrollView(activity);scroll.addView(output);content.addView(button("Check for updates",()->packageCommand("check-packages",output)));content.addView(button("Update packages",()->packageCommand("update-packages",output)));content.addView(scroll,new LayoutParams(-1,dp(320)));new MaterialAlertDialogBuilder(activity).setTitle("Packages").setView(content).setPositiveButton("Close",null).show();packageCommand("status",output);}
    private void packageCommand(String command, TextView output) {
        try {
            if (command.equals("status")) { runtime.command("package-inventory", new JSONObject(), value -> output.setText(inventoryText(value)), output::setText); return; }
            runtime.command("package-job", new JSONObject().put("kind", command), value -> showPackageJob(value, output), output::setText);
        } catch (JSONException ignored) {}
    }
    private String inventoryText(JSONObject inventory) {
        StringBuilder text = new StringBuilder("Installed packages\n\n");
        for (String source : new String[]{"apt", "npm"}) {
            text.append(source.equals("apt") ? "Termux / APT\n" : "\nnpm\n");
            JSONArray items = inventory.optJSONArray(source);
            if (items != null) for (int i=0; i<items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item != null) text.append(item.optString("name")).append("  ").append(item.optString("version")).append('\n');
            }
        }
        text.append("\nPi  ").append(inventory.optString("pi"));
        JSONObject search = inventory.optJSONObject("search");
        if (search != null) text.append("\nDDGS  ").append(search.optString("version", search.optString("ddgs", "Packaged")));
        if (inventory.has("npmError")) text.append("\n\n").append(inventory.optString("npmError"));
        return text.toString();
    }
    private void showPackageJob(JSONObject value, TextView output) {
        JSONObject packages = value.optJSONObject("packages");
        JSONObject job = packages == null ? null : packages.optJSONObject("job");
        if (job == null) { output.setText("No package operation is running."); return; }
        output.setText(job.optString("phase") + "\n" + job.optString("log") + (job.has("error") ? "\n" + job.optString("error") : ""));
        if (job.optString("status").equals("running")) app.main.postDelayed(() -> runtime.command("status", new JSONObject(), next -> showPackageJob(next, output), output::setText), 1500);
    }
    private void error(String text){message.setText(text);Toast.makeText(activity,text,Toast.LENGTH_LONG).show();}
    private void download(WebResponse response){
        new Thread(()->{Uri target=null;try{String name=mozilla.components.support.utils.DownloadUtils.INSTANCE.extractFileNameFromUrl(response.headers.get("Content-Disposition"),response.uri);ContentValues values=new ContentValues();values.put(MediaStore.Downloads.DISPLAY_NAME,name);values.put(MediaStore.Downloads.MIME_TYPE,response.headers.get("Content-Type"));values.put(MediaStore.Downloads.IS_PENDING,1);target=activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);if(target==null)throw new IOException();try(InputStream input=response.body;OutputStream output=activity.getContentResolver().openOutputStream(target)){if(input==null||output==null)throw new IOException();input.transferTo(output);}values.clear();values.put(MediaStore.Downloads.IS_PENDING,0);activity.getContentResolver().update(target,values,null,null);Uri saved=target;app.main.post(()->new MaterialAlertDialogBuilder(activity).setMessage("Saved "+name).setPositiveButton("Open",(d,w)->{try{activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(saved,response.headers.get("Content-Type")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));}catch(Exception e){app.message("Saved in Downloads.");}}).setNegativeButton("Close",null).show());}catch(Exception e){if(target!=null)activity.getContentResolver().delete(target,null,null);app.main.post(()->error("Download failed."));}},"agent-download").start();
    }
}
