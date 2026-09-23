// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import android.app.Activity;
import android.os.Build;
import android.view.*;
import android.widget.*;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.journeyapps.barcodescanner.CaptureActivity;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;

/** A visible cancellation control stays above the camera preview on every navigation mode. */
public final class OnionCaptureActivity extends CaptureActivity {
    @Override protected DecoratedBarcodeView initializeContent() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xff1e1e1e);
        DecoratedBarcodeView scanner = new DecoratedBarcodeView(this);
        root.addView(scanner, new FrameLayout.LayoutParams(-1, -1));
        Button close = new Button(this);
        close.setText("Close scanner"); close.setAllCaps(false);
        close.setTextColor(0xffe5e5e5);
        close.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff303030));
        close.setOnClickListener(view -> cancel());
        FrameLayout.LayoutParams position = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END);
        int gap = Math.round(16 * getResources().getDisplayMetrics().density);
        position.setMargins(gap, gap, gap, gap); root.addView(close, position);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
        });
        setContentView(root); ViewCompat.requestApplyInsets(root);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::cancel);
        return scanner;
    }
    private void cancel() { setResult(Activity.RESULT_CANCELED); finish(); }
    @Override public void onBackPressed() { cancel(); }
}
