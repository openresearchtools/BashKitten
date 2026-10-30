// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.PointerIcon;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.function.IntConsumer;
import java.util.function.IntSupplier;

/** Drag handle for the existing native panes; their owners retain all layout state. */
final class PaneDivider extends View {
    static final int WIDTH_DP = 12;
    private final Paint paint = new Paint();
    private final IntSupplier current;
    private final IntConsumer resize;
    private int minimum, maximum, initial;
    private float downX;

    PaneDivider(Context context, String label, IntSupplier current, IntConsumer resize) {
        super(context); this.current = current; this.resize = resize;
        setContentDescription(label); setTooltipText(label); setFocusable(true); setClickable(true);
        setPointerIcon(PointerIcon.getSystemIcon(context, PointerIcon.TYPE_HORIZONTAL_DOUBLE_ARROW));
        TypedArray theme = context.obtainStyledAttributes(new int[]{android.R.attr.textColorSecondary});
        try { paint.setColor(theme.getColor(0, 0xff808080)); } finally { theme.recycle(); }
    }

    void setBounds(int minimum, int maximum) { this.minimum = minimum; this.maximum = Math.max(minimum, maximum); }
    private int direction() { return getLayoutDirection() == LAYOUT_DIRECTION_RTL ? -1 : 1; }
    private void resizeTo(int width) { resize.accept(Math.max(minimum, Math.min(maximum, width))); }
    private int step() { return Math.round(24 * getResources().getDisplayMetrics().density); }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float half = getResources().getDisplayMetrics().density;
        paint.setAlpha(isPressed() || isFocused() ? 220 : 100);
        canvas.drawRect(getWidth() / 2f - half, 0, getWidth() / 2f + half, getHeight(), paint);
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = event.getRawX(); initial = current.getAsInt(); setPressed(true);
                getParent().requestDisallowInterceptTouchEvent(true); return true;
            case MotionEvent.ACTION_MOVE:
                resizeTo(initial + Math.round((event.getRawX() - downX) * direction())); return true;
            case MotionEvent.ACTION_UP:
                setPressed(false); getParent().requestDisallowInterceptTouchEvent(false); performClick(); return true;
            case MotionEvent.ACTION_CANCEL:
                setPressed(false); getParent().requestDisallowInterceptTouchEvent(false); return true;
            default: return super.onTouchEvent(event);
        }
    }

    @Override public boolean performClick() { super.performClick(); return true; }
    @Override public boolean onKeyDown(int key, KeyEvent event) {
        if (key == KeyEvent.KEYCODE_DPAD_LEFT || key == KeyEvent.KEYCODE_DPAD_RIGHT) {
            resizeTo(current.getAsInt() + (key == KeyEvent.KEYCODE_DPAD_RIGHT ? step() : -step()) * direction()); return true;
        }
        return super.onKeyDown(key, event);
    }
    @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
        super.onInitializeAccessibilityNodeInfo(info);
        info.setClassName(android.widget.SeekBar.class.getName());
        info.setRangeInfo(new AccessibilityNodeInfo.RangeInfo(AccessibilityNodeInfo.RangeInfo.RANGE_TYPE_INT, minimum, maximum, current.getAsInt()));
        info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_PROGRESS);
        info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD);
        info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_BACKWARD);
    }
    @Override public boolean performAccessibilityAction(int action, Bundle arguments) {
        if (action == AccessibilityNodeInfo.ACTION_SCROLL_FORWARD || action == AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD) {
            resizeTo(current.getAsInt() + (action == AccessibilityNodeInfo.ACTION_SCROLL_FORWARD ? step() : -step())); return true;
        }
        if (action == AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_PROGRESS.getId() && arguments != null
                && arguments.containsKey(AccessibilityNodeInfo.ACTION_ARGUMENT_PROGRESS_VALUE)) {
            resizeTo(Math.round(arguments.getFloat(AccessibilityNodeInfo.ACTION_ARGUMENT_PROGRESS_VALUE))); return true;
        }
        return super.performAccessibilityAction(action, arguments);
    }
}
