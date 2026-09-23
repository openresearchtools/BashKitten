// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Single-use foreground-tab tickets shared by the native Binder entry points. */
final class CommandGateway {
    private final BrowserApp app;
    private final Map<String, Launch> launches = new HashMap<>();
    private static final class Launch {
        final AgentController.Access access;
        final String tab;
        Launch(AgentController.Access access, String tab) { this.access = access; this.tab = tab; }
    }
    CommandGateway(BrowserApp app) { this.app = app; }
    synchronized void revokeAll() { launches.clear(); }
    synchronized String launch(AgentController.Access access, String tab) {
        access.check.run(); app.owned(tab, access.owner);
        String nonce = UUID.randomUUID().toString();
        launches.put(nonce, new Launch(access, tab));
        return nonce;
    }
    void show(String nonce) {
        Launch launch;
        synchronized (this) { launch = launches.remove(nonce); }
        if (launch == null) throw new SecurityException("Launch is unavailable");
        launch.access.check.run(); app.show(app.owned(launch.tab, launch.access.owner));
    }
}
