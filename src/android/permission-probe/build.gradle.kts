plugins { id("com.android.application") }
android {
    namespace = "com.bashkitten.permissionprobe"
    compileSdk { version = release(37) { minorApiLevel = 0 } }
    defaultConfig { applicationId = "com.bashkitten.permissionprobe"; minSdk = 31; targetSdk = 37; versionCode = 1; versionName = "test" }
}
