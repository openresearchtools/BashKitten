// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.app.ActivityManager;
import android.content.Context;
import android.os.SystemClock;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;

/** Read-only device counters. No shell, elevated permission or background timer. */
final class PerformanceMonitor {
    private final ActivityManager manager;
    private long previousTotal, previousIdle;
    private double previousUptimeIdle;
    private long previousUptimeMillis;
    private String previousOnline;
    // Pixel's Mali driver reports its DVFS sampling interval as an integer
    // percentage, unlike KGSL's busy/total ticks. These are GS101/GS201/Zuma.
    private static final String[] PIXEL_GPU_COUNTERS = {
        "/sys/devices/platform/1c500000.mali/utilization",
        "/sys/devices/platform/28000000.mali/utilization",
        "/sys/devices/platform/1f000000.mali/utilization"
    };
    PerformanceMonitor(Context context) { manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE); }
    static final class Sample {
        Double cpu, gpu;
        boolean cpuPending;
        long used, total;
    }
    Sample sample() {
        Sample result = new Sample();
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memory); result.total = memory.totalMem; result.used = memory.totalMem - memory.availMem;
        readCpu(result);
        result.gpu = readGpu();
        return result;
    }
    private void readCpu(Sample result) {
        try {
            String[] fields = read("/proc/stat").split("\\R", 2)[0].split("\\s+");
            if (fields.length < 5 || !fields[0].equals("cpu")) throw new IOException("No aggregate CPU counter");
            long total = 0;
            // guest and guest_nice are already included in user and nice.
            for (int i = 1; i < Math.min(fields.length, 9); i++) total += Long.parseLong(fields[i]);
            long idle = Long.parseLong(fields[4]) + (fields.length > 5 ? Long.parseLong(fields[5]) : 0);
            if (previousTotal > 0 && total > previousTotal && idle >= previousIdle && idle - previousIdle <= total - previousTotal)
                result.cpu = percent(100.0 * (total - previousTotal - idle + previousIdle) / (total - previousTotal));
            else result.cpuPending = true;
            previousTotal = total; previousIdle = idle;
            previousOnline = null; previousUptimeMillis = 0;
            return;
        } catch (Exception unavailable) { previousTotal = previousIdle = 0; }
        try {
            // Some kernels expose aggregate idle time even if stat is denied.
            // uptimeMillis is CLOCK_MONOTONIC (excludes deep sleep). Do not use
            // app CPU time or the cpuset-limited availableProcessors() count.
            String online = read("/sys/devices/system/cpu/online");
            int count = onlineCount(online);
            String[] fields = read("/proc/uptime").split("\\s+");
            double idle = Double.parseDouble(fields[1]);
            long now = SystemClock.uptimeMillis();
            if (!Double.isFinite(idle) || idle < 0) throw new IOException("Invalid idle counter");
            if (online.equals(previousOnline) && now > previousUptimeMillis && idle >= previousUptimeIdle) {
                double capacity = (now - previousUptimeMillis) / 1000.0 * count;
                double idleDelta = idle - previousUptimeIdle;
                // Reject resets/hotplug anomalies; allow the counter's 10 ms
                // rounding before clamping at the displayed percentage limits.
                if (idleDelta <= capacity + 0.02 * count)
                    result.cpu = percent(100.0 * (1 - idleDelta / capacity));
                else result.cpuPending = true;
            } else result.cpuPending = true;
            previousOnline = online; previousUptimeIdle = idle; previousUptimeMillis = now;
        } catch (Exception unavailable) { previousOnline = null; previousUptimeMillis = 0; }
    }
    private static int onlineCount(String online) throws IOException {
        int count = 0, last = -1;
        for (String part : online.split(",")) {
            String[] range = part.split("-", -1);
            if (range.length > 2) throw new IOException("Invalid online CPU range");
            int start = Integer.parseInt(range[0]), end = range.length == 2 ? Integer.parseInt(range[1]) : start;
            if (start <= last || end < start || end > 65535) throw new IOException("Invalid online CPU range");
            count += end - start + 1; last = end;
        }
        if (count == 0) throw new IOException("No online CPUs");
        return count;
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
