// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.provider.Settings;
import android.view.View;
import android.widget.LinearLayout;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.widget.SwitchCompat;
import com.bashkitten.R;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import static com.bashkitten.telephony.PhoneSettingsUi.*;

/** Native-only policy controls. No CLI command can change these settings. */
public final class PhoneControlsPanel {
    private PhoneControlsPanel() { }
    private static final class Binding {
        final Activity activity; final PhonePolicy policy; final LinearLayout root;
        AlertDialog detail;
        Binding(Activity activity, LinearLayout root) {
            this.activity = activity; this.root = root; policy = PhoneControlsRuntime.get(activity).policy;
        }
    }
    public static Context settingsContext(Activity activity) {
        return new MaterialAlertDialogBuilder(activity, R.style.BashKittenSidecarDialogTheme).getContext();
    }
    public static void show(Activity activity) {
        LinearLayout body = body(settingsContext(activity)); body.addView(build(activity));
        com.bashkitten.telephony.PhoneSettingsUi.show(body, "Phone controls");
    }
    public static View build(Activity activity) {
        Context context = settingsContext(activity);
        LinearLayout root = new LinearLayout(context); root.setOrientation(LinearLayout.VERTICAL);
        Binding binding = new Binding(activity, root); root.setTag(binding); Runnable update = () -> refresh(root);
        android.view.ViewTreeObserver.OnWindowFocusChangeListener focus = focused -> { if (focused) refresh(root); };
        root.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
            public void onViewAttachedToWindow(View view) {
                binding.policy.observe(update); root.getViewTreeObserver().addOnWindowFocusChangeListener(focus); refresh(root);
            }
            public void onViewDetachedFromWindow(View view) {
                binding.policy.unobserve(update);
                if (root.getViewTreeObserver().isAlive()) root.getViewTreeObserver().removeOnWindowFocusChangeListener(focus);
                if (binding.detail != null) binding.detail.dismiss();
            }
        });
        refresh(root); return root;
    }
    public static void refresh(View view) {
        if (!(view.getTag() instanceof Binding)) return;
        Binding binding = (Binding) view.getTag(); binding.root.removeAllViews();
        toggle(binding.root, "Phone controls", binding.policy.master(), binding.policy::setMaster);
        action(binding.root, "Allowed actions", () -> showActions(binding));
        if (binding.policy.master() && !PhoneControlsRuntime.get(binding.activity).connected())
            text(binding.root, "Turn on Local to let your agent use phone controls.");
    }
    private static void showActions(Binding binding) {
        if (binding.detail != null) { binding.detail.show(); return; }
        LinearLayout body = body(binding.root.getContext());
        Runnable update = () -> renderActions(binding, body);
        update.run(); AlertDialog dialog = com.bashkitten.telephony.PhoneSettingsUi.show(body, "Allowed actions"); binding.detail = dialog;
        android.view.ViewTreeObserver.OnWindowFocusChangeListener focus = focused -> { if (focused) update.run(); };
        body.getViewTreeObserver().addOnWindowFocusChangeListener(focus); binding.policy.observe(update);
        dialog.setOnDismissListener(ignored -> {
            binding.policy.unobserve(update);
            if (body.getViewTreeObserver().isAlive()) body.getViewTreeObserver().removeOnWindowFocusChangeListener(focus);
            binding.detail = null;
        });
    }
    private static void renderActions(Binding binding, LinearLayout body) {
        body.removeAllViews();
        if (!binding.policy.master()) text(body, "Turn on Phone controls to use these actions.");
        for (PhonePolicy.Feature feature : PhonePolicy.Feature.values()) {
            if (feature == PhonePolicy.Feature.SCREEN) {
                divider(body); text(body, "Accessibility").setTextSize(16);
                if (!binding.policy.unavailable(feature).isEmpty()) text(body, "Allow Accessibility access to use the actions below.");
                action(body, "Accessibility settings", () -> binding.activity.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
            }
            String label;
            switch (feature) {
                case APPS: label = "Apps and links"; break;
                case SCREEN: label = "Read screen"; break;
                case TOUCH: label = "Touch and gestures"; break;
                case TEXT: label = "Typing"; break;
                default: label = feature.label;
            }
            String unavailable = binding.policy.unavailable(feature);
            SwitchCompat option = toggle(body, label, binding.policy.selected(feature), enabled -> binding.policy.setSelected(feature, enabled));
            option.setEnabled(binding.policy.master() && (!feature.accessibility || unavailable.isEmpty()));
            if (feature == PhonePolicy.Feature.NOTIFICATIONS) {
                if (!unavailable.isEmpty()) text(body, "Notification access is needed.");
                action(body, "Notification access", () -> binding.activity.startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
            }
            if (feature == PhonePolicy.Feature.FILES)
                action(body, "Allowed folders", () -> binding.activity.startActivity(new Intent(binding.activity, PhoneFilesActivity.class)));
            if (feature == PhonePolicy.Feature.LOCATION && !unavailable.isEmpty())
                action(body, "Allow precise location", () -> binding.activity.requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, 8612));
        }
    }
}
