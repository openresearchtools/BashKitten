# SPDX-License-Identifier: AGPL-3.0-or-later
# Preserve reflection, JNI and the browser-owned shell entry point while removing logs.
-dontshrink
-dontobfuscate
-keep,allowoptimization class ** { *; }

-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int) return false;
    public static int v(...) return 0;
    public static int d(...) return 0;
    public static int i(...) return 0;
    public static int w(...) return 0;
    public static int e(...) return 0;
    public static int wtf(...) return 0;
    public static int println(...) return 0;
}
