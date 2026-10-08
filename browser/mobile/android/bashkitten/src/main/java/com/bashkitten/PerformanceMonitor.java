// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.ActivityManager;
import android.content.Context;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;

/** Read-only device counters. No shell, elevated permission or background timer. */
final class PerformanceMonitor {
    private final ActivityManager manager;
    // Pixel's Mali driver reports its DVFS sampling interval as an integer
    // percentage, unlike KGSL's busy/total ticks. These are GS101/GS201/Zuma.
    private static final String[] PIXEL_GPU_COUNTERS = {
        "/sys/devices/platform/1c500000.mali/utilization",
        "/sys/devices/platform/28000000.mali/utilization",
        "/sys/devices/platform/1f000000.mali/utilization"
    };
    PerformanceMonitor(Context context) { manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE); }
    static final class Sample {
        Double gpu;
        long used, total;
    }
    Sample sample() {
        Sample result = new Sample();
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memory); result.total = memory.totalMem; result.used = memory.totalMem - memory.availMem;
        result.gpu = readGpu();
        return result;
    }
    private static Double readGpu() {
        try {
            // The KGSL driver reports busy and total ticks for this interval.
            String[] ticks = read("/sys/class/kgsl/kgsl-3d0/gpubusy").split("\\s+");
            double busy = Double.parseDouble(ticks[0]), total = Double.parseDouble(ticks[1]);
            if (Double.isFinite(busy) && Double.isFinite(total) && total > 0 && busy >= 0 && busy <= total)
                return percent(100.0 * busy / total);
        } catch (Exception unavailable) { /* Try a different known driver. */ }
        for (String counter : PIXEL_GPU_COUNTERS) {
            try {
                double value = Double.parseDouble(read(counter));
                if (Double.isFinite(value) && value >= 0 && value <= 100) return value;
            } catch (Exception unavailable) { /* Not this device, or restricted. */ }
        }
        // No guessed scales, app-only counters, or synthetic zero when Android
        // restricts access. In particular, frequency is not GPU utilization.
        return null;
    }
    private static String read(String file) throws IOException { return new String(Files.readAllBytes(Paths.get(file)), StandardCharsets.US_ASCII).trim(); }
    private static Double percent(double value) { return Double.isFinite(value) ? Math.max(0, Math.min(100, value)) : null; }
}
