package com.bashkitten.permissionprobe;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.widget.TextView;

/** Candidate-only APK signed with an unrelated debug key, never distributed in the suite. */
public class MainActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String result;
        try {
            startForegroundService(new Intent("com.termux.RUN_COMMAND")
                    .setComponent(new ComponentName("com.termux", "com.termux.app.SuiteRunCommandService")));
            result = "FAILED: unrelated signer reached the trusted service";
        } catch (SecurityException expected) {
            result = checkSelfPermission("com.termux.permission.RUN_TRUSTED_COMMAND") == PackageManager.PERMISSION_DENIED
                    ? "PASS: unrelated signer denied" : "FAILED: signature permission granted";
        }
        android.util.Log.i("BashKittenPermissionTest", result);
        TextView view = new TextView(this); view.setText(result); view.setTextSize(20); setContentView(view);
    }
}
