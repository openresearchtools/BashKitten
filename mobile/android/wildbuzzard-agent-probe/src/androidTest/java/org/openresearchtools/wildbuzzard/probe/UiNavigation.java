// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard.probe;

import androidx.test.uiautomator.*;
import static org.junit.Assert.*;

final class UiNavigation {
    static void click(UiDevice device, String text) {
        java.util.regex.Pattern label = java.util.regex.Pattern.compile(java.util.regex.Pattern.quote(text), java.util.regex.Pattern.CASE_INSENSITIVE);
        long deadline = android.os.SystemClock.elapsedRealtime() + 15000;
        do {
            UiObject2 item = device.findObject(By.desc(label));
            if (item == null) item = device.findObject(By.text(label));
            if (item != null) { item.click(); return; }
            android.os.SystemClock.sleep(100);
        } while (android.os.SystemClock.elapsedRealtime() < deadline);
        fail("UI text or accessibility label not found: " + text);
    }
    static void scrollToAndClick(UiDevice device, String label) {
        for (int attempt = 0; attempt < 10; attempt++) {
            UiObject2 item = device.findObject(By.desc(label));
            if (item == null) item = device.findObject(By.text(label));
            if (item != null) { item.click(); return; }
            UiObject2 scroll = device.wait(Until.findObject(By.scrollable(true)), 10000);
            assertNotNull("Scrollable content before " + label, scroll);
            // Scrolling to the beginning first dismisses Fenix's bottom-sheet menu.
            scroll.scroll(Direction.DOWN, 0.7f);
        }
        fail("Menu or preference not found: " + label);
    }
}
