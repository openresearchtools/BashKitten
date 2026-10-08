// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.Dialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatDialogFragment;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native overlay of Gecko; sampling exists only while this overlay is resumed. */
public final class AgentPerformanceDialog extends AppCompatDialogFragment {
    private final Handler main = new Handler(Looper.getMainLooper());
    private ExecutorService worker;
    private TextView values;
    private int generation;
    private final Runnable poll = this::sample;
    private PerformanceMonitor monitor;
    @Override public Dialog onCreateDialog(Bundle saved) {
        MaterialAlertDialogBuilder builder = new MaterialAlertDialogBuilder(requireContext());
        values = new TextView(builder.getContext());
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        values.setPadding(padding, padding / 2, padding, padding / 2); values.setTextSize(16);
        values.setText("Reading device counters…");
        return builder.setTitle("Performance").setView(values).setNegativeButton("Close", null).create();
    }
    @Override public void onResume() {
        super.onResume(); generation++;
        monitor = new PerformanceMonitor(requireContext().getApplicationContext());
        worker = Executors.newSingleThreadExecutor(); sample();
    }
    private void sample() {
        final int active = generation;
        final ExecutorService executor = worker;
        final PerformanceMonitor source = monitor;
        if (executor == null || executor.isShutdown()) return;
        executor.execute(() -> {
            PerformanceMonitor.Sample reading = source.sample();
            main.post(() -> {
                if (active != generation || worker != executor || !isResumed() || values == null) return;
                values.setText(String.format(Locale.getDefault(), "CPU  %s\nGPU  %s\nRAM  %.2f / %.2f GB%s",
                    reading.cpuPending ? "…" : percentage(reading.cpu), percentage(reading.gpu), reading.used / 1e9, reading.total / 1e9,
                    (reading.cpu == null && !reading.cpuPending) || reading.gpu == null ? "\n\n— Counter unavailable to this Android app" : ""));
                main.postDelayed(poll, 1000);
            });
        });
    }
    private static String percentage(Double value) { return value == null ? "—" : String.format(Locale.getDefault(), "%.2f%%", value); }
    @Override public void onPause() {
        generation++; main.removeCallbacks(poll);
        if (worker != null) worker.shutdownNow(); worker = null; monitor = null;
        super.onPause();
    }
    @Override public void onDestroyView() { values = null; super.onDestroyView(); }
}
