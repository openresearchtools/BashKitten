// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Dialog;
import android.content.Context;
import android.widget.*;
import androidx.appcompat.app.AlertDialog;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import org.json.*;
import java.util.*;

/** Paths and directory listings always come from the selected Termux backend. */
final class AgentLocalAIFilePicker {
    interface Selected { void accept(String path); }
    static Dialog show(Context context, AgentRuntime runtime, String initial, String kind, Selected selected) {
        LinearLayout body = new LinearLayout(context); body.setOrientation(LinearLayout.VERTICAL);
        EditText location = new EditText(context); location.setSingleLine(true); location.setText(initial); body.addView(location);
        TextView status = new TextView(context); body.addView(status);
        ListView entries = new ListView(context); body.addView(entries, new LinearLayout.LayoutParams(-1, 0, 1));
        AlertDialog dialog = new MaterialAlertDialogBuilder(context).setTitle("Browse Termux " + (kind.equals("folder") ? "folders" : "files"))
            .setView(body).setPositiveButton(kind.equals("folder") ? "Choose folder" : "Choose path", null).setNeutralButton("Open folder", null).setNegativeButton("Cancel", null).create();
        boolean[] closed = {false}, busy = {false};
        List<JSONObject> values = new ArrayList<>();
        Runnable[] load = new Runnable[1];
        load[0] = () -> {
            if (closed[0] || busy[0] || !runtime.selected.equals("local")) return;
            busy[0] = true; status.setText("Reading backend directory…");
            runtime.command("localai-browse", AgentRouterModelsDialog.object("path", location.getText().toString(), "kind", kind), result -> {
                busy[0] = false; if (closed[0]) return;
                values.clear(); List<String> labels = new ArrayList<>();
                if (!result.isNull("parent")) { values.add(AgentRouterModelsDialog.object("path", result.optString("parent"), "directory", true)); labels.add("↑ Parent folder"); }
                JSONArray list = result.optJSONArray("entries");
                for (int i = 0; list != null && i < list.length(); i++) { JSONObject entry = list.optJSONObject(i); values.add(entry); labels.add((entry.optBoolean("directory") ? "▸ " : "") + entry.optString("name")); }
                entries.setAdapter(new ArrayAdapter<>(context, android.R.layout.simple_list_item_1, labels));
                location.setText(result.optString("path")); status.setText("Files are on the Termux backend");
            }, error -> { busy[0] = false; if (!closed[0]) status.setText(error); });
        };
        entries.setOnItemClickListener((parent, view, index, id) -> {
            if (busy[0] || index >= values.size()) return;
            JSONObject entry = values.get(index); location.setText(entry.optString("path"));
            if (entry.optBoolean("directory")) load[0].run(); else { selected.accept(entry.optString("path")); dialog.dismiss(); }
        });
        dialog.setOnDismissListener(ignored -> closed[0] = true);
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> { if (!busy[0]) { selected.accept(location.getText().toString()); dialog.dismiss(); } });
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> load[0].run()); load[0].run();
        });
        dialog.show(); dialog.getWindow().setLayout(-1, Math.round(context.getResources().getDisplayMetrics().heightPixels * .75f)); return dialog;
    }
}
