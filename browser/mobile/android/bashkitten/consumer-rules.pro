# This class is invoked from the installed APK by Android app_process.
-keep class com.bashkitten.BrowserCommand { public static void main(java.lang.String[]); }

# libtor looks up these opaque native handles by name through JNI.
-keepclassmembers class org.torproject.jni.TorService {
    private long torConfiguration;
    private int torControlFd;
}
