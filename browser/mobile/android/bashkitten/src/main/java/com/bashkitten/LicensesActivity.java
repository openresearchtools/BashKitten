// SPDX-License-Identifier: GPL-3.0-only
package com.bashkitten;

import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.InputStream;
import org.mozilla.geckoview.*;

/** Bundled component notices remain available before login or service setup. */
public final class LicensesActivity extends ProductActivity {
    private GeckoSession session;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); setTitle("Bundled component licenses");
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        BrowserApp app = BrowserApp.get(this);
        session = new GeckoSession(new GeckoSessionSettings.Builder().contextId("bashkitten-agent-ui-about").build());
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession source, LoadRequest request) {
                if (request.uri.equals("resource://android/assets/about.html")) return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                if (request.uri.startsWith("https://") || request.uri.startsWith("http://")) {
                    app.create(BrowserApp.USER, BrowserApp.onion(request.uri), request.uri, app::show, app::message);
                }
                return GeckoResult.fromValue(AllowOrDeny.DENY);
            }
        });
        session.open(app.host.runtime());
        GeckoView view = new GeckoView(this); view.setSession(session); root.addView(view, new LinearLayout.LayoutParams(-1, 0, 1));
        try (InputStream input = getAssets().open("about.html")) { session.loadUri("resource://android/assets/about.html"); }
        catch (Exception error) { TextView text = new TextView(this); text.setText("This build is missing its required offline license inventory."); root.addView(text); }
        showContent(root, false);
    }
    @Override protected void onDestroy() { if (session != null) session.close(); super.onDestroy(); }
}
