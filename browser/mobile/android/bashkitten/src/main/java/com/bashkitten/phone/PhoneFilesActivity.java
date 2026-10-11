// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import org.json.*;
import java.util.UUID;
import java.util.concurrent.*;

/** Owns only Android's folder picker. Folder policy is edited in the protected settings page. */
public final class PhoneFilesActivity extends Activity {
    private static final ConcurrentHashMap<String, CompletableFuture<JSONObject>> requests = new ConcurrentHashMap<>();
    private String requestId;
    private CompletableFuture<JSONObject> result;
    private boolean saving;
    static CompletableFuture<JSONObject> pick(Activity activity) {
        String id = UUID.randomUUID().toString(); CompletableFuture<JSONObject> result = new CompletableFuture<>(); requests.put(id, result);
        result.whenComplete((value, error) -> requests.remove(id, result));
        activity.runOnUiThread(() -> {
            try {
                if (result.isDone() || activity.isFinishing() || activity.isDestroyed()) throw new IllegalStateException("Settings closed.");
                activity.startActivity(new Intent(activity, PhoneFilesActivity.class).putExtra("request", id));
            } catch (Exception error) { result.completeExceptionally(error); }
        }); return result;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); requestId = getIntent().getStringExtra("request"); result = requestId == null ? null : requests.get(requestId);
        if (result == null || result.isDone()) { finish(); return; }
        result.whenComplete((value, error) -> runOnUiThread(() -> { if (!isFinishing()) finish(); }));
        if (state == null) try {
            startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION), 1);
        } catch (Exception error) { result.completeExceptionally(error); }
    }
    @Override public void onActivityResult(int request, int status, Intent data) {
        super.onActivityResult(request, status, data);
        if (request != 1 || result == null || result.isDone()) return;
        if (status != RESULT_OK || data == null || data.getData() == null) { result.complete(new JSONObject()); return; }
        Uri uri = data.getData(); int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        saving = true;
        CompletableFuture.runAsync(() -> {
            try {
                if (result.isDone()) return;
                PhonePolicy policy = PhoneControlsRuntime.get(this).policy;
                synchronized (policy) {
                    if (result.isDone()) return;
                    getContentResolver().takePersistableUriPermission(uri, flags);
                    JSONArray items = new PhoneFiles(this, policy).locations();
                    boolean exists = false;
                    for (int i = 0; i < items.length(); i++) if (uri.toString().equals(items.getJSONObject(i).optString("uri"))) { exists = true; break; }
                    if (!exists) items.put(new JSONObject().put("id", UUID.randomUUID()).put("uri", uri).put("name", uri.getLastPathSegment()).put("read", true).put("write", false).put("delete", false));
                    policy.preferences.edit().putString("locations", items.toString()).apply(); policy.changed();
                }
                result.complete(new JSONObject().put("added", true));
            } catch (Exception error) { result.completeExceptionally(new IllegalStateException("Android did not grant this folder.", error)); }
        });
    }
    @Override public void onDestroy() {
        if (!isChangingConfigurations() && !saving && result != null && !result.isDone()) result.completeExceptionally(new IllegalStateException("Folder picker closed."));
        super.onDestroy();
    }
}
