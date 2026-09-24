// SPDX-License-Identifier: GPL-3.0-only
package com.bashkitten;

import android.app.Activity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.CheckedTextView;
import android.widget.ListView;
import androidx.appcompat.app.AlertDialog;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.color.MaterialColors;
import java.util.ArrayList;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoSession.PromptDelegate.*;

/** Native HTML select handling for the protected Gecko view. */
final class AgentChoicePrompt {
    private static final class Row {
        final ChoicePrompt.Choice choice;
        final String label;
        final boolean disabled;
        Row(ChoicePrompt.Choice choice, String label, boolean disabled) {
            this.choice = choice; this.label = label; this.disabled = disabled;
        }
    }

    private static void choices(ChoicePrompt.Choice[] source, String prefix,
            boolean disabled, ArrayList<Row> rows) {
        for (ChoicePrompt.Choice choice : source) {
            if (choice.separator) continue;
            String label = prefix + choice.label;
            if (choice.items != null) choices(choice.items, label + " / ", disabled || choice.disabled, rows);
            else rows.add(new Row(choice, label, disabled || choice.disabled));
        }
    }

    static GeckoResult<PromptResponse> show(Activity activity, ChoicePrompt prompt) {
        GeckoResult<PromptResponse> result = new GeckoResult<>();
        show(activity, prompt, result);
        return result;
    }

    private static void show(Activity activity, ChoicePrompt prompt, GeckoResult<PromptResponse> result) {
        ArrayList<Row> rows = new ArrayList<>();
        choices(prompt.choices, "", false, rows);
        boolean multiple = prompt.type == ChoicePrompt.Type.MULTIPLE;
        ArrayList<String> labels = new ArrayList<>();
        for (Row row : rows) labels.add(row.label);
        MaterialAlertDialogBuilder builder = new MaterialAlertDialogBuilder(activity).setTitle(prompt.title);
        ListView list = new ListView(builder.getContext());
        list.setChoiceMode(multiple ? ListView.CHOICE_MODE_MULTIPLE : ListView.CHOICE_MODE_SINGLE);
        list.setAdapter(new ArrayAdapter<String>(builder.getContext(), multiple
                ? android.R.layout.simple_list_item_multiple_choice : android.R.layout.simple_list_item_single_choice, labels) {
            @Override public boolean areAllItemsEnabled() { return false; }
            @Override public boolean isEnabled(int position) { return !rows.get(position).disabled; }
            @Override public View getView(int position, View recycled, ViewGroup parent) {
                CheckedTextView view = (CheckedTextView) super.getView(position, recycled, parent);
                int foreground = MaterialColors.getColor(view, com.google.android.material.R.attr.colorOnSurface);
                view.setTextColor(foreground);
                view.setCheckMarkTintList(android.content.res.ColorStateList.valueOf(foreground));
                view.setEnabled(isEnabled(position));
                view.setAlpha(isEnabled(position) ? 1f : .38f);
                return view;
            }
        });
        for (int i = 0; i < rows.size(); i++) list.setItemChecked(i, rows.get(i).choice.selected);
        builder.setView(list).setNegativeButton(android.R.string.cancel, null);
        if (multiple) builder.setPositiveButton(android.R.string.ok, (dialog, which) -> {
            ArrayList<String> selected = new ArrayList<>();
            for (int i = 0; i < rows.size(); i++) if (list.isItemChecked(i)) selected.add(rows.get(i).choice.id);
            if (!prompt.isComplete()) result.complete(prompt.confirm(selected.toArray(new String[0])));
        });
        AlertDialog dialog = builder.create();
        if (!multiple) list.setOnItemClickListener((parent, view, position, id) -> {
            if (!prompt.isComplete()) result.complete(prompt.confirm(rows.get(position).choice));
            dialog.dismiss();
        });
        dialog.setOnDismissListener(ignored -> { if (!prompt.isComplete()) result.complete(prompt.dismiss()); });
        prompt.setDelegate(new PromptInstanceDelegate() {
            @Override public void onPromptDismiss(BasePrompt ignored) { dialog.dismiss(); }
            @Override public void onPromptUpdate(BasePrompt updated) {
                dialog.setOnDismissListener(null); dialog.dismiss();
                show(activity, (ChoicePrompt) updated, result);
            }
        });
        dialog.show();
    }
}
