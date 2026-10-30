// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.json.JSONObject;

/** Only the enrolled, visible Android Updates document reaches this owner. */
public final class UpdatesSettingsAdapter implements AutoCloseable {
    private final Activity activity;
    private final UpdatesController updates;
    private final Runnable listener;
    private boolean closed;

    UpdatesSettingsAdapter(Activity activity, Consumer<JSONObject> events) {
        this.activity = activity;
        updates = BrowserApp.get(activity).agent.updates;
        listener = () -> { if (!closed) events.accept(AgentSettingsActivity.object("type", "updates", "data", new JSONObject())); };
        updates.observe(listener);
    }
    CompletableFuture<JSONObject> dispatch(String method, JSONObject args) {
        if (closed || activity.isFinishing() || activity.isDestroyed()) return CompletableFuture.failedFuture(new IllegalStateException("Updates view closed."));
        try {
            switch (method) {
                case "updates.snapshot": return updates.snapshot();
                case "updates.check": return updates.check();
                case "updates.channel": return updates.channel(args.getString("channel"));
                case "updates.download": return updates.download(activity);
                case "updates.termux-check": return updates.checkTermux();
                case "updates.termux-download": return updates.downloadTermux(activity);
                case "updates.packages": return updates.packages(args.getString("kind"), args.optBoolean("retry"));
                case "updates.cancel": return updates.cancel();
                case "updates.inventory": return updates.inventory();
                default: throw new SecurityException("Unsupported update operation.");
            }
        } catch (Exception error) { return CompletableFuture.failedFuture(error); }
    }
    @Override public void close() { closed = true; updates.removeObserver(listener); }
}
