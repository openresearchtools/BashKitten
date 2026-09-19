// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

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
    public interface Provider { BrowserApp wildBuzzard(); }
    public interface Host {
        Tab create(String owner, String contextId);
        Tab selected();
        boolean refresh(Tab tab);
        void close(String id);
        void show(String id);
        void desktop(String id, boolean enabled);
        void screenshot(String id, Consumer<Bitmap> result);
        Intent launchIntent();
    }
    public static BrowserApp get(Context context) { return ((Provider) context.getApplicationContext()).wildBuzzard(); }
    public final Handler main = new Handler(Looper.getMainLooper());
    final AppGrants grants;
    final TorManager tor;
    final SharedPreferences policies;
    public final Host host;
    final LinkedHashMap<String, Tab> tabs = new LinkedHashMap<>();
    public static final String USER = "local-user";
    public static final class Tab {
        public final String id, owner;
        public GeckoSession session;
        public String url = "about:blank", title = "New tab", error = "";
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
        String owner = policies.getString(tab.id + ".owner", parent == null ? tab.owner : parent.owner);
        Tab value = new Tab(tab.id, owner, tab.session);
        value.tor = policies.getBoolean(tab.id + ".tor", parent != null && parent.tor);
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
        if (tab.tor) useTor(tab, url);
        else configure(tab, Collections.emptyList(), ignored -> {
            tab.preparing = false; tab.session.loadUri(tab.pendingUrl);
        }, error -> { tab.preparing = false; message(error); });
        return true;
    }
    public Tab forSession(GeckoSession session) {
        for (Tab tab : tabs.values()) if (tab.session == session) return tab;
        return null;
    }
    void refresh() { tabs.values().removeIf(tab -> !host.refresh(tab)); }
    Tab owned(String id, String owner) {
        refresh(); Tab tab = tabs.get(id);
        if (tab == null || !tab.owner.equals(owner)) throw new SecurityException("Tab is not owned by this app");
        return tab;
    }
    void create(String owner, boolean useTor, String url, Consumer<Tab> done, Consumer<String> fail) {
        refresh();
        if (tabs.size() >= 64 || tabs.values().stream().filter(t -> t.owner.equals(owner)).count() >= 16) { fail.accept("Tab limit reached"); return; }
        Tab tab = host.create(owner, "wildbuzzard-" + UUID.randomUUID());
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
        // Block the route before waiting for Tor bootstrap.
        tab.port = 0;
        tab.session.stop();
        tab.session.loadUri("about:blank");
        Consumer<String> failed = error -> { tab.preparing = false; message(error); };
        configure(tab, Collections.emptyList(), ignored -> tor.ready(port -> {
            tab.port = port; configure(tab, tor.identities(), result -> { tab.preparing = false; tab.session.loadUri(tab.pendingUrl); }, error -> { tab.preparing = false; message(error); });
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
    void setAdblock(Tab tab, boolean enabled, Consumer<JSONObject> done, Consumer<String> fail) {
        tab.adblock = enabled;
        configure(tab, tor.identities(), value -> { tab.session.reload(); done.accept(value); }, fail);
    }
    void page(Tab tab, String method, JSONObject params, Consumer<JSONObject> done, Consumer<String> fail) {
        try {
            WildBuzzardController.request(tab.session, new JSONObject().put("method", method).put("params", params).toString()).accept(value -> {
                try { JSONObject result = new JSONObject(value); if (result.has("error")) fail.accept(result.getString("error")); else done.accept(result); }
                catch (Exception error) { fail.accept("Invalid page response"); }
            }, error -> fail.accept("Page operation failed"));
        } catch (Exception error) { fail.accept("Page operation unavailable"); }
    }
    void refreshTor(int port, List<String> hosts) {
        for (Tab tab : tabs.values()) if (tab.tor) { tab.port = port; configure(tab, hosts, ignored -> {}, this::message); }
    }
    void refreshTorTrust(List<String> hosts) {
        for (Tab tab : tabs.values()) if (tab.tor) { tab.session.stop(); configure(tab, hosts, ignored -> {}, this::message); }
    }
    void show(Tab tab) { host.show(tab.id); }
    void close(Tab tab) {
        tabs.remove(tab.id);
        // Fenix can restore a closed tab with its original ID and session context.
        save(tab);
        host.close(tab.id);
    }
    void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
}
