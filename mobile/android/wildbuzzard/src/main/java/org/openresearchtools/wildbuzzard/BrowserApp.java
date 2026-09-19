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
    public final Host host;
    final LinkedHashMap<String, Tab> tabs = new LinkedHashMap<>();
    public static final String USER = "local-user";
    public static final class Tab {
        public final String id, owner;
        public final GeckoSession session;
        public String url = "about:blank", title = "New tab", error = "";
        public boolean loading, desktop, tor, adblock = true;
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
    public Tab track(Tab tab) {
        Tab current = tabs.get(tab.id);
        if (current == null) { tabs.put(tab.id, tab); return tab; }
        host.refresh(current); return current;
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
        tab.tor = true;
        // Install the dead route synchronously before waiting for Tor bootstrap.
        tab.port = 0;
        configure(tab, Collections.emptyList(), ignored -> tor.ready(port -> {
            tab.port = port; configure(tab, tor.identities(), result -> tab.session.loadUri(url), this::message);
        }, this::message), this::message);
    }
    void configure(Tab tab, List<String> identities, Consumer<JSONObject> done, Consumer<String> fail) {
        try {
            JSONObject params = new JSONObject().put("tor", tab.tor).put("port", tab.port)
                .put("identities", new JSONArray(identities)).put("adblock", tab.adblock);
            page(tab, "configure", params, done, fail);
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
    void close(Tab tab) { tabs.remove(tab.id); host.close(tab.id); }
    void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
}
