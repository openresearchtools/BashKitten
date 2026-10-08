# Android performance counters

The native Performance overlay requests a sample once per second while resumed.
Closing it or pausing the activity cancels scheduling, shuts down its worker and
closes that view's private backend sampling session. It never starts a background
monitoring service or starts the local Agent when it is off. The view formats
native RAM/GPU readings and the local controller's workload CPU reading.
When the device also permits a real whole-device CPU counter, the overlay adds
a separate **Total CPU** row. Its absence never substitutes a workload number
for the system total.

RAM uses Android's `ActivityManager.MemoryInfo`: total memory minus available
memory, displayed as used/total decimal GB. **Workload CPU** covers BashKitten's
launched backend workloads, not whole-device CPU. GPU requires a readable driver
utilization counter. A missing or forbidden counter produces **—**, not zero,
load average, clock frequency, offloaded-layer count or inferred utilization.
The first readable workload sample displays **…** until a second is available.

## Owned workload CPU

The shared controller handles `performance-sample` and `performance-close` only
on its private local socket. Each visible overlay has a new UUID and its own
baseline. Requests do not start the manager, change process ownership, expose a
remote API, or wait behind model loading/package operations. There is no sampler
timer; abandoned baselines expire only during a later explicit sample request.

The existing `runtime-guard` subreaper is the process-tree root. Its descendants
include the controller, core/auth services, detached Pi workers and their tools
and search commands, managed llama router/model subprocesses, Whisper/Parakeet,
TTS, quantization, display commands and owned service scopes. Detached process
groups remain descendants; orphaned children return to their existing subreaper.
Unrelated Termux jobs and standalone Pi are excluded. Android's separate Gecko
and other application UIDs, or externally managed inference servers, are outside
this backend workload boundary.

CPU uses the actual `utime`, `stime`, `cutime` and `cstime` fields from readable
`/proc/PID/stat` records. Summing live-process and already-reaped-child CPU time
retains completed child work without adding a live child twice. PID start time
and parent identities are rechecked after collection; a reaped/reused/reparented
record rejects the changing snapshot rather than inventing a utilization spike.
Counters reset the baseline if they regress or the online CPU set changes.
The delta is divided by `getconf CLK_TCK`, monotonic elapsed time, and the device's
online CPU count from `/sys/devices/system/cpu/online`. One fully occupied core
on an eight-core device is therefore 12.5%, and all eight are 100%. Application
affinity is not substituted for device CPU count. The native view formats two
decimal places. Linux documents the process fields in
[`proc_pid_stat(5)`](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html).

## Optional total CPU

The native sampler also attempts the aggregate `/proc/stat` delta, excluding idle
and I/O wait and avoiding double counting guest time. If that counter is not
readable, the aggregate idle seconds from `/proc/uptime` can measure non-idle
time using elapsed monotonic time and the actual online CPU count. This second
counter includes I/O wait because uptime does not separate it. Neither reader
uses load average, process affinity, or process CPU to invent a system total.
It resets its baseline when counters regress or the online CPU set changes.
Both readers run only during the visible overlay's existing sampling requests.
On devices that deny both, the optional Total CPU row is absent. The separate
Workload CPU row remains available when its owned process counters are readable.

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

Consequently those whole-device counters cannot provide a truthful system CPU
percentage in this app context. The user's later 8 October instruction selected
the owned workload CPU scope above instead; it does not reinterpret the denied
system counter as zero. GPU remains unavailable when the driver supplies no
readable supported counter.

Actual Termux `RunCommandService` verification returned a pending first sample,
then 0.166% workload CPU across six owned processes on the eight-core guest;
closing the sampling session succeeded. With Agent turned off in the native UI,
sampling returned unavailable without starting the controller. The installed
native overlay initially showed 0.25% workload CPU and 2.80/16.75 GB system RAM.
On Android candidate `3686bcb1b7`, a normal Pi chat using Qwen3.5 0.8B completed
with “Two plus two is four.” During that actual model response, the visible
overlay showed 57.75–58.86% workload CPU and 3.40–3.42/16.75 GB system RAM, then
closed normally. The process collector includes the owned router's model child;
these observations verify the workload scope during real inference, not a
privileged ADB aggregate counter. Total CPU remained omitted and GPU unavailable
on this restricted Cuttlefish guest. Physical-phone GPU and total-CPU coverage
remain unverified.
