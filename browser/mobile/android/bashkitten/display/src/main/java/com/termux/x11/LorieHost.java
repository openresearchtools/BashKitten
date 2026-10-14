// SPDX-License-Identifier: GPL-3.0-only
// Host extraction from Termux:X11 fa3a8b430e28. Android window/input APIs stay in
// the child-owned window context; no Activity or browser controller crosses IPC.
package com.termux.x11;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.widget.*;
import com.termux.x11.input.InputEventSender;
import com.termux.x11.input.InputStub;
import com.termux.x11.input.TouchInputHandler;
import com.termux.x11.extrakeys.ExtraKeysView;
import com.termux.x11.utils.TermuxX11ExtraKeys;

public final class LorieHost extends ContextThemeWrapper {
    public static Handler handler;
    public static final int PAGER_POSITION_TOP = 0, PAGER_POSITION_LEFT = 1,
        PAGER_POSITION_BOTTOM = 2, PAGER_POSITION_RIGHT = 3;
    public final Prefs prefs;
    public TouchInputHandler mInputHandler;
    public TermuxX11ExtraKeys mExtraKeys;
    public boolean useTermuxEKBarBehaviour = true;
    private final LorieView view;
    private final LinearLayout root;
    private final ExtraKeysView keys;
    private final Runnable close;
    private final java.util.function.Consumer<Boolean> connectionChanged;
    private PopupWindow preferences;
    private boolean focused = true, interactive = true;

    public LorieHost(Context window, SharedPreferences values, Runnable close,
                     java.util.function.Consumer<Boolean> connectionChanged) {
        super(window, android.R.style.Theme_Material_NoActionBar);
        handler = new Handler(Looper.myLooper());
        this.close = close; this.connectionChanged = connectionChanged;
        prefs = new Prefs(values);
        // Display resolution is the tab's content rectangle. Saved desktop scaling
        // belongs to XFCE and is never changed here.
        prefs.displayResolutionMode.put("native");
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xff202225);
        view = new LorieView(this, null);
        root.addView(view, new LinearLayout.LayoutParams(-1, 0, 1));
        mInputHandler = new TouchInputHandler(this, new InputEventSender(this, view));
        view.setCallback(mInputHandler::handleInputTransformChanged);
        view.setOnTouchListener((v, e) -> !acceptsInput() || mInputHandler.handleTouchEvent(view, view, e));
        view.setOnHoverListener((v, e) -> !acceptsInput() || mInputHandler.handleTouchEvent(view, view, e));
        view.setOnGenericMotionListener((v, e) -> !acceptsInput() || mInputHandler.handleTouchEvent(view, view, e));
        view.setOnCapturedPointerListener((v, e) -> !acceptsInput() || mInputHandler.handleTouchEvent(view, view, e));
        view.setOnKeyListener((v, k, event) -> handleKey(event));
        keys = new ExtraKeysView(this, null);
        mExtraKeys = new TermuxX11ExtraKeys((v, k, e) -> handleKey(e), this, keys);
        root.addView(keys, new LinearLayout.LayoutParams(-1, dp(80)));
        keys.reload();
        keys.setVisibility(prefs.additionalKbdVisible.get() ? View.VISIBLE : View.GONE);
        reload();
    }
    public static LorieHost find(Context context) {
        while (context instanceof ContextWrapper) {
            if (context instanceof LorieHost) return (LorieHost) context;
            context = ((ContextWrapper) context).getBaseContext();
        }
        throw new IllegalStateException("Embedded X11 requires its child window context");
    }
    public static LorieHost findActivity(Context context) { return find(context); }
    public View content() { return root; }
    public LorieView getLorieView() { return view; }
    public int getPagerPosition() { return PAGER_POSITION_BOTTOM; }
    public void getRealMetrics(DisplayMetrics metrics) { metrics.setTo(getResources().getDisplayMetrics()); }
    public void setExternalKeyboardConnected(boolean connected) { /* Standard Android input/IME owns visibility. */ }
    public void setMetaKeyCapture(boolean enabled) { /* No privileged vendor system-key capture in a tab. */ }
    private boolean acceptsInput() { return focused && interactive; }
    public boolean handleKey(KeyEvent event) {
        if (!acceptsInput()) return true;
        return mInputHandler.sendKeyEvent(event);
    }
    public void setCapturingEnabled(boolean enabled) { mInputHandler.setCapturingEnabled(enabled && acceptsInput()); }
    public void toggleKeyboardVisibility() { if (acceptsInput()) view.toggleKeyboardVisible(); }
    public void toggleExtraKeys() {
        if (!acceptsInput()) return;
        boolean visible = keys.getVisibility() != View.VISIBLE;
        prefs.additionalKbdVisible.put(visible);
        keys.setVisibility(visible ? View.VISIBLE : View.GONE);
    }
    public void toggleMouseAuxButtons() { showPointerButtons(false); }
    public void toggleStylusAuxButtons() { showPointerButtons(true); }
    private void showPointerButtons(boolean stylus) {
        if (!acceptsInput()) return;
        PopupWindow popup = new PopupWindow(this);
        LinearLayout row = new LinearLayout(this);
        String[] labels = {"Left", "Middle", "Right"};
        int[] buttons = {InputStub.BUTTON_LEFT, InputStub.BUTTON_MIDDLE, InputStub.BUTTON_RIGHT};
        for (int i = 0; i < labels.length; i++) {
            final int button = buttons[i]; Button control = new Button(this); control.setText(labels[i]);
            control.setOnClickListener(v -> {
                if (stylus) mInputHandler.mStylusInputHelperMode = button;
                else { view.sendMouseEvent(-1, -1, button, true, true); view.sendMouseEvent(-1, -1, button, false, true); }
                popup.dismiss();
            }); row.addView(control);
        }
        popup.setContentView(row); popup.setWidth(-2); popup.setHeight(-2); popup.setFocusable(true);
        popup.showAtLocation(root, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL, 0, dp(80));
    }
    public void openPreferences() {
        if (!acceptsInput()) return;
        if (preferences != null && preferences.isShowing()) { preferences.dismiss(); return; }
        LinearLayout controls = new LinearLayout(this); controls.setOrientation(LinearLayout.VERTICAL);
        controls.setPadding(dp(16), dp(12), dp(16), dp(12)); controls.setBackgroundColor(0xff202225);
        CheckBox direct = new CheckBox(this); direct.setText("Direct touch"); direct.setChecked("3".equals(prefs.touchMode.get()));
        direct.setOnCheckedChangeListener((button, enabled) -> { prefs.touchMode.put(enabled ? "3" : "1"); reload(); }); controls.addView(direct);
        CheckBox clipboard = new CheckBox(this); clipboard.setText("Clipboard"); clipboard.setChecked(prefs.clipboardEnable.get());
        clipboard.setOnCheckedChangeListener((button, enabled) -> { prefs.clipboardEnable.put(enabled); reload(); }); controls.addView(clipboard);
        Button keyboard = new Button(this); keyboard.setText("Keyboard"); keyboard.setOnClickListener(v -> { preferences.dismiss(); toggleKeyboardVisibility(); }); controls.addView(keyboard);
        Button extra = new Button(this); extra.setText("Extra keys"); extra.setOnClickListener(v -> { preferences.dismiss(); toggleExtraKeys(); }); controls.addView(extra);
        preferences = new PopupWindow(controls, dp(240), -2, true);
        preferences.showAtLocation(root, Gravity.BOTTOM | Gravity.END, dp(8), dp(80));
    }
    private void reload() { mInputHandler.reloadPreferences(prefs); view.reloadPreferences(prefs); }
    public void finish() { releaseInput(); close.run(); }
    public void clientConnectedStateChanged() { connectionChanged.accept(view.connected()); }
    public void focus(boolean focused) {
        this.focused = focused;
        applyInputMode();
    }
    public void interactive(boolean enabled) {
        interactive = enabled; applyInputMode();
        keys.setVisibility(enabled && prefs.additionalKbdVisible.get() ? View.VISIBLE : View.GONE);
        if (!enabled && preferences != null) preferences.dismiss();
    }
    private void applyInputMode() {
        if (acceptsInput()) { view.setInputEnabled(true); view.requestFocus(); }
        else { releaseInput(); view.clearFocus(); }
    }
    private void releaseInput() {
        mInputHandler.setCapturingEnabled(false);
        view.setInputEnabled(false);
        mInputHandler.cancelInput();
        if (mExtraKeys != null) mExtraKeys.unsetSpecialKeys();
        keys.stopScheduledExecutors(); keys.dismissPopup();
    }
    public void destroy() {
        releaseInput(); mInputHandler.onDestroy();
        if (preferences != null) preferences.dismiss();
        handler.removeCallbacksAndMessages(null);
    }
    private int dp(int value) { return Math.round(getResources().getDisplayMetrics().density * value); }
}
