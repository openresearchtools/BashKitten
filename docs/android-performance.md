# Android performance counters

The native Performance overlay samples once per second while resumed. Closing
it or pausing the activity cancels scheduling and shuts down its worker. It
does not depend on an Agent session and never starts a background monitoring
service. The view only formats the values returned by `PerformanceMonitor`.

RAM uses Android's `ActivityManager.MemoryInfo`: total memory minus available
memory, displayed as used/total decimal GB. CPU and GPU require readable
whole-device counters. A missing or forbidden counter produces **—**, not zero,
process CPU usage, load average, clock frequency, or an inferred utilization.
The first readable CPU sample displays **…** until a second sample is available.

CPU prefers the aggregate `/proc/stat` delta, excluding idle and I/O wait from
busy time and avoiding double counting guest time. If that is unavailable, it
tries the aggregate idle seconds in `/proc/uptime`, divided by elapsed monotonic
time and the online CPU count from `/sys/devices/system/cpu/online`. This fallback
measures non-idle time, including I/O wait because uptime does not separate it.
It resets its baseline when the observed online CPU set changes or counters
reset. It does not use the application's CPU affinity as the system CPU count.
Linux documents the counters in its [CPU load guide](https://kernel.org/doc/html/latest/admin-guide/cpu-load.html).

GPU readers use driver-specific units:

- Qualcomm KGSL `gpubusy`: busy ticks divided by total ticks from the driver's
  sampling interval. See the [KGSL implementation](https://android.googlesource.com/kernel/msm.git/+/17d718ca1528f48b1853585fef11359aa899dae1/drivers/gpu/msm/kgsl_pwrctrl.c).
- Pixel Mali GS101, GS201 and Zuma `utilization`: the driver's latest DVFS
  utilization percentage. The known platform device paths are `1c500000.mali`,
  `28000000.mali` and `1f000000.mali`. See the [Pixel counter implementation](https://android.googlesource.com/kernel/google-modules/gpu/+/refs/heads/android-gs-shusky-6.1-android16/mali_kbase/platform/pixel/pixel_gpu_sysfs.c),
  [GS201 device path](https://android.googlesource.com/device/google/gs201/+/6b82c37c4cd36aeb3b2afea3fa0f96254a59a23b)
  and [Zuma device tree](https://android.googlesource.com/kernel/devices/google/zuma/+/eb90f2862e78b4c409ff992e116c44e81f836e9e/dts/zuma-gpu.dtsi).

Supporting a counter format does not grant access to it. Android's
[application SELinux policy](https://android.googlesource.com/platform/system/sepolicy/+/android16-release/private/app_neverallows.te)
forbids untrusted application reads of `/proc/stat`, `/proc/uptime` and cgroup
files. Vendor policy also controls access to GPU counters. The overlay does not
change SELinux, use root, or depend on an ADB session.

## Cuttlefish coverage, 8 October 2026

On the stock-kernel Android 17 Cuttlefish guest used for development,
both `run-as com.termux` and a command launched by Termux's actual
`RunCommandService` could read the online CPU list (`0-7`), but `/proc/stat`,
`/proc/uptime`, `/proc/loadavg`, `/proc/schedstat` and cgroup CPU counters were
permission denied. KGSL and the known Pixel Mali paths were absent. The guest
uses the virtual gfxstream GPU, not either of those physical drivers. The
service-launched command ran in `untrusted_app_27`, the real Termux application
domain, rather than `runas_app`. These observations establish the limitation of
that app context; they do not establish physical Pixel or Qualcomm runtime
coverage. The installed release BashKitten APK does not permit `run-as`.

Consequently the code cannot promise CPU/GPU percentages on stock Android where
the operating system withholds all supported device counters. RAM and overlay
lifecycle remain independently testable. A native UI acceptance run is still
required for each resulting APK; a successful Java compile or readable ADB
shell counter is not evidence of application access.
