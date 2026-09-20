plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "com.bashkitten"
    compileSdk { version = release(37) { minorApiLevel = 0 } }
    defaultConfig {
        applicationId = "com.bashkitten"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        minSdk = 31
        targetSdk = 37
        versionCode = 1
        versionName = "0.2.0"
    }
    sourceSets.getByName("main").assets.srcDir("../../server/platform/termux/bootstrap")
    testBuildType = "release"
    buildFeatures { compose = true }
    buildTypes { release { isMinifyEnabled = false; isDebuggable = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.4.0")
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.webkit:webkit:1.17.0")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
}
