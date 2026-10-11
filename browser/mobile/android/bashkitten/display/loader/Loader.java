// SPDX-License-Identifier: GPL-3.0-only
// Adapted from Termux:X11 fa3a8b430e28 shell-loader. Marked changes:
// exact paired module ABI, SHA-256 signer pin, current Android user, and the
// verified package's extracted native-library directory, with no overrides.
package com.bashkitten.display.loader;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import java.security.MessageDigest;
import dalvik.system.PathClassLoader;

public final class Loader {
    public static void main(String[] args) {
        try {
            Object manager = Class.forName("android.app.ActivityThread").getMethod("getPackageManager").invoke(null);
            Class<?> api = Class.forName("android.content.pm.IPackageManager");
            int user = android.os.Process.myUid() / 100000;
            PackageInfo info = (PackageInfo) (Build.VERSION.SDK_INT >= 33
                ? api.getMethod("getPackageInfo", String.class, long.class, int.class)
                    .invoke(manager, Pair.PACKAGE, (long) PackageManager.GET_SIGNING_CERTIFICATES, user)
                : api.getMethod("getPackageInfo", String.class, int.class, int.class)
                    .invoke(manager, Pair.PACKAGE, PackageManager.GET_SIGNING_CERTIFICATES, user));
            if (info == null || info.applicationInfo == null || !info.applicationInfo.enabled)
                throw new IllegalStateException("Install and enable BashKitten first");
            if (info.signingInfo == null || info.signingInfo.getApkContentsSigners().length != 1)
                throw new SecurityException("BashKitten Display signer is unavailable");
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(info.signingInfo.getApkContentsSigners()[0].toByteArray());
            StringBuilder hex = new StringBuilder();
            for (byte value : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
            if (!Pair.SIGNER.equals(hex.toString())) throw new SecurityException("BashKitten and its Termux Display package have different signing identities");
            ClassLoader loader = new PathClassLoader(info.applicationInfo.sourceDir,
                info.applicationInfo.nativeLibraryDir, ClassLoader.getSystemClassLoader());
            String version = (String) loader.loadClass("com.bashkitten.display.DisplayProtocol").getField("VERSION").get(null);
            if (!Pair.VERSION.equals(version)) throw new IllegalStateException("Update BashKitten and its Termux packages together: Display versions differ");
            loader.loadClass("com.termux.x11.CmdEntryPoint").getMethod("main", String[].class).invoke(null, (Object) args);
        } catch (Throwable error) {
            Throwable cause = error instanceof java.lang.reflect.InvocationTargetException ? error.getCause() : error;
            System.err.println("BashKitten Display: " + cause.getMessage());
            System.exit(1);
        }
    }
}
