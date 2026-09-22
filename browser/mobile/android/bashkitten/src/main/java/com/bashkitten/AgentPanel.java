// SPDX-License-Identifier: GPL-3.0-only
package com.bashkitten;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import androidx.appcompat.app.AlertDialog;
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
    private final Button power, location;
    private final GeckoView view;
    private final ScrollView setup;
    private final TextView message, log;
    private final LinearLayout actions;
    private GeckoSession attached;
    private String renderedState = "";
    private boolean shown = true;
    private boolean startedBootstrap;
    private GeckoSession.PromptDelegate.FilePrompt filePrompt;
    private GeckoResult<GeckoSession.PromptDelegate.PromptResponse> fileResult;
    private String setupId;
    public static final int FILE_REQUEST = 7310, TERMUX_PERMISSION = 7311, NOTIFICATION_PERMISSION = 7312;
    public AgentPanel(Activity activity, View browser, GeckoRuntime engine) {
        super(activity); this.activity = activity; this.browser = browser;
        app = BrowserApp.get(activity); runtime = app.agent;
        runtime.activity = new java.lang.ref.WeakReference<>(activity);
        setOrientation(HORIZONTAL);
        agent = new LinearLayout(activity); agent.setOrientation(VERTICAL);
        bar = new LinearLayout(activity); bar.setGravity(Gravity.CENTER_VERTICAL); agent.addView(bar, new LayoutParams(-1, dp(48)));
        Button toggle = button("Agent", this::toggle); bar.addView(toggle, new LayoutParams(dp(72), -1));
        location = button("Local", () -> activity.startActivity(new Intent(activity, AgentRemotesActivity.class))); bar.addView(location, new LayoutParams(0, -1, 1));
        power = button("Starting", () -> { if (runtime.isOnRequested() || runtime.state.equals("stop-failed")) runtime.turnOff(); else runtime.turnOn(); });
        bar.addView(power, new LayoutParams(dp(90), -1));
        Button menu = button("☰", () -> menu()); menu.setContentDescription("Agent menu"); bar.addView(menu, new LayoutParams(dp(48), -1));
        body = new LinearLayout(activity); body.setOrientation(VERTICAL); agent.addView(body, new LayoutParams(-1, 0, 1));
        view = new GeckoView(activity); body.addView(view, new LayoutParams(-1, 0, 1));
        setup = new ScrollView(activity); setup.setFillViewport(true);
        LinearLayout setupBody = new LinearLayout(activity); setupBody.setPadding(dp(24), dp(28), dp(24), dp(24)); setupBody.setOrientation(VERTICAL); setup.addView(setupBody);
        TextView title = new TextView(activity); title.setText("BashKitten"); title.setTextSize(28); setupBody.addView(title);
        message = new TextView(activity); message.setTextSize(16); message.setPadding(0, dp(12), 0, dp(20)); setupBody.addView(message);
        actions = new LinearLayout(activity); actions.setOrientation(VERTICAL); setupBody.addView(actions);
        log = new TextView(activity); log.setTextSize(12); log.setTypeface(android.graphics.Typeface.MONOSPACE); log.setTextIsSelectable(true); setupBody.addView(log);
        body.addView(setup, new LayoutParams(-1, 0, 1));
        addView(agent); addView(browser);
        runtime.attach(engine, this);
        setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) { android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()); agent.setPadding(i.left, i.top, i.right, i.bottom); }
            return insets;
        });
        layoutPanels(); changed();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private Button button(String label, Runnable action) { Button b = new Button(activity); b.setAllCaps(false); b.setText(label); b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(8),0,dp(8),0); b.setOnClickListener(v -> action.run()); return b; }
    private void action(String label, Runnable action) { actions.addView(button(label, action), new LayoutParams(-1, dp(52))); }
    public void showAgent() { shown = true; layoutPanels(); }
    public void showBrowser() { shown = false; layoutPanels(); }
    public boolean isShownAgent() { return shown; }
    public void toggle() { shown = !shown; layoutPanels(); }
    private void layoutPanels() {
        boolean wide = getResources().getConfiguration().screenWidthDp >= 840;
        agent.setVisibility(shown ? VISIBLE : GONE);
        agent.setLayoutParams(new LayoutParams(wide ? 0 : -1, -1, wide ? .46f : 0));
        browser.setVisibility(wide || !shown ? VISIBLE : GONE);
        browser.setLayoutParams(new LayoutParams(0, -1, wide && shown ? .54f : 1));
        runtime.visible = shown;
        if (runtime.session != null) runtime.session.setActive(shown);
    }
    public void resume() { app.showPendingApproval(activity); if (runtime.state.equals("on")) runtime.refresh(); layoutPanels(); }
    public void destroy() { runtime.detach(this); if (attached != null) { view.releaseSession(); attached = null; } runtime.visible = false; }
    @Override protected void onConfigurationChanged(android.content.res.Configuration c) { super.onConfigurationChanged(c); layoutPanels(); }
    @Override public void changed() {
        power.setText(runtime.state.equals("starting") ? "Starting" : runtime.state.equals("stopping") ? "Stopping" : runtime.state.equals("stop-failed") ? "Retry stop" : runtime.isOnRequested() ? "Turn off" : "Turn on");
        power.setEnabled(!runtime.state.equals("starting") && !runtime.state.equals("stopping"));
        location.setText(runtime.selected.equals("local") ? "Local ▾" : "Remote ▾");
        boolean online = runtime.state.equals("on"); view.setVisibility(online ? VISIBLE : GONE); setup.setVisibility(online ? GONE : VISIBLE);
        if (runtime.session != null && runtime.session != attached) {
            if (attached != null) view.releaseSession(); attached = runtime.session;
            bindSession(attached); view.setSession(attached);
        }
        if (!renderedState.equals(runtime.state + runtime.error)) { renderedState = runtime.state + runtime.error; renderSetup(); }
        if (runtime.state.equals("stopping")) {
            JSONObject packages = runtime.status.optJSONObject("packages");
            JSONObject job = packages == null ? null : packages.optJSONObject("job");
            if (job != null) log.setText(job.optString("phase") + "\n" + job.optString("log"));
        }
        layoutPanels();
    }
    private void bindSession(GeckoSession session) {
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession s, LoadRequest request) {
                if (request.uri.equals("about:blank")) return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                try {
                    URI target = URI.create(request.uri), own = URI.create(runtime.url);
                    if (Objects.equals(target.getScheme(), own.getScheme()) && Objects.equals(target.getHost(), own.getHost()) && target.getPort() == own.getPort() ) {
                        if (target.getPath().startsWith("/login")) app.remoteControl.disconnect();
                        if (request.target == TARGET_WINDOW_NEW) { s.loadUri(request.uri); return GeckoResult.fromValue(AllowOrDeny.DENY); }
                        return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                    }
                    if (target.getScheme().equals("http") || target.getScheme().equals("https")) app.create(BrowserApp.USER, BrowserApp.onion(request.uri), request.uri, tab -> { app.show(tab); showBrowser(); }, app::message);
                } catch (Exception ignored) {}
                return GeckoResult.fromValue(AllowOrDeny.DENY);
            }
            @Override public GeckoResult<String> onLoadError(GeckoSession s, String uri, WebRequestError error) {
                message.setText("Agent connection failed. Reconnect checks its current address and saved certificate.");
                view.setVisibility(GONE); setup.setVisibility(VISIBLE); actions.removeAllViews(); action("Reconnect", runtime::refresh);
                return null;
            }
        });
        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override public void onCloseRequest(GeckoSession s) { /* Protected Agent is never a closeable tab. */ }
            @Override public void onCrash(GeckoSession s) { runtime.recoverSession(); }
            @Override public void onKill(GeckoSession s) { runtime.recoverSession(); }
            @Override public void onExternalResponse(GeckoSession s, WebResponse response) { download(response); }
        });
        session.setPromptDelegate(new GeckoSession.PromptDelegate() {
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
                GeckoResult<PromptResponse> result = new GeckoResult<>(); new AlertDialog.Builder(activity).setMessage(p.message).setPositiveButton("OK", (d,w) -> result.complete(p.dismiss())).setOnCancelListener(d -> result.complete(p.dismiss())).show(); return result;
            }
        });
    }
    public boolean activityResult(int request, int result, Intent data) {
        if (request != FILE_REQUEST || fileResult == null) return false;
        if (result == Activity.RESULT_OK && data != null) {
            ArrayList<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) for (int i=0;i<data.getClipData().getItemCount();i++) uris.add(data.getClipData().getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
            fileResult.complete(uris.isEmpty() ? filePrompt.dismiss() : filePrompt.confirm(activity, uris.toArray(new Uri[0])));
        } else fileResult.complete(filePrompt.dismiss());
        filePrompt = null; fileResult = null; return true;
    }
    public void permissionResult(int request) { if (request == TERMUX_PERMISSION && runtime.termux.permissionGranted()) runtime.turnOn(); }
    private void renderSetup() {
        actions.removeAllViews(); log.setText("");
        String state = runtime.state;
        message.setText(runtime.error.isEmpty() ? state.equals("off") ? "Agent off. Your chats and projects are saved." : state.equals("enroll") ? "Create your local account and enable two-factor authentication." : "Starting your Agent…" : runtime.error);
        if (state.equals("off") || state.equals("failed") || state.equals("stop-failed")) { action(state.equals("stop-failed") ? "Retry shutdown" : "Turn on", state.equals("stop-failed") ? runtime::turnOff : runtime::turnOn); return; }
        if (state.equals("enroll")) { account(); return; }
        if (!state.equals("setup")) return;
        if (!runtime.termux.installed()) { action("Download Termux", this::downloadTermux); action("Check again", runtime::turnOn); return; }
        action("Open Termux", runtime.termux::openTermux);
        TextView command = new TextView(activity); command.setTypeface(android.graphics.Typeface.MONOSPACE); command.setTextSize(12); command.setText(runtime.termux.setupCommand()); command.setTextIsSelectable(true); actions.addView(command);
        action("Copy connection command", () -> ((android.content.ClipboardManager)activity.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Connect BashKitten", runtime.termux.setupCommand())));
        action("Allow connection", () -> runtime.termux.requestPermission(activity, TERMUX_PERMISSION));
        action("App permissions", runtime.termux::openPermissionSettings);
        if (runtime.termux.permissionGranted()) {
            action("Connect", runtime::turnOn);
            action("Install Agent packages", () -> runtime.termux.bootstrap(value -> { runtime.bootstrapStarted(); startedBootstrap = true; bootstrapProgress(); }, this::error));
        }
    }
    private void bootstrapProgress() {
        if (!startedBootstrap || activity.isDestroyed()) return;
        runtime.termux.bootstrapStatus(value -> {
            log.setText(value.optString("log", value.toString()));
            if (value.optBoolean("ready") || value.optString("status").equals("complete")) { startedBootstrap=false; if (runtime.isOnRequested()) runtime.turnOn(); else runtime.turnOff(); }
            else app.main.postDelayed(this::bootstrapProgress, 2000);
        }, this::error);
    }
    private void account() {
        EditText username = field("Username", false); EditText password = field("Password", true); actions.addView(username); actions.addView(password);
        action("Create account", () -> {
            try { runtime.command("account-create", new JSONObject().put("username", username.getText().toString()).put("password", password.getText().toString()), this::showFactor, this::error); password.setText(""); }
            catch (JSONException ignored) {}
        });
        action("Continue enrollment", () -> {
            try { runtime.command("account-enroll", new JSONObject().put("username", username.getText().toString()).put("password", password.getText().toString()), this::showFactor, this::error); password.setText(""); }
            catch (JSONException ignored) {}
        });
    }
    private EditText field(String hint, boolean secret) { EditText field = new EditText(activity); field.setHint(hint); field.setSingleLine(); if (secret) { field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD); field.setImportantForAutofill(IMPORTANT_FOR_AUTOFILL_NO); } return field; }
    private void showFactor(JSONObject value) {
        setupId = value.optString("setupId"); actions.removeAllViews();
        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        String qr = value.optString("qrDataUrl");
        try { byte[] data = android.util.Base64.decode(qr.substring(qr.indexOf(',')+1), android.util.Base64.DEFAULT); ImageView image = new ImageView(activity); image.setImageBitmap(BitmapFactory.decodeByteArray(data,0,data.length)); actions.addView(image,new LayoutParams(-1,dp(240))); } catch(Exception ignored) {}
        TextView guide = new TextView(activity); guide.setText("Scan this code with your authenticator, then enter its six-digit code."); actions.addView(guide);
        EditText code = field("Authenticator code", false); code.setInputType(InputType.TYPE_CLASS_NUMBER); actions.addView(code);
        action("Verify and continue", () -> { try { runtime.command("account-totp", new JSONObject().put("setupId",setupId).put("code",code.getText().toString()), result -> { activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE); runtime.refresh(); },this::error); } catch(JSONException ignored) {} });
    }
    private void downloadTermux() {
        message.setText("Finding the official Termux release…");
        new Thread(() -> {
            try {
                java.net.HttpURLConnection conn=(java.net.HttpURLConnection)new java.net.URL("https://api.github.com/repos/termux/termux-app/releases/latest").openConnection(); conn.setConnectTimeout(15000);conn.setReadTimeout(15000);conn.setRequestProperty("Accept","application/vnd.github+json");
                JSONObject release;try(InputStream input=conn.getInputStream()){release=new JSONObject(new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));}finally{conn.disconnect();}
                JSONArray assets=release.getJSONArray("assets");String apk=null;
                for(int i=0;i<assets.length();i++){JSONObject a=assets.getJSONObject(i);String n=a.getString("name");if(n.endsWith(".apk")&&n.contains("arm64-v8a")){apk=a.getString("browser_download_url");break;}}
                if(apk==null)throw new IOException("The official release has no compatible APK.");String link=apk;
                app.main.post(() -> app.create(BrowserApp.USER,false,link,tab->{app.show(tab);showBrowser();},this::error));
            }catch(Exception e){app.main.post(()->error("Unable to read the official Termux release. Try again when online."));}
        },"termux-release").start();
    }
    private void menu() {
        PopupMenu menu=new PopupMenu(activity,bar.getChildAt(3));
        menu.getMenu().add("Packages").setOnMenuItemClickListener(i->{packages();return true;});
        menu.getMenu().add(app.remoteControl.active() ? "Disconnect browser control" : "Allow Agent browser control").setOnMenuItemClickListener(i -> {
            if (app.remoteControl.active()) app.remoteControl.disconnect();
            else app.remoteControl.authorize(activity, runtime.session, runtime.url, runtime.selected.equals("local") ? "Local Agent" : "Remote Agent");
            return true;
        });
        menu.getMenu().add("Agent access").setOnMenuItemClickListener(i->{activity.startActivity(new Intent(activity,AgentAccessActivity.class));return true;});
        menu.getMenu().add("Check for browser update").setOnMenuItemClickListener(i -> { checkBrowserUpdate(); return true; });
        menu.getMenu().add("Notifications").setOnMenuItemClickListener(i->{notifications();return true;});
        menu.getMenu().add("Appearance").setOnMenuItemClickListener(i->{appearance();return true;});
        menu.getMenu().add("About and licenses").setOnMenuItemClickListener(i->{activity.startActivity(new Intent(activity,LicensesActivity.class));return true;});
        menu.getMenu().add("New tab").setOnMenuItemClickListener(i->{app.create(BrowserApp.USER,false,"about:blank",tab->{app.show(tab);showBrowser();},app::message);return true;});menu.show();
    }
    private void appearance(){String[] modes={"System","Light","Dark"};new AlertDialog.Builder(activity).setTitle("Appearance").setSingleChoiceItems(modes,app.policies.getInt("agent.theme",0),(d,i)->{app.policies.edit().putInt("agent.theme",i).apply();androidx.appcompat.app.AppCompatDelegate.setDefaultNightMode(i==1?androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_NO:i==2?androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_YES:androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM);d.dismiss();}).show();}
    private void notifications() {
        boolean[] enabled = {app.policies.getBoolean("agent.notifications", false), app.policies.getBoolean("agent.notifications.hidden", true), app.policies.getBoolean("agent.notifications.preview", true)};
        new AlertDialog.Builder(activity).setTitle("Completed turns")
            .setMultiChoiceItems(new String[]{"Notify when a turn completes", "Only while Agent is hidden", "Include message preview"}, enabled, (d,i,checked) -> enabled[i] = checked)
            .setPositiveButton("Save", (d,w) -> {
                app.policies.edit().putBoolean("agent.notifications", enabled[0]).putBoolean("agent.notifications.hidden", enabled[1]).putBoolean("agent.notifications.preview", enabled[2]).apply();
                if (runtime.selected.equals("local")) try { runtime.command("notification-settings", new JSONObject().put("settings", new JSONObject().put("enabled", enabled[0]).put("onlyWhenHidden", enabled[1]).put("preview", enabled[2])), ignored -> {}, this::error); } catch (JSONException ignored) {}
                if (enabled[0] && Build.VERSION.SDK_INT >= 33) activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
            }).setNegativeButton("Cancel", null).show();
    }
    private void checkBrowserUpdate() {
        app.message("Checking for a BashKitten update…");
        new Thread(() -> {
            try {
                java.net.HttpURLConnection connection = (java.net.HttpURLConnection) new java.net.URL("https://api.github.com/repos/openresearchtools/bashkitten/releases/latest").openConnection();
                connection.setConnectTimeout(15000); connection.setReadTimeout(15000); connection.setRequestProperty("Accept", "application/vnd.github+json");
                JSONObject release;
                try (InputStream input = connection.getInputStream()) { release = new JSONObject(new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)); }
                finally { connection.disconnect(); }
                String current = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
                String available = release.getString("tag_name").replaceFirst("^v", "");
                String[] have = current.split("\\."), latest = available.split("\\.");
                int comparison = 0;
                for (int i=0; i<Math.max(have.length,latest.length) && comparison==0; i++) comparison = Integer.compare(i<latest.length ? Integer.parseInt(latest[i]) : 0, i<have.length ? Integer.parseInt(have[i]) : 0);
                if (comparison <= 0) { app.main.post(() -> app.message("BashKitten is up to date.")); return; }
                JSONArray assets = release.getJSONArray("assets"); String download = null;
                for (int i=0; i<assets.length(); i++) { JSONObject asset=assets.getJSONObject(i); if (asset.getString("name").endsWith("arm64-v8a.apk")) { download=asset.getString("browser_download_url"); break; } }
                if (download == null) throw new IOException("Release has no Android APK.");
                String link = download;
                app.main.post(() -> new AlertDialog.Builder(activity).setTitle("BashKitten " + available).setMessage("A browser update is available.").setPositiveButton("Download", (d,w) -> app.create(BrowserApp.USER, false, link, tab -> { app.show(tab); showBrowser(); }, app::message)).setNegativeButton("Later", null).show());
            } catch (Exception error) { app.main.post(() -> app.message("The update check failed. Try again when online.")); }
        }, "bashkitten-update").start();
    }
    public void packages(){LinearLayout content=new LinearLayout(activity);content.setOrientation(VERTICAL);TextView output=new TextView(activity);output.setTypeface(android.graphics.Typeface.MONOSPACE);output.setTextIsSelectable(true);ScrollView scroll=new ScrollView(activity);scroll.addView(output);content.addView(button("Check for updates",()->packageCommand("check-packages",output)));content.addView(button("Update packages",()->packageCommand("update-packages",output)));content.addView(scroll,new LayoutParams(-1,dp(320)));new AlertDialog.Builder(activity).setTitle("Packages").setView(content).setPositiveButton("Close",null).show();packageCommand("status",output);}
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
        new Thread(()->{Uri target=null;try{String name=android.webkit.URLUtil.guessFileName(response.uri,response.headers.get("Content-Disposition"),response.headers.get("Content-Type"));ContentValues values=new ContentValues();values.put(MediaStore.Downloads.DISPLAY_NAME,name);values.put(MediaStore.Downloads.MIME_TYPE,response.headers.get("Content-Type"));values.put(MediaStore.Downloads.IS_PENDING,1);target=activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);if(target==null)throw new IOException();try(InputStream input=response.body;OutputStream output=activity.getContentResolver().openOutputStream(target)){if(input==null||output==null)throw new IOException();input.transferTo(output);}values.clear();values.put(MediaStore.Downloads.IS_PENDING,0);activity.getContentResolver().update(target,values,null,null);Uri saved=target;app.main.post(()->new AlertDialog.Builder(activity).setMessage("Saved "+name).setPositiveButton("Open",(d,w)->{try{activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(saved,response.headers.get("Content-Type")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));}catch(Exception e){app.message("Saved in Downloads.");}}).setNegativeButton("Close",null).show());}catch(Exception e){if(target!=null)activity.getContentResolver().delete(target,null,null);app.main.post(()->error("Download failed."));}},"agent-download").start();
    }
}
