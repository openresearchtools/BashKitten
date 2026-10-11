// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.widget.SwitchCompat;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.color.MaterialColors;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import java.util.Arrays;
import java.util.function.Consumer;

/** Shared native settings widgets, using the caller's scoped BashKitten theme. */
public final class PhoneSettingsUi {
    private PhoneSettingsUi() { }
    public static int dp(Context context, int value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }
    public static LinearLayout body(Context context) {
        LinearLayout body = new LinearLayout(context); body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(context, 20), 0, dp(context, 20), dp(context, 8)); return body;
    }
    public static TextView text(LinearLayout body, String value) {
        TextView text = new TextView(body.getContext()); text.setText(value); text.setTextSize(14);
        text.setTextColor(MaterialColors.getColor(text, com.google.android.material.R.attr.colorOnSurface));
        text.setPadding(0, dp(body.getContext(), 6), 0, dp(body.getContext(), 6));
        body.addView(text, new LinearLayout.LayoutParams(-1, -2)); return text;
    }
    private static ColorStateList enabledText(int color) {
        return new ColorStateList(new int[][]{new int[]{-android.R.attr.state_enabled}, new int[]{}},
            new int[]{(color & 0x00ffffff) | 0x61000000, color});
    }
    public static MaterialButton action(LinearLayout body, String label, Runnable action) {
        Context context = body.getContext();
        MaterialButton button = new MaterialButton(context);
        button.setText(label); button.setAllCaps(false); button.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        int foreground = MaterialColors.getColor(button, com.google.android.material.R.attr.colorOnSurface);
        button.setTextColor(enabledText(foreground)); button.setRippleColor(ColorStateList.valueOf((foreground & 0x00ffffff) | 0x1f000000));
        button.setBackgroundTintList(ColorStateList.valueOf(Color.TRANSPARENT)); button.setCornerRadius(dp(context, 24));
        button.setPaddingRelative(0, button.getPaddingTop(), 0, button.getPaddingBottom());
        button.setOnClickListener(v -> action.run()); body.addView(button, new LinearLayout.LayoutParams(-1, -2)); return button;
    }
    public static SwitchCompat toggle(LinearLayout body, String label, boolean checked, Consumer<Boolean> changed) {
        SwitchCompat toggle = new SwitchCompat(body.getContext()); toggle.setText(label); toggle.setTextSize(16);
        toggle.setTextColor(enabledText(MaterialColors.getColor(toggle, com.google.android.material.R.attr.colorOnSurface)));
        toggle.setMinHeight(dp(body.getContext(), 52)); toggle.setChecked(checked);
        toggle.setOnCheckedChangeListener((button, value) -> changed.accept(value));
        body.addView(toggle, new LinearLayout.LayoutParams(-1, -2)); return toggle;
    }
    public static Spinner choose(LinearLayout body, String label, String[] labels, String[] values, String value, Consumer<String> changed) {
        text(body, label); Spinner spinner = new Spinner(body.getContext());
        spinner.setAdapter(new ArrayAdapter<>(body.getContext(), android.R.layout.simple_spinner_dropdown_item, labels));
        spinner.setSelection(Math.max(0, Arrays.asList(values).indexOf(value))); spinner.setTag(value);
        body.addView(spinner, new LinearLayout.LayoutParams(-1, -2));
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                String selected = values[position]; if (selected.equals(spinner.getTag())) return;
                spinner.setTag(selected); changed.accept(selected);
            }
            public void onNothingSelected(AdapterView<?> parent) { }
        }); return spinner;
    }
    public static void divider(LinearLayout body) {
        View line = new View(body.getContext());
        line.setBackgroundColor(MaterialColors.getColor(body, com.google.android.material.R.attr.colorOnSurface)); line.setAlpha(.12f);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(body.getContext(), 1));
        params.setMargins(0, dp(body.getContext(), 8), 0, dp(body.getContext(), 8)); body.addView(line, params);
    }
    public static MaterialAlertDialogBuilder dialog(LinearLayout body, String title) {
        ScrollView scroll = new ScrollView(body.getContext()); scroll.addView(body);
        return new MaterialAlertDialogBuilder(body.getContext()).setTitle(title).setView(scroll);
    }
    public static AlertDialog show(LinearLayout body, String title) {
        return dialog(body, title).setNegativeButton("Close", null).show();
    }
}
