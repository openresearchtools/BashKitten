plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "com.bashkitten"
    compileSdk { version = release(37) { minorApiLevel = 0 } }
    defaultConfig {
        applicationId = "com.bashkitten"
        minSdk = 31
        targetSdk = 37
        versionCode = 9
        versionName = "0.2.5"
    }
    sourceSets.getByName("main").assets.srcDir("../../server/platform/termux/bootstrap")
    buildFeatures { compose = true }
    buildTypes { release { isMinifyEnabled = false; isDebuggable = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.webkit:webkit:1.17.0")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
}

val licenseAssets = layout.buildDirectory.dir("generated/licenses")
android.sourceSets.getByName("main").assets.srcDir(licenseAssets.get().asFile)
val generateLicenses by tasks.registering {
    val runtime = configurations.named("releaseRuntimeClasspath")
    inputs.files(runtime)
    inputs.files(rootProject.file("licenses.py"), rootProject.file("../../LICENSE"), rootProject.file("../../package.json"))
    inputs.file(rootProject.file("../../licenses/Apache-2.0.txt"))
    inputs.dir(file("src/main/assets"))
    inputs.files(rootProject.file("../../packaging/about.py"), rootProject.file("../web/about.js"), rootProject.file("../web/web_ui.html"))
    inputs.files(rootProject.file("../../package-lock.json"), rootProject.file("../server/licenses.mjs"), rootProject.file("../server/updates/platform-packages.mjs"))
    inputs.dir(rootProject.file("../../licenses/upstream"))
    outputs.dir(licenseAssets)
    outputs.file(layout.buildDirectory.file("android-dependency-sources.tar.gz"))
    doLast {
        val report = layout.buildDirectory.file("license-artifacts.json").get().asFile
        val items = runtime.get().resolvedConfiguration.resolvedArtifacts.map {
            mapOf("group" to it.moduleVersion.id.group, "name" to it.moduleVersion.id.name,
                "version" to it.moduleVersion.id.version, "file" to it.file.absolutePath)
        }.sortedBy { it["group"] + ":" + it["name"] }
        report.writeText(groovy.json.JsonOutput.toJson(items))
        val process = ProcessBuilder("python3", rootProject.file("licenses.py").absolutePath,
            report.absolutePath, licenseAssets.get().asFile.absolutePath).redirectErrorStream(true).start()
        println(process.inputStream.bufferedReader().readText())
        check(process.waitFor() == 0) { "Dependency license collection failed" }
    }
}
tasks.named("preBuild").configure { dependsOn(generateLicenses) }
