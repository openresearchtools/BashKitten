// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.content.*;
import android.graphics.Bitmap;
import android.os.*;
import android.widget.Toast;
import java.net.URI;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;
import org.mozilla.geckoview.*;

/** Product services shared with Fenix; Fenix retains ownership of its UI and tab store. */
public final class BrowserApp extends ContextWrapper {
    public interface Provider { BrowserApp bashKitten(); }
    public interface Host {
        GeckoRuntime runtime();
        Tab create(String owner, String contextId);
        Tab selected();
        List<Tab> list();
        boolean refresh(Tab tab);
        void ensure(Tab tab, Runnable done, Consumer<String> fail);
        void close(String id);
        void isolate(Tab tab, String contextId, Runnable done, Consumer<String> fail);
        void show(String id);
        void desktop(String id, boolean enabled);
        void screenshot(String id, Consumer<Bitmap> result);
        void bookmark(String url, String title, Consumer<String> done, Consumer<String> fail);
        void quickAccess(String url, String title, Consumer<String> done, Consumer<String> fail);
        List<Download> downloads();
        void acceptDownload(String tabId, String downloadId);
        Intent launchIntent();
    }
    public static BrowserApp get(Context context) { return ((Provider) context.getApplicationContext()).bashKitten(); }
    public final Handler main = new Handler(Looper.getMainLooper());
    final AppGrants grants;
    final AgentController controller;
    final CommandGateway commands;
    final AppCommandGateway appCommands;
    final FileTransfers transfers;
    final TorManager tor;
    final SharedPreferences policies;
    public final Host host;
    public final AgentRuntime agent;
    final RemoteBrowserControl remoteControl;
    final LinkedHashMap<String, Tab> tabs = new LinkedHashMap<>();
    public static final String USER = "local-user";
    public static final class Download {
        public final String id, tabId, name, mime, status;
        public final java.io.File file;
        public final long size;
        public Download(String id, String tabId, String name, String mime, String status, String path, long size) {
            this.id = id; this.tabId = tabId; this.name = name; this.mime = mime; this.status = status;
            this.file = new java.io.File(path); this.size = size;
        }
        JSONObject json() throws JSONException {
            return new JSONObject().put("id", id).put("name", name).put("mimeType", mime).put("status", status).put("size", size);
        }
    }
    public static final class Tab {
        public final String id, owner;
        public GeckoSession session;
        public String url = "about:blank", title = "New tab", error = "";
        public String parentId;
        public boolean loading, desktop, tor, ready, preparing, adblock = true;
        String pendingUrl;
        int port;
        public Tab(String id, String owner, GeckoSession session) { this.id = id; this.owner = owner; this.session = session; }
        JSONObject json() throws JSONException {
            return new JSONObject().put("id", id).put("url", url).put("title", title)
                .put("tor", tor).put("desktop", desktop).put("adblock", adblock).put("loading", loading).put("error", error);
        }
    }
    public BrowserApp(Context context, Host host) {
        super(context.getApplicationContext()); this.host = host;
        grants = new AppGrants(this); tor = new TorManager(this);
        policies = getSharedPreferences("tab-policies", 0);
        policies.getAll();
        controller = new AgentController(this);
        commands = new CommandGateway(this);
        transfers = new FileTransfers(this);
        appCommands = new AppCommandGateway(this);
        agent = new AgentRuntime(this);
        remoteControl = new RemoteBrowserControl(this);
    }
    public boolean isAgentVisible() { return agent.visible; }
    public void showPendingApproval(android.app.Activity activity) {
        String ticket = grants.pendingTicket();
        if (ticket != null) activity.startActivity(new Intent(activity, GrantActivity.class)
            .setData(android.net.Uri.parse("bashkitten-grant:" + ticket)));
    }
    void keepAlive() {
        startForegroundService(new Intent(this, BrowserKeepAliveService.class));
    }
    public static String webUrl(String value) {
        URI uri = URI.create(value);
        if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                || uri.getHost() == null || uri.getUserInfo() != null) throw new IllegalArgumentException("Use an HTTP or HTTPS URL without embedded credentials");
        return uri.toASCIIString();
    }
    public static boolean onion(String url) {
        try { String h = URI.create(url).getHost(); return h != null && h.toLowerCase(Locale.ROOT).endsWith(".onion"); }
        catch (Exception error) { return false; }
    }
    public Tab track(Tab tab) { return track(tab, null); }
    public Tab track(Tab tab, String parentId) {
        Tab current = tabs.get(tab.id);
        if (current != null) { host.refresh(current); return current; }
        Tab parent = tabs.get(parentId);
        String parentOwner = parent == null ? policies.getString(parentId + ".owner", tab.owner) : parent.owner;
        String owner = policies.getString(tab.id + ".owner", parentOwner);
        Tab value = new Tab(tab.id, owner, tab.session);
        value.parentId = parentId;
        value.tor = policies.getBoolean(tab.id + ".tor", parent != null ? parent.tor : policies.getBoolean(parentId + ".tor", false));
        if (parent != null && parent.tor) value.port = parent.port;
        value.adblock = policies.getBoolean(tab.id + ".adblock", true);
        host.refresh(value); tabs.put(value.id, value); return value;
    }
    private void save(Tab tab) {
        policies.edit().putString(tab.id + ".owner", tab.owner).putBoolean(tab.id + ".tor", tab.tor)
            .putBoolean(tab.id + ".adblock", tab.adblock).apply();
    }
    public boolean prepareNavigation(Tab tab, String url) {
        if (tab.ready && (!onion(url) || tab.tor)) return false;
        tab.pendingUrl = url;
        if (tab.preparing) return true;
        if (onion(url)) tab.tor = true;
        tab.preparing = true;
        if (tab.tor && tab.port == 0) useTor(tab, url);
        else configure(tab, tab.tor ? tor.identities() : Collections.emptyList(), ignored -> {
            tab.preparing = false; tab.session.loadUri(tab.pendingUrl);
        }, error -> { tab.preparing = false; message(error); });
        return true;
    }
    public Tab forSession(GeckoSession session) {
        for (Tab tab : tabs.values()) if (tab.session == session) return tab;
        return null;
    }
    void refresh() {
        tabs.values().removeIf(tab -> !host.refresh(tab));
        for (Tab tab : host.list()) track(tab, tab.parentId);
    }
    void ensure(Tab tab, Runnable done, Consumer<String> fail) {
        if (tab.preparing) {
            awaitPreparation(tab, SystemClock.elapsedRealtime() + 185000, done, fail);
            return;
        }
        host.ensure(tab, () -> {
            if (tab.ready) { done.run(); return; }
            String restoreUrl = tab.url;
            Consumer<Integer> configured = port -> {
                tab.port = port;
                configure(tab, tor.identities(), ignored -> {
                    if (!restoreUrl.equals("about:blank")) tab.session.loadUri(restoreUrl);
                    done.run();
                }, fail);
            };
            if (tab.tor) tor.ready(configured, fail);
            else configured.accept(0);
        }, fail);
    }
    private void awaitPreparation(Tab tab, long deadline, Runnable done, Consumer<String> fail) {
        if (!tabs.containsKey(tab.id)) { fail.accept("Tab was closed"); return; }
        if (!tab.preparing) {
            if (tab.ready) done.run(); else fail.accept("Tab connection is unavailable; retry navigation");
            return;
        }
        if (SystemClock.elapsedRealtime() >= deadline) { fail.accept("Tab connection timed out"); return; }
        main.postDelayed(() -> awaitPreparation(tab, deadline, done, fail), 100);
    }
    Tab owned(String id, String owner) {
        refresh(); Tab tab = tabs.get(id);
        if (tab == null) throw new SecurityException("Unknown ordinary browser tab");
        return tab;
    }
    void create(String owner, boolean useTor, String url, Consumer<Tab> done, Consumer<String> fail) {
        refresh();
        if (tabs.size() >= 64 || tabs.values().stream().filter(t -> t.owner.equals(owner)).count() >= 16) { fail.accept("Tab limit reached"); return; }
        boolean needsTor = useTor || onion(url);
        String context;
        if (needsTor) context = "bashkitten-tor-" + UUID.randomUUID();
        else if (owner.equals(USER)) context = "bashkitten-user";
        else {
            try {
                byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(owner.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                context = "bashkitten-agent-" + Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
            } catch (Exception error) { fail.accept("Could not identify agent storage"); return; }
        }
        Tab tab = host.create(owner, context);
        tabs.put(tab.id, tab); tab.tor = useTor || onion(url);
        Consumer<Integer> configured = port -> {
            if (!tabs.containsKey(tab.id)) return;
            tab.port = port;
            configure(tab, tor.identities(), result -> {
                if (!url.equals("about:blank")) tab.session.loadUri(url);
                done.accept(tab);
            }, error -> { close(tab); fail.accept(error); });
        };
        if (tab.tor) tor.ready(configured, error -> { close(tab); fail.accept(error); });
        else configured.accept(0);
    }
    public void useTor(Tab tab, String url) {
        tab.tor = true; tab.ready = false; tab.pendingUrl = url;
        tab.preparing = true;
        save(tab);
        if (tab.session == null || !tab.session.isOpen()) {
            host.ensure(tab, () -> useTor(tab, url), error -> { tab.preparing = false; message(error); });
            return;
        }
        // Block the route before waiting for Tor bootstrap.
        tab.port = 0;
        tab.session.stop();
        tab.session.loadUri("about:blank");
        Consumer<String> failed = error -> { tab.preparing = false; tab.error = "ERROR_TOR_UNAVAILABLE"; message(error); };
        String context = tab.session.getSettings().getContextId();
        if (context == null || !context.startsWith("bashkitten-tor-")) {
            host.isolate(tab, "bashkitten-tor-" + UUID.randomUUID(), () -> connectTor(tab, failed), failed);
        } else connectTor(tab, failed);
    }
    private void connectTor(Tab tab, Consumer<String> failed) {
        configure(tab, Collections.emptyList(), ignored -> tor.ready(port -> {
            tab.port = port; configure(tab, tor.identities(), result -> { tab.preparing = false; tab.session.loadUri(tab.pendingUrl); }, failed);
        }, failed), failed);
    }
    void configure(Tab tab, List<String> identities, Consumer<JSONObject> done, Consumer<String> fail) {
        try {
            JSONObject params = new JSONObject().put("tor", tab.tor).put("port", tab.port)
                .put("proxySecret", tor.proxySecret()).put("identities", new JSONArray(identities)).put("adblock", tab.adblock);
            save(tab);
            page(tab, "configure", params, value -> { tab.ready = !tab.tor || tab.port != 0; done.accept(value); }, fail);
        } catch (Exception error) { fail.accept("Could not configure tab"); }
    }
    public void setAdblock(Tab tab, boolean enabled, Consumer<JSONObject> done, Consumer<String> fail) {
        tab.adblock = enabled;
        save(tab);
        if (tab.session == null || !tab.session.isOpen()) {
            ensure(tab, () -> {
                try { done.accept(new JSONObject().put("result", true)); }
                catch (JSONException error) { fail.accept("Could not return tab policy"); }
            }, fail);
            return;
        }
        configure(tab, tor.identities(), value -> {
            tab.session.reload(GeckoSession.LOAD_FLAGS_BYPASS_CACHE);
            done.accept(value);
        }, fail);
    }
    void page(Tab tab, String method, JSONObject params, Consumer<JSONObject> done, Consumer<String> fail) {
        try {
            android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
            BashKittenController.initialViewport(tab.session, metrics.widthPixels, metrics.heightPixels);
            BashKittenController.request(tab.session, new JSONObject().put("method", method).put("params", params).toString()).accept(value -> {
                try { JSONObject result = new JSONObject(value); if (result.has("error")) fail.accept(result.getString("error")); else done.accept(result); }
                catch (Exception error) { fail.accept("Invalid page response"); }
            }, error -> fail.accept("Page operation failed"));
        } catch (Exception error) { fail.accept("Page operation unavailable"); }
    }
    void refreshTor(int port, List<String> hosts) {
        for (Tab tab : tabs.values()) if (tab.tor) {
            tab.port = port;
            if (tab.session != null && tab.session.isOpen()) configure(tab, hosts, ignored -> {}, this::message);
        }
    }
    void refreshTorTrust(List<String> hosts) {
        for (Tab tab : tabs.values()) if (tab.tor && tab.session != null && tab.session.isOpen()) {
            tab.session.stop(); configure(tab, hosts, ignored -> {}, this::message);
        }
    }
    void show(Tab tab) { host.show(tab.id); }

    public void openTorTab(String address, Consumer<String> fail) {
        String url;
        try {
            String value = address.trim();
            url = value.isEmpty() ? "about:blank" : webUrl(value.contains("://") ? value : "https://" + value);
        } catch (Exception error) { fail.accept("Enter a website address"); return; }
        create(USER, true, url, this::show, fail);
    }

    public void savedTorSites(Consumer<Map<String, String>> result) {
        tor.list(hosts -> {
            Map<String, String> sites = new TreeMap<>();
            for (String host : hosts) sites.put(host, policies.getString("onion." + host + ".title", host));
            result.accept(sites);
        });
    }

    public void rememberDownload(String id, String tabId) {
        if (tabId == null || policies.contains("download." + id + ".owner")) return;
        String owner = policies.getString(tabId + ".owner", USER);
        policies.edit().putString("download." + id + ".owner", owner).apply();
    }
    boolean ownsDownload(String id, String owner) { return owner.equals(policies.getString("download." + id + ".owner", USER)); }
    public boolean agentTab(String id) { return !USER.equals(policies.getString(id + ".owner", USER)); }
    public void closeUnapprovedTabs() {
        transfers.revokeAll(); commands.revokeAll();
    }
    public void revokeAgentAccess() {
        grants.revokeAll(); commands.revokeAll(); transfers.revokeAll(); remoteControl.disconnect();
        message("Agent access revoked");
    }
    void close(Tab tab) {
        tabs.remove(tab.id);
        // Fenix can restore a closed tab with its original ID and session context.
        save(tab);
        host.close(tab.id);
    }
    void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
}
