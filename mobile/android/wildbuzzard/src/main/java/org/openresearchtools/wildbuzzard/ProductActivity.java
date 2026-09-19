// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.widget.LinearLayout;
import android.widget.ScrollView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/** Uses Fenix's configured day/night theme and the device's actual system insets. */
abstract class ProductActivity extends AppCompatActivity {
    protected void showContent(LinearLayout content, boolean scrollable) {
        int padding = Math.round(20 * getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding, padding, padding);
        android.view.View root = content;
        if (scrollable) {
            ScrollView scroll = new ScrollView(this);
            scroll.setFillViewport(true);
            scroll.addView(content);
            root = scroll;
        }
        final android.view.View outer = root;
        final int base = scrollable ? 0 : padding;
        ViewCompat.setOnApplyWindowInsetsListener(outer, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            view.setPadding(base + bars.left, base + bars.top, base + bars.right, base + bars.bottom);
            return insets;
        });
        setContentView(outer);
        ViewCompat.requestApplyInsets(outer);
    }
}
