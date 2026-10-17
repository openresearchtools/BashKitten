// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.ContactsContract;
import android.telecom.*;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;

/** Single native owner. Gateway installation is private application wiring, never a web/Intent API. */
public final class TelephonyRuntime {
    private static final String CALL_DOMAIN = "bashkitten.local";
    private static final String GENERAL_ALIAS = "kitten-phone@" + CALL_DOMAIN;
    private static final java.util.regex.Pattern BACKEND_ALIAS = java.util.regex.Pattern.compile(
        "kitten-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@bashkitten\\.local");
    public interface Backend {
        CompletableFuture<JSONObject> request(String action, JSONObject payload);
        CompletableFuture<byte[]> audio(String action, byte[] bytes, JSONObject metadata);
        void cancel(String requestId);
        boolean connected();
        String connectionState();
        CompletableFuture<Void> prepare();
        CompletableFuture<Void> prepare(String backendId);
    }
    private static TelephonyRuntime instance;
    public static synchronized TelephonyRuntime get(Context context) {
        if (instance == null) instance = new TelephonyRuntime(context.getApplicationContext());
        return instance;
    }
    final Context context;
    final ScheduledExecutorService serial = Executors.newSingleThreadScheduledExecutor();
    final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicFile file;
    private final TelecomHelper telecom;
    private final Map<String, KittenConnection> calls = new HashMap<>();
    private final Map<String, Long> callErrorRevisions = new HashMap<>();
    private final Set<Consumer<JSONObject>> observers = new HashSet<>();
    private JSONObject state;
    volatile Backend gateway;
    private boolean serviceReady;
    private String error = "";
    private String errorCallId;
    private long errorRevision;
    private Runnable openLocalAI;
    private Consumer<Boolean> enabledListener;
    public void setEnabledListener(Consumer<Boolean> listener) { execute(() -> enabledListener = listener); }
    public void transportError(String error) { execute(() -> failed(new IllegalStateException(error))); }
    public void connectionChanged() { execute(this::changed); }
    public String connectionState() { Backend current = gateway; return current == null ? "not-started" : current.connectionState(); }
    public CompletableFuture<JSONObject> settingsSnapshot() { return job(() -> new JSONObject(settings().toString())); }
    public CompletableFuture<JSONObject> startupSnapshot() { return job(() -> json("enabled", settings().optBoolean("startup"), "available", true,
        "detail", enabled("telephony") || enabled("messages") ? "Restores enabled calling and message connections when BashKitten opens. Local must be available." : "Turn on Calls or Messages in Callback settings to use this option.")); }
    public CompletableFuture<JSONObject> setStartup(boolean enabled) { return configure(json("startup", enabled)).thenCompose(ignored -> startupSnapshot()); }
    private TelephonyRuntime(Context context) {
        this.context = context; telecom = new TelecomHelper(context);
        file = new AtomicFile(new File(context.getFilesDir(), "phone-delivery.json"));
    }
    void execute(Runnable action) { execute(action, failure -> {}); }
    private void execute(Runnable action, Consumer<Exception> rejected) {
        serial.execute(() -> { try { load(); action.run(); } catch (Exception failure) { rejected.accept(failure); failed(failure); } });
    }
    private void load() throws Exception {
        if (state != null) return;
        try (InputStream input = file.openRead()) { state = new JSONObject(new String(input.readAllBytes(), StandardCharsets.UTF_8)); }
        catch (FileNotFoundException missing) { state = new JSONObject(); }
        if (!state.has("settings")) state.put("settings", json("telephony", false, "messages", false, "startup", false, "recent", 5, "finish", "either", "silenceSeconds", 4, "ordinaryDefault", "off", "callDefault", "calls"));
        for (String key : new String[]{"backends", "events", "mailbox", "tombstones", "acceptAfter"}) if (!state.has(key)) state.put(key, new JSONObject());
    }
    void save() {
        FileOutputStream output = null;
        try { output = file.startWrite(); output.write(state.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(output); }
        catch (IOException failure) { file.failWrite(output); throw new IllegalStateException("Phone settings could not be saved", failure); }
    }
    public static JSONObject json(Object... pairs) {
        JSONObject value = new JSONObject();
        try { for (int i = 0; i < pairs.length; i += 2) value.put(String.valueOf(pairs[i]), pairs[i + 1]); }
        catch (JSONException invalid) { throw new IllegalArgumentException(invalid); }
        return value;
    }
    JSONObject settings() { return state.optJSONObject("settings"); }
    boolean enabled(String key) { return settings().optBoolean(key); }
    JSONObject backend(String id) { return state.optJSONObject("backends").optJSONObject(id); }
    String label(String id) { JSONObject value = backend(id); return value == null ? "Unavailable backend" : value.optString("name", "BashKitten"); }
    void failed(Throwable failure) { recordFailure(null, failure); }
    void callFailed(String callId, Throwable failure) { recordFailure(callId, failure); }
    Runnable callRecovery(String callId) {
        long previous = errorRevision;
        return () -> {
            if (Objects.equals(errorCallId, callId) && errorRevision == previous) { clearError(); changed(); }
        };
    }
    private void recordFailure(String callId, Throwable failure) { errorCallId = callId; errorRevision++; error = failure.getMessage() == null ? "Phone operation failed" : failure.getMessage(); changed(); }
    private void clearError() { error = ""; errorCallId = null; errorRevision++; }
    private void changed() { JSONObject snapshot = snapshot(); for (Consumer<JSONObject> observer : new ArrayList<>(observers)) main.post(() -> observer.accept(snapshot)); }
    private JSONObject snapshot() {
        if (state == null) return json("error", error);
        JSONObject copy; try { copy = new JSONObject(state.toString()); } catch (JSONException invalid) { throw new IllegalStateException(invalid); }
        return json("settings", copy.optJSONObject("settings"), "backends", copy.optJSONObject("backends"), "mailbox", copy.optJSONObject("mailbox"),
            "connected", gateway != null && gateway.connected(), "error", error, "activeCalls", calls.size());
    }
    public void observe(Consumer<JSONObject> listener) { serial.execute(() -> observers.add(listener)); execute(this::changed); }
    public void unobserve(Consumer<JSONObject> listener) { serial.execute(() -> observers.remove(listener)); }
    public void install(Backend backend, Runnable openLocalAI) {
        execute(() -> { this.gateway = backend; this.openLocalAI = openLocalAI; clearError(); changed(); });
    }
    public void openLocalAI() { if (openLocalAI != null) main.post(openLocalAI); }
    public CompletableFuture<JSONObject> configure(JSONObject patch) {
        CompletableFuture<JSONObject> done = new CompletableFuture<>();
        execute(() -> {
            try {
                JSONObject next = new JSONObject(settings().toString());
                Iterator<String> keys = patch.keys();
                while (keys.hasNext()) {
                    String key = keys.next(); Object value = patch.get(key);
                    switch (key) {
                        case "telephony": case "messages": case "startup": if (!(value instanceof Boolean)) throw new IllegalArgumentException("Invalid switch"); break;
                        case "recent": if (!(value instanceof Number) || ((Number)value).intValue() < 1 || ((Number)value).intValue() > 9) throw new IllegalArgumentException("Choose 1–9 recent chats"); break;
                        case "silenceSeconds": if (!(value instanceof Number) || !Double.isFinite(((Number)value).doubleValue()) || ((Number)value).doubleValue() <= 0) throw new IllegalArgumentException("Silence must be a positive duration"); break;
                        case "finish": if (!List.of("hash", "silence", "either").contains(value)) throw new IllegalArgumentException("Invalid dictation completion"); break;
                        case "ordinaryDefault": if (!List.of("off", "call-in", "messages", "calls").contains(value)) throw new IllegalArgumentException("Invalid chat default"); break;
                        case "callDefault": if (!List.of("call-in", "messages", "calls").contains(value)) throw new IllegalArgumentException("Call chats must allow calls"); break;
                        default: throw new IllegalArgumentException("Unknown phone setting");
                    }
                    next.put(key, value);
                }
                for (String master : List.of("telephony", "messages")) if (next.optBoolean(master) && !enabled(master)) put(state.optJSONObject("acceptAfter"), master, System.currentTimeMillis());
                boolean mastersChanged = next.optBoolean("telephony") != enabled("telephony") || next.optBoolean("messages") != enabled("messages");
                state.put("settings", next); save();
                if (mastersChanged && enabledListener != null) main.post(() -> enabledListener.accept(next.optBoolean("telephony") || next.optBoolean("messages")));
                if (!enabled("telephony")) {
                    for (KittenConnection call : new ArrayList<>(calls.values())) end(call, DisconnectCause.CANCELED);
                    telecom.unregister(); invalidateRoute("calls");
                }
                if (!enabled("messages")) { invalidateRoute("messages"); PhoneNotifications.clear(context); }
                clearError(); changed();
                // Master changes synchronize after the enabled listener starts transport.
                // Other settings still report actual synchronization failures.
                if (!mastersChanged && gateway != null && (enabled("telephony") || enabled("messages"))) gateway.request("phone.settings", json("settings", next)).whenComplete((v,e) -> { if (e != null) execute(() -> failed(e)); });
                done.complete(snapshot());
            } catch (Exception failure) { done.completeExceptionally(failure); failed(failure); }
        }, done::completeExceptionally);
        return done;
    }
    private void invalidateRoute(String route) {
        JSONObject events = state.optJSONObject("events");
        for (String id : new ArrayList<>(keys(events))) {
            JSONObject event = events.optJSONObject(id);
            if (route.equals(event.optString("route"))) {
                events.remove(id); state.optJSONObject("tombstones").remove(id);
                put(state.optJSONObject("tombstones"), id, "withdrawn");
            }
        }
        save();
    }
    static java.util.List<String> keys(JSONObject value) { java.util.List<String> result = new java.util.ArrayList<>(); value.keys().forEachRemaining(result::add); return result; }
    static void put(JSONObject object, String key, Object value) { try { object.put(key, value); } catch (JSONException error) { throw new IllegalArgumentException(error); } }
    public CompletableFuture<JSONObject> setupAccount() {
        return job(() -> { if (!enabled("telephony")) throw new IllegalStateException("Turn on Telephony first"); telecom.register(); return json("enabled", telecom.enabled()); });
    }
    public CompletableFuture<JSONObject> readiness() {
        return job(() -> {
            boolean account = false; String reason = "";
            try { if (enabled("telephony")) account = telecom.enabled(); } catch (Exception unsupported) { reason = unsupported.getMessage(); }
            return json("accountEnabled", account, "reason", reason, "gateway", gateway != null && gateway.connected(),
                "microphone", context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
        });
    }
    private <T> CompletableFuture<T> job(Callable<T> work) {
        CompletableFuture<T> result = new CompletableFuture<>();
        execute(() -> { try { result.complete(work.call()); } catch (Exception error) { result.completeExceptionally(error); failed(error); } }, result::completeExceptionally); return result;
    }
    /** Called by authenticated owner registration; identity is never taken from a display name. */
    public CompletableFuture<JSONObject> registerBackend(String id, String name, String generation) {
        return job(() -> {
            if (id == null || id.isBlank() || generation == null || generation.isBlank()) throw new IllegalArgumentException("Missing backend identity");
            JSONObject old = backend(id);
            if (old != null && old.optBoolean("revoked")) throw new IllegalArgumentException("Revoked backend identity cannot be reused");
            if (old != null) requireBackendAlias(old.optString("alias"));
            JSONObject value = old == null ? json("alias", "kitten-" + UUID.randomUUID() + "@" + CALL_DOMAIN, "divert", false) : old;
            put(value, "name", name); put(value, "generation", generation); put(state.optJSONObject("backends"), id, value); save(); changed(); return value;
        });
    }
    public void revokeBackend(String id) {
        execute(() -> {
            JSONObject value = backend(id); if (value == null) return;
            put(value, "revoked", true); save();
            for (KittenConnection call : new ArrayList<>(calls.values())) if (id.equals(call.backend)) end(call, DisconnectCause.CANCELED);
            withdraw(id, null); changed();
        });
    }
    private static String requireBackendAlias(String alias) {
        if (!BACKEND_ALIAS.matcher(alias).matches()) throw new IllegalArgumentException("Unsupported backend calling address");
        return alias;
    }
    Uri address(String id) {
        if (id == null) return Uri.parse("sip:" + GENERAL_ALIAS);
        JSONObject value = backend(id); if (value == null || value.optBoolean("revoked")) throw new IllegalArgumentException("Backend is no longer registered");
        return Uri.parse("sip:" + requireBackendAlias(value.optString("alias")));
    }
    String route(Uri address) {
        if (address == null || !"sip".equals(address.getScheme()) || !address.isOpaque() || address.getFragment() != null) throw new IllegalArgumentException("Unknown calling address");
        String alias = address.getSchemeSpecificPart();
        if (GENERAL_ALIAS.equals(alias)) return null;
        requireBackendAlias(alias);
        JSONObject backends = state.optJSONObject("backends");
        for (String id : keys(backends)) if (alias.equals(backends.optJSONObject(id).optString("alias")) && !backends.optJSONObject(id).optBoolean("revoked")) return id;
        throw new IllegalArgumentException("This calling contact was removed or revoked");
    }
    public CompletableFuture<Intent> contact(String backendId) {
        return job(() -> {
            String address = address(backendId).getSchemeSpecificPart(); ArrayList<ContentValues> rows = new ArrayList<>();
            // A telephone-number field can strip a SIP address to digits and offer a cellular call.
            // Keep the managed calling address only in Android's SIP contact field.
            ContentValues sip = new ContentValues(); sip.put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.SipAddress.CONTENT_ITEM_TYPE);
            sip.put(ContactsContract.CommonDataKinds.SipAddress.SIP_ADDRESS, address); rows.add(sip);
            return new Intent(Intent.ACTION_INSERT).setType(ContactsContract.RawContacts.CONTENT_TYPE)
                .putExtra(ContactsContract.Intents.Insert.NAME, backendId == null ? "Kitten" : "Kitten · " + label(backendId))
                .putParcelableArrayListExtra(ContactsContract.Intents.Insert.DATA, rows);
        });
    }
    public void call(String backendId) { execute(() -> { if (!enabled("telephony")) throw new IllegalStateException("Telephony is off"); telecom.call(address(backendId)); }); }
    Connection connection(ConnectionRequest request, boolean incoming) {
        KittenConnection call = new KittenConnection(this, incoming);
        execute(() -> {
            try {
                if (!enabled("telephony") || !telecom.account().equals(request.getAccountHandle())) throw new SecurityException("BashKitten Telephony is off or the account does not match");
                call.backend = route(request.getAddress());
                Bundle details = request.getExtras() == null ? null : request.getExtras().getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS);
                call.eventId = details == null ? null : details.getString("eventId");
                if (incoming) {
                    JSONObject event = event(call.eventId); requireEvent(event, "calls", true);
                    if (state.optJSONObject("tombstones").has(call.eventId)) throw new SecurityException("Phone invitation was resolved");
                    for (KittenConnection owned : calls.values()) if (!owned.ended && Objects.equals(owned.backend, call.backend)) throw new SecurityException("Call is already presented");
                    if (!Objects.equals(call.backend, event.optString("backendId"))) throw new SecurityException("Caller identity does not match the invitation");
                    if(event.optLong("expiresAt",Long.MAX_VALUE)<System.currentTimeMillis()){
                        if(!event.optString("kind").equals("question"))mailbox(call.eventId);else finishEvent(call.eventId,"expired");
                        missedIncoming(call.eventId);call.ended=true;call.disconnect(DisconnectCause.CANCELED,"Invitation expired");return;
                    }
                }
                call.setAddress(request.getAddress(), TelecomManager.PRESENTATION_ALLOWED);
                call.setCallerDisplayName(call.backend == null ? "Kitten" : label(call.backend), TelecomManager.PRESENTATION_ALLOWED);
                calls.put(call.id, call);
                if (incoming) {
                    for (String id : keys(state.optJSONObject("events"))) { JSONObject waiting = event(id); if (!id.equals(call.eventId) && call.eventId.equals(waiting.optString("ringId"))) call.waitingEvents.add(waiting); }
                    call.setRinging(); serial.schedule(() -> { if (!call.answered && !call.ended) end(call, DisconnectCause.MISSED); }, 45, TimeUnit.SECONDS);
                } else { call.setDialing(); answer(call); }
            } catch (Exception failure) { call.ended = true; callErrorRevisions.remove(call.id); call.disconnect(DisconnectCause.ERROR, failure.getMessage()); callFailed(call.id, failure); }
        });
        return call;
    }
    void answer(KittenConnection call) {
        if (call.ended || call.answered || call.preparing) return;
        callErrorRevisions.put(call.id, errorRevision);
        if (!enabled("telephony") || gateway == null) { end(call, DisconnectCause.ERROR); callFailed(call.id, new IllegalStateException("Phone's Termux gateway is unavailable")); return; }
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { end(call, DisconnectCause.ERROR); callFailed(call.id, new IllegalStateException("Allow the microphone in Phone settings before calling")); return; }
        call.preparing = true;
        gateway.prepare().whenComplete((ready,error) -> execute(() -> {
            call.preparing = false;
            if (call.ended) return;
            if(error != null || !enabled("telephony")) { if(error != null)callFailed(call.id,error); end(call,DisconnectCause.ERROR); return; }
            if(call.incoming) { try { requireEvent(event(call.eventId),"calls"); } catch(Exception expired) { JSONObject original=event(call.eventId);if(original!=null&&!original.optString("kind").equals("question")&&enabled("telephony")){mailbox(call.eventId);call.eventId=null;}callFailed(call.id,expired); end(call,DisconnectCause.CANCELED); return; } }
            call.answered = true; call.setActive();
            try { context.startForegroundService(new Intent(context, PhoneCallService.class)); }
            catch (RuntimeException denied) { callFailed(call.id,denied); end(call, DisconnectCause.ERROR); return; }
            if (serviceReady) startFlow(call);
        }));
    }
    void voiceServiceReady(boolean ready, String reason) {
        serviceReady = ready;
        for (KittenConnection call : new ArrayList<>(calls.values())) if (call.answered && !call.ended) {
            if (ready) startFlow(call); else { callFailed(call.id,new IllegalStateException(reason)); end(call, DisconnectCause.ERROR); }
        }
    }
    private void startFlow(KittenConnection call) {
        if (call.flow != null) return;
        Long previousErrorRevision = callErrorRevisions.remove(call.id);
        KittenConnection failedCall = calls.get(errorCallId);
        // Only retire an ended call's old failure. A newer failure during
        // preparation, another active call or a non-call operation stays visible.
        if (errorCallId != null && (failedCall == null || failedCall.ended) && Objects.equals(previousErrorRevision, errorRevision)) { clearError(); changed(); }
        call.flow = new CallFlow(this, call); if (call.audioState != null) call.flow.audioRoute(call.audioState); call.flow.start(); for(JSONObject event : call.waitingEvents)call.flow.enqueue(event); call.waitingEvents.clear();
    }
    void voiceServiceStopped() { serviceReady = false; for (KittenConnection call : new ArrayList<>(calls.values())) if (call.answered) end(call, DisconnectCause.ERROR); }
    public void hangup() { execute(() -> { for (KittenConnection call : new ArrayList<>(calls.values())) end(call, DisconnectCause.LOCAL); }); }
    void end(KittenConnection call, int cause) {
        if (call.ended) return; call.ended = true;
        callErrorRevisions.remove(call.id);
        if (call.flow != null) call.flow.close();
        for (JSONObject waiting : new ArrayList<>(call.waitingEvents)) {
            String id = waiting.optString("eventId");
            if (cause == DisconnectCause.REJECTED || cause == DisconnectCause.MISSED) mailbox(id); else finishEvent(id, "call-ended");
        }
        call.waitingEvents.clear();
        if (call.incoming && !call.answered && (cause == DisconnectCause.REJECTED || cause == DisconnectCause.MISSED)) mailbox(call.eventId);
        else if (call.eventId != null) finishEvent(call.eventId, "call-ended");
        calls.remove(call.id); call.disconnect(cause, "");
        if (calls.isEmpty()) { serviceReady = false; context.stopService(new Intent(context, PhoneCallService.class)); }
        changed();
    }
    void incomingFailed(ConnectionRequest request) {
        execute(() -> { Bundle details = request.getExtras() == null ? null : request.getExtras().getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS); if (details != null) missedIncoming(details.getString("eventId")); });
    }
    private void missedIncoming(String ringId) {
        if (ringId == null) return;
        for (String id : new ArrayList<>(keys(state.optJSONObject("events")))) if (ringId.equals(event(id).optString("ringId"))) mailbox(id);
    }
    JSONObject event(String id) { return id == null ? null : state.optJSONObject("events").optJSONObject(id); }
    void requireEvent(JSONObject event, String route) { requireEvent(event, route, false); }
    void requireEvent(JSONObject event, String route, boolean allowExpired) {
        if (event == null || !enabled(route.equals("calls") ? "telephony" : "messages")) throw new SecurityException("Phone delivery was withdrawn");
        JSONObject backend = backend(event.optString("backendId"));
        if (backend == null || backend.optBoolean("revoked") || !backend.optString("generation").equals(event.optString("generation"))) throw new SecurityException("Phone registration expired");
        if (!allowExpired && event.optLong("expiresAt", Long.MAX_VALUE) < System.currentTimeMillis()) throw new SecurityException("Phone invitation expired");
    }
    /** Only the mutually authenticated owner calls this; events have stable backend/native-entry identity. */
    public CompletableFuture<JSONObject> deliver(JSONObject event) {
        return job(() -> {
            String id = event.getString("eventId"), route = event.getString("route");
            if (!List.of("calls", "messages").contains(route)) throw new IllegalArgumentException("Invalid delivery route");
            requireEvent(event, route, !event.optString("kind").equals("question"));
            if (event.optLong("createdAt") < state.optJSONObject("acceptAfter").optLong(route.equals("calls") ? "telephony" : "messages")) return json("state", "withdrawn");
            if (state.optJSONObject("tombstones").has(id) || state.optJSONObject("events").has(id)) return json("state", "duplicate");
            JSONObject stored = new JSONObject(event.toString()); stored.remove("ringId");
            put(state.optJSONObject("events"), id, stored); save();
            if (route.equals("messages")) { PhoneNotifications.post(this, event); for (KittenConnection call : calls.values()) if (call.flow != null && Objects.equals(call.backend,event.optString("backendId"))) call.flow.enqueue(event); return json("state", "notified"); }
            for (KittenConnection call : calls.values()) if (!call.ended && Objects.equals(call.backend, event.optString("backendId"))) {
                if(call.flow == null)call.waitingEvents.add(event);else call.flow.enqueue(event); return json("state", "attached");
            }
            if ((!event.optString("kind").equals("question") && event.optLong("expiresAt",Long.MAX_VALUE)<System.currentTimeMillis()) || backend(event.optString("backendId")).optBoolean("divert")) { mailbox(id); return json("state", "voicemail"); }
            for (String pendingId : keys(state.optJSONObject("events"))) {
                JSONObject pending = event(pendingId);
                String ringId = pending.optString("ringId");
                if (!ringId.isEmpty() && event(ringId) != null && Objects.equals(pending.optString("backendId"), event.optString("backendId"))) {
                    put(event(id), "ringId", ringId); save(); return json("state", "attached");
                }
            }
            put(event(id), "ringId", id); save();
            try { telecom.incoming(address(event.optString("backendId")), id); }
            catch (RuntimeException failed) { missedIncoming(id); throw failed; }
            serial.schedule(() -> { if (calls.values().stream().noneMatch(call -> id.equals(call.eventId))) missedIncoming(id); }, 45, TimeUnit.SECONDS);
            return json("state", "ringing");
        });
    }
    void finishEvent(String id, String status) {
        if (id == null) return; state.optJSONObject("events").remove(id); put(state.optJSONObject("tombstones"), id, status); save();
    }
    void mailbox(String id) {
        JSONObject value = event(id); if (value == null) return;
        try { requireEvent(value, "calls", true); } catch (SecurityException withdrawn) { finishEvent(id, "withdrawn"); return; }
        put(value, "played", false); put(state.optJSONObject("mailbox"), id, value); finishEvent(id, "voicemail"); changed();
    }
    JSONArray mailboxItems(String backendId) {
        JSONArray result = new JSONArray(); JSONObject mailbox = state.optJSONObject("mailbox");
        for (String id : keys(mailbox)) { JSONObject item = mailbox.optJSONObject(id); if (backendId.equals(item.optString("backendId"))) result.put(item); }
        return result;
    }
    void replied(String id) { JSONObject item = state.optJSONObject("mailbox").optJSONObject(id); if (item != null) { put(item,"replied",true); save(); changed(); } }
    void played(String id) { JSONObject item = state.optJSONObject("mailbox").optJSONObject(id); if (item != null) { put(item,"played",true); save(); } }
    public void clearMailbox(String backendId) { execute(() -> { JSONObject box = state.optJSONObject("mailbox"); for (String id : new ArrayList<>(keys(box))) if (backendId.equals(box.optJSONObject(id).optString("backendId"))) box.remove(id); save(); changed(); }); }
    public CompletableFuture<Void> divert(String backendId, boolean divert) { return job(() -> { JSONObject value = backend(backendId); if (value == null || value.optBoolean("revoked")) throw new IllegalArgumentException("Backend unavailable"); put(value,"divert",divert); save(); changed(); return null; }); }
    public CompletableFuture<Void> withdraw(String backendId, String sessionId) {
        return job(() -> {
            JSONObject events = state.optJSONObject("events");
            for (String id : new ArrayList<>(keys(events))) { JSONObject item = events.optJSONObject(id); if (backendId.equals(item.optString("backendId")) && (sessionId == null || sessionId.equals(item.optString("sessionId")))) { finishEvent(id,"withdrawn"); PhoneNotifications.cancel(context,id); } }
            for (KittenConnection call : new ArrayList<>(calls.values())) {
                if (!Objects.equals(call.backend, backendId)) continue;
                call.waitingEvents.removeIf(item -> sessionId == null || sessionId.equals(item.optString("sessionId")));
                if (!call.answered && call.eventId != null && event(call.eventId) == null) end(call, DisconnectCause.CANCELED);
                else if (call.flow != null) call.flow.withdraw(backendId, sessionId);
            }
            save(); return null;
        });
    }
    public CompletableFuture<Void> resolveEvent(String eventId, String status) {
        return job(() -> {
            put(state.optJSONObject("tombstones"),eventId,"resolved");save();
            JSONObject item = event(eventId);
            if (item != null) { put(item,"questionStatus",status); save(); }
            JSONObject stored = state.optJSONObject("mailbox").optJSONObject(eventId);
            if (stored != null) { put(stored,"questionStatus",status); save(); }
            PhoneNotifications.cancel(context,eventId);
            for (KittenConnection call : new ArrayList<>(calls.values())) {
                call.waitingEvents.removeIf(event -> eventId.equals(event.optString("eventId")));
                if (!call.answered && eventId.equals(call.eventId)) end(call,DisconnectCause.CANCELED);
                else if (call.flow != null) call.flow.resolved(eventId,status);
            }
            changed(); return null;
        });
    }
    public CompletableFuture<JSONObject> registeredBackends() { return job(() -> { JSONArray result = new JSONArray(); for (String id : keys(state.optJSONObject("backends"))) { JSONObject value = backend(id); if (!value.optBoolean("revoked")) result.put(json("id", id, "name", value.optString("name"), "generation", value.optString("generation"))); } return json("backends", result); }); }
    public void completedMessage(JSONObject message) { execute(() -> { for (KittenConnection call : calls.values()) if (call.flow != null) call.flow.live(message); }); }
    public CompletableFuture<Void> reply(String eventId, String text, boolean markRead) {
        CompletableFuture<Void> done = new CompletableFuture<>();
        execute(() -> { try {
            JSONObject event = event(eventId); requireEvent(event,"messages",true);
            if (markRead) { PhoneNotifications.cancel(context,eventId); done.complete(null); return; }
            if (text == null || text.isBlank()) throw new IllegalArgumentException("Reply is empty");
            if (gateway == null) throw new IllegalStateException("Original backend is unavailable; reply has not been sent");
            JSONObject request = json("eventId",eventId,"sessionId",event.optString("sessionId"),"nativeSessionId",event.optString("nativeSessionId",""),"backendId",event.optString("backendId"),"generation",event.optString("generation"),"questionId",event.optString("questionId"),"revision",event.optInt("revision"),"text",text,"source","notification","deliveryId","notification:"+eventId);
            gateway.prepare(event.optString("backendId")).thenCompose(ignored -> job(() -> { requireEvent(event(eventId),"messages",true); return gateway.request("phone.reply",request); }).thenCompose(result -> result)).whenComplete((result,failure) -> execute(() -> {
                if (failure != null) { done.completeExceptionally(failure); failed(failure); return; }
                if (!List.of("accepted","submitting").contains(result.optString("deliveryStatus"))) { IllegalStateException held=new IllegalStateException("Reply is held; open the chat to review its delivery"); done.completeExceptionally(held); failed(held); return; }
                finishEvent(eventId,"replied"); PhoneNotifications.cancel(context,eventId); done.complete(null);
            }, done::completeExceptionally));
        } catch(Exception failure) { done.completeExceptionally(failure); failed(failure); } }, done::completeExceptionally);
        return done;
    }
}
