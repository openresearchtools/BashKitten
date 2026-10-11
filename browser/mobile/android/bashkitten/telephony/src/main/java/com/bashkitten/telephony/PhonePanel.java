// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import android.net.Uri;
import android.provider.Settings;
import android.telecom.TelecomManager;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.widget.SwitchCompat;
import org.json.*;
import java.util.*;
import java.util.function.Consumer;
import static com.bashkitten.telephony.PhoneSettingsUi.*;

/** Setup-only native UI. State, storage, Telecom and speech remain with the async owner. */
public final class PhonePanel {
    private PhonePanel() { }
    public static void showCalls(Activity activity, Context themedContext) { new Panel(activity, themedContext).show(true); }
    public static void showMessages(Activity activity, Context themedContext) { new Panel(activity, themedContext).show(false); }

    private static final class Panel {
        final Activity activity;
        final Context context;
        final TelephonyRuntime owner;
        final Set<AlertDialog> children = new HashSet<>();
        JSONObject state = new JSONObject();
        boolean syncing, closed;
        SwitchCompat master;
        TextView status;
        Panel(Activity activity, Context themedContext) {
            this.activity = activity; context = themedContext; owner = TelephonyRuntime.get(activity);
        }
        boolean alive() { return !closed && !activity.isFinishing() && !activity.isDestroyed(); }
        JSONObject settings() { JSONObject result = state.optJSONObject("settings"); return result == null ? new JSONObject() : result; }
        void show(boolean calling) {
            LinearLayout body = body(context);
            String setting = calling ? "telephony" : "messages";
            master = toggle(body, calling ? "Calls" : "Messages", false, enabled -> {
                if (syncing) return;
                if (enabled && calling && activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                    activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 7328);
                if (enabled && !calling && Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7329);
                owner.configure(TelephonyRuntime.json(setting, enabled));
            });
            master.setEnabled(false);
            boolean supported = !calling || Build.VERSION.SDK_INT >= 35 && activity.getSystemService(TelecomManager.class) != null
                && activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELECOM);
            if (calling) {
                if (!supported) text(body, "Calls aren't supported on this device.");
                action(body, "Call setup", this::callSetup).setEnabled(supported);
                action(body, "Call settings", () -> deliverySettings(true));
                action(body, "Contacts and voicemail", this::contacts);
            } else action(body, "Message settings", () -> deliverySettings(false));
            status = text(body, "Loading…");
            Consumer<JSONObject> observer = value -> {
                if (!alive()) return;
                state = value; JSONObject saved = value.optJSONObject("settings");
                if (saved == null) { status.setText(value.optString("error", "Loading…")); return; }
                syncing = true;
                try { master.setChecked(saved.optBoolean(setting)); }
                finally { syncing = false; }
                master.setEnabled(supported || saved.optBoolean(setting));
                String error = value.optString("error");
                String message = !error.isBlank() ? error : saved.optBoolean(setting) && !value.optBoolean("connected") ? "Turn on Local to connect your chats." : "";
                status.setText(message); status.setVisibility(message.isBlank() ? View.GONE : View.VISIBLE);
            };
            AlertDialog dialog = PhoneSettingsUi.show(body, calling ? "Telephone" : "Notifications");
            dialog.setOnDismissListener(ignored -> {
                closed = true; owner.unobserve(observer);
                for (AlertDialog child : new ArrayList<>(children)) child.dismiss();
            });
            owner.observe(observer);
        }
        AlertDialog child(LinearLayout body, String title) { return track(PhoneSettingsUi.show(body, title)); }
        AlertDialog track(AlertDialog dialog) {
            children.add(dialog); dialog.setOnDismissListener(ignored -> children.remove(dialog));
            if (dialog.getWindow() != null) dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            return dialog;
        }
        void callSetup() {
            LinearLayout body = body(context);
            TextView ready = text(body, settings().optBoolean("telephony") ? "Checking setup…" : "Turn on Calls to set up calling.");
            android.widget.Button account = action(body, "Set up calling account", () -> owner.setupAccount().whenComplete((value, error) -> activity.runOnUiThread(() -> {
                if (!alive() || !ready.isAttachedToWindow()) return;
                if (error != null) { ready.setText(error.getMessage()); return; }
                try { activity.startActivity(new Intent(TelecomManager.ACTION_CHANGE_PHONE_ACCOUNTS)); }
                catch (RuntimeException missing) { ready.setText("Calling account settings aren't available on this device."); }
            })));
            account.setEnabled(settings().optBoolean("telephony"));
            action(body, "Check setup", () -> checkReady(ready));
            action(body, "Call agent", () -> {
                if (activity.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
                    activity.requestPermissions(new String[]{Manifest.permission.CALL_PHONE}, 7330); return;
                }
                owner.call(null);
            }).setEnabled(settings().optBoolean("telephony") && state.optBoolean("connected"));
            if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                action(body, "Allow microphone", () -> activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 7328));
            action(body, "Voice settings", owner::openLocalAI);
            AlertDialog dialog = child(body, "Call setup");
            Consumer<JSONObject> observer = value -> {
                if (alive() && dialog.isShowing() && !value.optString("error").isBlank()) ready.setText(value.optString("error"));
            };
            android.view.ViewTreeObserver.OnWindowFocusChangeListener focus = focused -> { if (focused) checkReady(ready); };
            ready.getViewTreeObserver().addOnWindowFocusChangeListener(focus); owner.observe(observer);
            dialog.setOnDismissListener(ignored -> {
                children.remove(dialog); owner.unobserve(observer);
                if (ready.getViewTreeObserver().isAlive()) ready.getViewTreeObserver().removeOnWindowFocusChangeListener(focus);
            });
            if (settings().optBoolean("telephony")) checkReady(ready);
        }
        void checkReady(TextView target) {
            owner.readiness().whenComplete((ready, error) -> activity.runOnUiThread(() -> {
                if (!alive() || !target.isAttachedToWindow()) return;
                if (error != null) { target.setText(error.getMessage()); return; }
                List<String> missing = new ArrayList<>();
                if (!settings().optBoolean("telephony")) missing.add("Turn on Calls.");
                if (!ready.optString("reason").isBlank()) missing.add(ready.optString("reason"));
                else if (!ready.optBoolean("accountEnabled")) missing.add("Enable BashKitten in calling account settings.");
                if (!ready.optBoolean("microphone")) missing.add("Allow microphone access to speak during calls.");
                if (!ready.optBoolean("gateway")) missing.add("Turn on Local to connect your chats.");
                target.setText(missing.isEmpty() ? "Calling is set up. Speech models are checked when you call." : String.join("\n", missing));
            }));
        }
        void deliverySettings(boolean calling) {
            LinearLayout body = body(context); JSONObject saved = settings(), draft = new JSONObject();
            choose(body, "Updates for new chats", new String[]{"Off", "Only when I call", "Messages", "Calls"}, new String[]{"off", "call-in", "messages", "calls"}, saved.optString("ordinaryDefault", "off"), value -> TelephonyRuntime.put(draft, "ordinaryDefault", value));
            EditText pause;
            if (calling) {
                choose(body, "Updates for chats started by phone", new String[]{"Only when I call", "Messages", "Calls"}, new String[]{"call-in", "messages", "calls"}, saved.optString("callDefault", "calls"), value -> TelephonyRuntime.put(draft, "callDefault", value));
                choose(body, "Recent chats to read out", new String[]{"1", "2", "3", "4", "5", "6", "7", "8", "9"}, new String[]{"1", "2", "3", "4", "5", "6", "7", "8", "9"}, String.valueOf(saved.optInt("recent", 5)), value -> TelephonyRuntime.put(draft, "recent", Integer.parseInt(value)));
                divider(body);
                TextView label = text(body, "Stop recording after");
                pause = new EditText(context); pause.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
                pause.setText(String.valueOf(saved.optDouble("silenceSeconds", 4))); pause.setSingleLine(true);
                pause.setId(View.generateViewId()); label.setLabelFor(pause.getId()); body.addView(pause, new LinearLayout.LayoutParams(-1, -2));
                text(body, "Seconds without speech");
                choose(body, "Finish speaking", new String[]{"Press #", "Pause", "Pause or press #"}, new String[]{"hash", "silence", "either"}, saved.optString("finish", "either"), value -> {
                    TelephonyRuntime.put(draft, "finish", value); pause.setEnabled(!value.equals("hash"));
                });
                pause.setEnabled(!saved.optString("finish", "either").equals("hash"));
            } else {
                pause = null;
                action(body, "Android Auto", this::androidAuto);
            }
            TextView error = text(body, ""); error.setVisibility(View.GONE);
            AlertDialog dialog = track(PhoneSettingsUi.dialog(body, calling ? "Call settings" : "Message settings").setNegativeButton("Cancel", null).setPositiveButton("Save", null).show());
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                if (pause != null) {
                    try {
                        double seconds = Double.parseDouble(pause.getText().toString());
                        if (!Double.isFinite(seconds) || seconds <= 0) throw new NumberFormatException();
                        if (seconds != saved.optDouble("silenceSeconds", 4)) TelephonyRuntime.put(draft, "silenceSeconds", seconds);
                    } catch (NumberFormatException invalid) { pause.setError("Enter a number greater than zero"); return; }
                }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                owner.configure(draft).whenComplete((value, failure) -> activity.runOnUiThread(() -> {
                    if (!alive() || !dialog.isShowing()) return;
                    if (failure == null) dialog.dismiss();
                    else { error.setText(failure.getMessage()); error.setVisibility(View.VISIBLE); dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true); }
                }));
            });
        }
        void androidAuto() {
            java.util.concurrent.CompletableFuture.runAsync(() -> {
                String packageName = "com.google.android.projection.gearhead";
                Intent launch = activity.getPackageManager().getLaunchIntentForPackage(packageName);
                boolean installed;
                try { activity.getPackageManager().getPackageInfo(packageName, 0); installed = true; }
                catch (PackageManager.NameNotFoundException missing) { installed = false; }
                Intent settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + packageName));
                boolean hasSettings = installed && settings.resolveActivity(activity.getPackageManager()) != null;
                boolean available = installed;
                activity.runOnUiThread(() -> {
                    if (!alive()) return;
                    if (launch != null) {
                        try { activity.startActivity(launch); return; }
                        catch (ActivityNotFoundException | SecurityException unavailable) { /* Use the supported settings route below. */ }
                    }
                    LinearLayout help = body(context);
                    text(help, available ? "Android Auto doesn't offer a direct settings shortcut on this device." : "Android Auto isn't installed on this device.");
                    text(help, "Listen and reply in Android Auto's notifications. In Android Auto developer settings, allow unknown sources for this sideloaded app.");
                    if (hasSettings) action(help, "Open app settings", () -> {
                        try { activity.startActivity(settings); }
                        catch (ActivityNotFoundException | SecurityException unavailable) { text(help, "App settings aren't available."); }
                    });
                    child(help, "Android Auto");
                });
            }).exceptionally(error -> {
                activity.runOnUiThread(() -> {
                    if (!alive()) return;
                    LinearLayout help = body(context); text(help, "Android Auto settings aren't available."); child(help, "Android Auto");
                }); return null;
            });
        }
        void contacts() {
            LinearLayout body = body(context); TextView result = text(body, ""); result.setVisibility(View.GONE);
            action(body, "Add Kitten contact", () -> contact(null, result));
            LinearLayout list = new LinearLayout(context); list.setOrientation(LinearLayout.VERTICAL); body.addView(list);
            AlertDialog dialog = child(body, "Contacts and voicemail");
            Consumer<JSONObject> observer = value -> {
                if (!alive() || !dialog.isShowing()) return;
                list.removeAllViews(); JSONObject backends = value.optJSONObject("backends"), mailbox = value.optJSONObject("mailbox");
                if (backends == null) return;
                for (String id : TelephonyRuntime.keys(backends)) {
                    JSONObject backend = backends.optJSONObject(id); if (backend == null || backend.optBoolean("revoked")) continue;
                    divider(list); text(list, backend.optString("name", "BashKitten")).setTextSize(16);
                    action(list, "Add contact", () -> contact(id, result));
                    toggle(list, "Send calls to voicemail", backend.optBoolean("divert"), enabled -> owner.divert(id, enabled));
                    action(list, "View voicemail", () -> mailbox(backend.optString("name", "BashKitten"), id, mailbox));
                    action(list, "Clear voicemail", () -> {
                        AlertDialog confirm = new com.google.android.material.dialog.MaterialAlertDialogBuilder(context)
                            .setTitle("Clear voicemail?").setMessage("Clear voicemail for " + backend.optString("name", "BashKitten") + "? Your chats will stay available.")
                            .setNegativeButton("Cancel", null).setPositiveButton("Clear", (d, which) -> owner.clearMailbox(id)).show(); track(confirm);
                    });
                }
            };
            dialog.setOnDismissListener(ignored -> { children.remove(dialog); owner.unobserve(observer); }); owner.observe(observer);
        }
        void contact(String id, TextView result) {
            owner.contact(id).whenComplete((intent, error) -> activity.runOnUiThread(() -> {
                if (!alive() || !result.isAttachedToWindow()) return;
                if (error != null) { result.setText(error.getMessage()); result.setVisibility(View.VISIBLE); return; }
                try { activity.startActivity(intent); }
                catch (ActivityNotFoundException missing) { result.setText("No contact editor is available."); result.setVisibility(View.VISIBLE); }
            }));
        }
        void mailbox(String name, String id, JSONObject mailbox) {
            LinearLayout body = body(context); StringBuilder content = new StringBuilder();
            if (mailbox != null) for (String key : TelephonyRuntime.keys(mailbox)) {
                JSONObject item = mailbox.optJSONObject(key);
                if (item == null || !id.equals(item.optString("backendId"))) continue;
                content.append(item.optString("title", "Chat")).append(item.optBoolean("replied") ? " · Replied" : "");
                if (item.has("questionStatus")) content.append(" · ").append(item.optString("questionStatus"));
                content.append('\n').append(item.optString("text")).append("\n\n");
            }
            text(body, content.length() == 0 ? "No voicemail" : content.toString()).setTextIsSelectable(true);
            child(body, "Voicemail · " + name);
        }
    }
}
