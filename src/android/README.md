# Android app

BashKitten for Android 12 and newer uses the system WebView. **Apps** manages
Termux and updates; **About → Licenses** shows the libraries bundled in this APK.
The separate Termux server's notices are available through **Server licenses**.

Build with the included Gradle wrapper, JDK 17 and SDK 37. The build collects
full notices and source jars for the exact release dependencies before packaging.
GitHub Actions signs the tested APK with the shared suite key.
