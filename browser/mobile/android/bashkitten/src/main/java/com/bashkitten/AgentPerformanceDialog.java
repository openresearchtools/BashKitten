// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Dialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatDialogFragment;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import org.json.JSONObject;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native overlay of Gecko; sampling exists only while this overlay is resumed. */
public final class AgentPerformanceDialog extends AppCompatDialogFragment {
    private final Handler main = new Handler(Looper.getMainLooper());
    private ExecutorService worker;
    private TextView values;
    private int generation;
    private String session;
    private boolean requested;
    private AgentRuntime runtime;
    private final Runnable poll = this::sample;
    private PerformanceMonitor monitor;
    @Override public Dialog onCreateDialog(Bundle saved) {
        MaterialAlertDialogBuilder builder = new MaterialAlertDialogBuilder(requireContext());
        values = new TextView(builder.getContext());
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        values.setPadding(padding, padding / 2, padding, padding / 2); values.setTextSize(16);
        values.setText("Reading workload counters…");
        return builder.setTitle("Performance").setView(values).setNegativeButton("Close", null).create();
    }
    @Override public void onResume() {
        super.onResume(); generation++;
        session = UUID.randomUUID().toString(); requested = false;
        runtime = BrowserApp.get(requireContext()).agent;
        monitor = new PerformanceMonitor(requireContext().getApplicationContext());
        worker = Executors.newSingleThreadExecutor(); sample();
    }
    private boolean active(int expected, ExecutorService executor) {
        return expected == generation && worker == executor && isResumed() && values != null;
    }
    private static JSONObject input(String session) {
        JSONObject value = new JSONObject();
        try { value.put("session", session); } catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
        return value;
    }
    private void closeSession(String id) {
        if (runtime != null && id != null) runtime.command("performance-close", input(id), ignored -> {}, ignored -> {});
    }
    private void sample() {
        final int expected = generation;
        final ExecutorService executor = worker;
        final PerformanceMonitor source = monitor;
        final String id = session;
        final long started = SystemClock.uptimeMillis();
        if (executor == null || executor.isShutdown()) return;
        executor.execute(() -> {
            PerformanceMonitor.Sample reading = source.sample();
            main.post(() -> {
                if (!active(expected, executor)) return;
                requested = true;
                runtime.command("performance-sample", input(id), result -> {
                    if (!active(expected, executor)) { closeSession(id); return; }
                    Double cpu = result.isNull("cpuPercent") ? null : result.optDouble("cpuPercent", Double.NaN);
                    if (cpu != null && (!Double.isFinite(cpu) || cpu < 0 || cpu > 100)) cpu = null;
                    show(reading, cpu, result.optBoolean("pending"), result.isNull("reason") ? "" : result.optString("reason"));
                    main.postDelayed(poll, Math.max(0, 1000 - (SystemClock.uptimeMillis() - started)));
                }, error -> {
                    if (!active(expected, executor)) { closeSession(id); return; }
                    show(reading, null, false, error);
                    main.postDelayed(poll, Math.max(0, 1000 - (SystemClock.uptimeMillis() - started)));
                });
            });
        });
    }
    private void show(PerformanceMonitor.Sample reading, Double cpu, boolean pending, String reason) {
        String note = cpu == null && !pending ? "\n\nCPU: " + (reason.isEmpty() ? "Workload counter unavailable" : reason) : "";
        if (reading.gpu == null) note += "\n\nGPU counter unavailable to this Android app";
        values.setText(String.format(Locale.getDefault(), "Workload CPU  %s\nGPU  %s\nSystem RAM  %.2f / %.2f GB%s",
            pending ? "…" : percentage(cpu), percentage(reading.gpu), reading.used / 1e9, reading.total / 1e9, note));
    }
    private static String percentage(Double value) { return value == null ? "—" : String.format(Locale.getDefault(), "%.2f%%", value); }
    @Override public void onPause() {
        generation++; main.removeCallbacks(poll);
        if (worker != null) worker.shutdownNow(); worker = null; monitor = null;
        if (requested) closeSession(session); session = null; requested = false;
        super.onPause();
    }
    @Override public void onDestroyView() { values = null; super.onDestroyView(); }
}
