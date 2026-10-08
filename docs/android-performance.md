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

The permission audit also exercised the actual Termux service before and after
these authorized ADB grants, without modifying the APK or kernel:

```sh
adb shell pm grant com.termux android.permission.DUMP
adb shell pm grant com.termux android.permission.PACKAGE_USAGE_STATS
adb shell cmd appops set com.termux GET_USAGE_STATS allow
```

Package-manager output confirmed both permissions and the app-op. After the
grants, `dumpsys activity -h` worked from Termux, demonstrating that the grants
were effective. However, `dumpsys cpuinfo` and `dumpsys cpu_monitor` still returned
`Can't find service`; audit logs recorded SELinux `find` denials from
`untrusted_app_27` to `cpuinfo_service` and `cpu_monitor_service`. Direct
`/proc/stat`, `/proc/uptime`, CPU pressure and cgroup reads remained forbidden.
The ActivityManager dump did not supply aggregate CPU totals. Android requires
both the permission and app-op for these diagnostic dumps; an app-op alone does
not suffice. See [DumpUtils](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-17.0.0_r1/core/java/com/android/internal/util/DumpUtils.java).

The installed Termux `top` was a wrapper around `/system/bin/top`. It displayed
`800%cpu` and `800%idle` on the eight-core guest even though `/proc/stat` was
unreadable. Android's [Toybox source](https://android.googlesource.com/platform/external/toybox/+/refs/tags/android-17.0.0_r1/toys/posix/ps.c)
only fills the aggregate statistics after a successful read, then calculates
idle ticks as potential ticks minus measured busy ticks. Its all-idle header in
this restricted context is therefore not evidence of a working system counter;
the visible process rows also cover only processes accessible to Termux.

ADB shell could read `cpuinfo`, but its observed report spanned five minutes and
ended over a minute before the command. That privileged, stale report cannot
establish a fresh one-second app reading. The guest's devfreq directory was
empty, its KGSL/Mali counters absent, and its GPU service dump failed from Termux.
These are observations of this virtual gfxstream device, not a claim that
Termux cannot read vendor GPU counters on physical phones. UsageStats describes
application foreground/service time, not system CPU or GPU utilization.

Consequently the code cannot promise CPU/GPU percentages on stock Android where
the operating system withholds all supported device counters. RAM and overlay
lifecycle remain independently testable. A native UI acceptance run is still
required for each resulting APK; a successful Java compile or readable ADB
shell counter is not evidence of application access.
