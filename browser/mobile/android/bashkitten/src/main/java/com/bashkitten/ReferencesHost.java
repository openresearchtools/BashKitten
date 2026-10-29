// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import java.util.function.Consumer;
import java.util.function.BooleanSupplier;
import java.util.HashMap;
import java.util.ArrayList;
import org.json.JSONObject;
import org.mozilla.geckoview.BashKittenController;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.WebExtension;

/** Fixed APK shim. Capture, translators, selection and resolver jobs live outside it. */
final class ReferencesHost {
    private static final String ID = "references-host@bashkitten.org";
    private static final String CAPTURE_ID = "references@bashkitten.org";
    private static WebExtension.Port resolverPort;
    private static final HashMap<String, Pending> pending = new HashMap<>();
    private static final class Pending {
        String backendId, projectId;
        BooleanSupplier current;
        Consumer<JSONObject> done;
        Consumer<String> fail;
        Runnable timeout;
    }
    private static boolean host(WebExtension.MessageSender sender) {
        return ID.equals(sender.webExtension.id) && sender.session == null &&
            sender.environmentType == WebExtension.MessageSender.ENV_TYPE_EXTENSION;
    }
    static void install(BrowserApp app) {
        app.host.runtime().getWebExtensionController()
            .ensureBuiltIn("resource://android/assets/references-host/", ID)
            .accept(extension -> extension.setMessageDelegate(new WebExtension.MessageDelegate() {
                @Override public void onConnect(WebExtension.Port port) {
                    if (!"bashkitten_references".equals(port.name) || !host(port.sender)) { port.disconnect(); return; }
                    if (resolverPort != null) resolverPort.disconnect();
                    resolverPort = port;
                    port.setDelegate(new WebExtension.PortDelegate() {
                        @Override public void onDisconnect(WebExtension.Port closed) {
                            if (resolverPort != closed) return;
                            resolverPort = null;
                            for (String id : new ArrayList<>(pending.keySet())) finish(app, id, null, "References capture disconnected.");
                        }
                    });
                }
                @Override public GeckoResult<Object> onMessage(String name, Object message, WebExtension.MessageSender sender) {
                    GeckoResult<Object> result = new GeckoResult<>();
                    if (!"bashkitten_references".equals(name) || !host(sender) ||
                        !(message instanceof JSONObject)) {
                        result.completeExceptionally(new SecurityException("The References background host is required."));
                        return result;
                    }
                    app.agent.referencesRequest((JSONObject) message, result::complete,
                        error -> {
                            try {
                                // Native-message exceptions lose their text at Gecko's
                                // extension boundary. Keep validated operation failures
                                // in the existing v1 response instead.
                                String text = error == null || error.isBlank() ? "References request failed." : error;
                                result.complete(new JSONObject().put("apiVersion", 1).put("status", 400)
                                    .put("body", new JSONObject().put("error", text.substring(0, Math.min(500, text.length())))));
                            } catch (Exception failure) { result.completeExceptionally(failure); }
                        });
                    return result;
                }
            }, "bashkitten_references"), error -> app.message("References host is unavailable: " + error.getMessage()));
        // ensureBuiltIn replaces a different version even when it came from a
        // normal signed install. Preserve such independently installed updates.
        var controller = app.host.runtime().getWebExtensionController();
        controller.list().accept(extensions -> {
            for (WebExtension extension : extensions) {
                if (CAPTURE_ID.equals(extension.id) && !extension.isBuiltIn) return;
            }
            controller.ensureBuiltIn("resource://android/assets/references/", CAPTURE_ID)
                .accept(extension -> {}, error -> app.message("References capture is unavailable: " + error.getMessage()));
        }, error -> app.message("References capture is unavailable: " + error.getMessage()));
    }

    static void dispatch(BrowserApp app, JSONObject request, BooleanSupplier current, Consumer<JSONObject> done, Consumer<String> fail) throws Exception {
        String id = request.getString("requestId");
        if (resolverPort == null) throw new IllegalStateException("References capture is not ready.");
        if (pending.containsKey(id) || pending.size() >= 32) throw new IllegalStateException("A resolver request is already pending.");
        Pending value = new Pending(); value.backendId = request.getString("backendId"); value.projectId = request.getString("projectId");
        value.current = current; value.done = done; value.fail = fail;
        value.timeout = () -> finish(app, id, null, "Resolver browser response timed out; check the job status.");
        pending.put(id, value); app.main.postDelayed(value.timeout, 600000);
        try { resolverPort.postMessage(request.put("operation", "resolver")); }
        catch (Exception error) { finish(app, id, null, "References capture disconnected."); }
    }
    static void reconcile(BrowserApp app) {
        for (String id : new ArrayList<>(pending.keySet())) if (!pending.get(id).current.getAsBoolean()) finish(app, id, null, "The selected backend changed.");
    }
    static void complete(BrowserApp app, JSONObject result) throws Exception {
        String id = result.getString("requestId"); Pending value = pending.get(id);
        if (value == null || !value.current.getAsBoolean() || !value.backendId.equals(result.optString("backendId")) ||
            !value.projectId.equals(result.optString("projectId")) || result.toString().length() > 8192) throw new SecurityException("Resolver request is no longer active.");
        finish(app, id, result.optJSONObject("result"), result.has("error") ? result.optString("error").substring(0, Math.min(500, result.optString("error").length())) : null);
    }
    private static void finish(BrowserApp app, String id, JSONObject result, String error) {
        Pending value = pending.remove(id); if (value == null) return;
        app.main.removeCallbacks(value.timeout);
        if (error != null) value.fail.accept(error); else value.done.accept(result == null ? new JSONObject() : result);
    }

    /** Reuse the enrolled Agent's existing authenticated Gecko request owner. */
    static void request(GeckoSession session, String origin, String path, String csrf, JSONObject body,
                        Consumer<JSONObject> done, Consumer<String> fail) {
        try {
            JSONObject params = new JSONObject().put("origin", origin).put("path", path);
            if (csrf != null) params.put("csrf", csrf);
            if (body != null) params.put("body", body);
            BashKittenController.request(session, new JSONObject().put("method", "agent.request").put("params", params).toString()).accept(text -> {
                try {
                    JSONObject reply = new JSONObject(text);
                    if (reply.has("error")) { fail.accept(reply.getString("error")); return; }
                    done.accept(reply.getJSONObject("result"));
                } catch (Exception error) { fail.accept("Invalid References host response."); }
            }, error -> fail.accept("The owning backend disconnected."));
        } catch (Exception error) { fail.accept("The owning backend disconnected."); }
    }
}
