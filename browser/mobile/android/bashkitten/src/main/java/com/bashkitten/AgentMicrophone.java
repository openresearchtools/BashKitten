// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import androidx.appcompat.app.AlertDialog;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import java.net.URI;
import java.util.Objects;
import org.mozilla.geckoview.GeckoSession;

/** Ordinary Android and per-recording Gecko approval for the protected Agent. */
final class AgentMicrophone implements GeckoSession.PermissionDelegate {
    static final int REQUEST = 7314;
    private final Activity activity;
    private final AgentRuntime runtime;
    private final GeckoSession session;
    private Callback androidRequest;
    private MediaCallback mediaRequest;
    private AlertDialog dialog;
    private String endpoint, selection;
    private boolean closed;

    AgentMicrophone(Activity activity, AgentRuntime runtime, GeckoSession session) {
        this.activity = activity; this.runtime = runtime; this.session = session;
    }
    private boolean current() {
        return !closed && !activity.isFinishing() && !activity.isDestroyed()
            && runtime.session == session && runtime.isOnRequested() && runtime.state.equals("on")
            && runtime.visible && (endpoint == null || endpoint.equals(runtime.url))
            && (selection == null || selection.equals(runtime.selected));
    }
    private void rememberRequest() { endpoint = runtime.url; selection = runtime.selected; }
    @Override public void onAndroidPermissionsRequest(GeckoSession source, String[] permissions, Callback callback) {
        if (source != session || !current() || androidRequest != null || permissions == null
                || permissions.length != 1 || !Manifest.permission.RECORD_AUDIO.equals(permissions[0])) {
            callback.reject(); return;
        }
        // An existing app grant only satisfies Android. Gecko still asks the
        // user about this exact Agent origin in onMediaPermissionRequest below.
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            callback.grant(); return;
        }
        rememberRequest(); androidRequest = callback;
        try { activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST); }
        catch (RuntimeException error) { rejectPending(); }
    }
    void permissionResult() {
        Callback callback = androidRequest; androidRequest = null;
        if (callback == null) return;
        if (current() && activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) callback.grant();
        else callback.reject();
    }
    private boolean ownOrigin(String address) {
        try {
            URI source = URI.create(address), own = URI.create(runtime.url);
            String path = source.getPath();
            return "https".equals(source.getScheme()) && "https".equals(own.getScheme())
                && source.getUserInfo() == null && own.getUserInfo() == null
                && own.getHost() != null && own.getHost().equalsIgnoreCase(source.getHost())
                && (source.getPort() < 0 ? 443 : source.getPort()) == (own.getPort() < 0 ? 443 : own.getPort())
                && (Objects.equals(path, "/") || Objects.equals(path, ""));
        } catch (IllegalArgumentException error) { return false; }
    }
    @Override public void onMediaPermissionRequest(GeckoSession source, String uri, MediaSource[] video,
                                                  MediaSource[] audio, MediaCallback callback) {
        if (source != session || !current() || !ownOrigin(uri) || mediaRequest != null
                || video != null && video.length != 0 || audio == null || audio.length == 0
                || activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            callback.reject(); return;
        }
        MediaSource microphone = null;
        for (MediaSource candidate : audio) {
            if (candidate.type == MediaSource.TYPE_AUDIO && candidate.source == MediaSource.SOURCE_MICROPHONE) {
                microphone = candidate; break;
            }
        }
        if (microphone == null) { callback.reject(); return; }
        final MediaSource selectedMicrophone = microphone;
        rememberRequest(); mediaRequest = callback;
        String host = runtime.selected.equals("local") ? "Local Agent" : URI.create(runtime.url).getHost();
        try {
            dialog = new MaterialAlertDialogBuilder(activity)
                .setTitle("Allow microphone?")
                .setMessage("Allow " + host + " to use your microphone for this recording? Audio is sent to this Agent for transcription.")
                .setPositiveButton("Allow", (ignored, which) -> {
                    MediaCallback pending = mediaRequest; mediaRequest = null;
                    if (pending == null) return;
                    if (current() && ownOrigin(uri)
                            && activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        pending.grant((MediaSource) null, selectedMicrophone);
                    } else pending.reject();
                })
                .setNegativeButton("Don't allow", (ignored, which) -> rejectPending())
                .setOnCancelListener(ignored -> rejectPending())
                .create();
            dialog.setOnDismissListener(ignored -> { dialog = null; rejectPending(); });
            dialog.show();
        } catch (RuntimeException error) { rejectPending(); }
    }
    void changed() { if (!current()) rejectPending(); }
    void navigated() { rejectPending(); }
    private void rejectPending() {
        Callback android = androidRequest; androidRequest = null;
        MediaCallback media = mediaRequest; mediaRequest = null;
        endpoint = selection = null;
        if (android != null) android.reject();
        if (media != null) media.reject();
        AlertDialog pending = dialog; dialog = null;
        if (pending != null) pending.dismiss();
    }
    void close() { closed = true; rejectPending(); session.setPermissionDelegate(null); }
}
