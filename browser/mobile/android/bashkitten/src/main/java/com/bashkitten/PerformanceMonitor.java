// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.ActivityManager;
import android.content.Context;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;

/** Read-only device counters. No shell, elevated permission or background timer. */
final class PerformanceMonitor {
    private final ActivityManager manager;
    private long previousTotal, previousIdle;
    PerformanceMonitor(Context context) { manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE); }
    static final class Sample {
        Double cpu, gpu;
        long used, total;
    }
    Sample sample() {
        Sample result = new Sample();
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memory); result.total = memory.totalMem; result.used = memory.totalMem - memory.availMem;
        try {
            String[] fields = Files.readAllLines(Paths.get("/proc/stat")).get(0).trim().split("\\s+");
            long total = 0;
            // guest and guest_nice are already included in user and nice.
            for (int i = 1; i < Math.min(fields.length, 9); i++) total += Long.parseLong(fields[i]);
            long idle = Long.parseLong(fields[4]) + (fields.length > 5 ? Long.parseLong(fields[5]) : 0);
            if (previousTotal > 0 && total > previousTotal && idle >= previousIdle)
                result.cpu = percent(100.0 * (total - previousTotal - idle + previousIdle) / (total - previousTotal));
            previousTotal = total; previousIdle = idle;
        } catch (Exception unavailable) { previousTotal = previousIdle = 0; }
        try {
            // The KGSL driver reports busy and total ticks for this interval.
            String[] ticks = new String(Files.readAllBytes(Paths.get("/sys/class/kgsl/kgsl-3d0/gpubusy")), StandardCharsets.US_ASCII).trim().split("\\s+");
            double busy = Double.parseDouble(ticks[0]), total = Double.parseDouble(ticks[1]);
            if (total > 0) result.gpu = percent(100.0 * busy / total);
        } catch (Exception unavailable) {
            // Android intentionally restricts counters on many devices. Never
            // replace unavailable device usage with this app's usage or zero.
        }
        return result;
    }
    private static Double percent(double value) { return Double.isFinite(value) ? Math.max(0, Math.min(100, value)) : null; }
}
