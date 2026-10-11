/* GPL-3.0. Adapted 2026-10-11 from Phony v2.6 FakeConnection.kt; see NOTICE. */
package com.bashkitten.telephony;

import android.telecom.*;
import java.util.UUID;

final class KittenConnection extends Connection {
    final String id = UUID.randomUUID().toString();
    final TelephonyRuntime owner;
    final boolean incoming;
    String backend, eventId;
    boolean answered, ended, preparing;
    long sequence;
    CallFlow flow;
    final java.util.ArrayList<org.json.JSONObject> waitingEvents = new java.util.ArrayList<>();
    CallAudioState audioState;
    KittenConnection(TelephonyRuntime owner, boolean incoming) {
        this.owner = owner; this.incoming = incoming;
        setConnectionCapabilities(CAPABILITY_MUTE); setAudioModeIsVoip(true); setInitializing();
    }
    @Override public void onAnswer() { owner.execute(() -> owner.answer(this)); }
    @Override public void onReject() { owner.execute(() -> owner.end(this, DisconnectCause.REJECTED)); }
    @Override public void onDisconnect() { owner.execute(() -> owner.end(this, DisconnectCause.LOCAL)); }
    @Override public void onAbort() { owner.execute(() -> owner.end(this, DisconnectCause.CANCELED)); }
    @Override public void onPlayDtmfTone(char digit) {
        owner.execute(() -> { if (!ended && flow != null) flow.key(digit, ++sequence); });
    }
    @Override public void onStopDtmfTone() { /* one action on key-down, never release */ }
    @Override public void onCallAudioStateChanged(CallAudioState state) {
        owner.execute(() -> { audioState = state; if (!ended && flow != null) flow.audioRoute(state); });
    }
    void disconnect(int reason, String message) {
        setDisconnected(new DisconnectCause(reason, message)); destroy();
    }
}
