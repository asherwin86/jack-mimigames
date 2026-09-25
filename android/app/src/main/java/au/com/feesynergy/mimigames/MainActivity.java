package au.com.feesynergy.mimigames;

import android.os.Bundle;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * The whole arcade is a bundled web app (see capacitor.config.json), so it runs with no internet.
 *
 * This activity does two jobs:
 *  - hides the system bars so the games get the full landscape screen, and
 *  - reads game controllers itself. Android's WebView doesn't reliably offer the browser Gamepad API (a Shield TV
 *    controller did nothing), so the sticks and buttons are handed to the page by calling window.__mimiPad(...),
 *    which src/engine/NativePad.js turns into a normal standard-mapping gamepad.
 */
public class MainActivity extends BridgeActivity {
    // Standard-gamepad button indexes (the same order the browser uses).
    private static final int BTN_LT = 6, BTN_RT = 7, BTN_UP = 12, BTN_DOWN = 13, BTN_LEFT = 14, BTN_RIGHT = 15;

    private float lx, ly, rx, ry;
    private int mask;
    private float sentLx = 99, sentLy, sentRx, sentRy;
    private int sentMask = -1;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        goImmersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();   // the bars come back after a swipe or a dialog; hide them again
    }

    private void goImmersive() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    /** True for events from a game controller (not a TV remote or a keyboard). */
    private static boolean fromPad(InputEvent e) {
        int s = e.getSource();
        return (s & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                || (s & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    /** Controller button -> standard-gamepad index, or -1 if it isn't one we pass on. */
    private static int buttonIndex(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0;
            case KeyEvent.KEYCODE_BUTTON_B: return 1;
            case KeyEvent.KEYCODE_BUTTON_X: return 2;
            case KeyEvent.KEYCODE_BUTTON_Y: return 3;
            case KeyEvent.KEYCODE_BUTTON_L1: return 4;
            case KeyEvent.KEYCODE_BUTTON_R1: return 5;
            case KeyEvent.KEYCODE_BUTTON_L2: return BTN_LT;
            case KeyEvent.KEYCODE_BUTTON_R2: return BTN_RT;
            case KeyEvent.KEYCODE_BUTTON_SELECT: return 8;
            case KeyEvent.KEYCODE_BUTTON_START: return 9;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 10;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 11;
            case KeyEvent.KEYCODE_DPAD_UP: return BTN_UP;
            case KeyEvent.KEYCODE_DPAD_DOWN: return BTN_DOWN;
            case KeyEvent.KEYCODE_DPAD_LEFT: return BTN_LEFT;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return BTN_RIGHT;
            case KeyEvent.KEYCODE_BUTTON_MODE: return 16;
            default: return -1;
        }
    }

    private static float dead(float v) { return Math.abs(v) < 0.08f ? 0f : v; }

    private static float axis(MotionEvent ev, int a) { return ev.getAxisValue(a); }

    private void setBit(int index, boolean on) {
        if (on) mask |= (1 << index); else mask &= ~(1 << index);
    }

    /** Sends the controller's state to the page, only when something actually changed. */
    private void push() {
        boolean same = mask == sentMask && Math.abs(lx - sentLx) < 0.01f && Math.abs(ly - sentLy) < 0.01f
                && Math.abs(rx - sentRx) < 0.01f && Math.abs(ry - sentRy) < 0.01f;
        if (same || getBridge() == null) return;
        sentLx = lx; sentLy = ly; sentRx = rx; sentRy = ry; sentMask = mask;
        final String js = "window.__mimiPad&&window.__mimiPad(" + lx + "," + ly + "," + rx + "," + ry + "," + mask + ")";
        WebView web = getBridge().getWebView();
        if (web != null) web.evaluateJavascript(js, null);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent ev) {
        if (fromPad(ev)) {
            int idx = buttonIndex(ev.getKeyCode());
            if (idx >= 0) {
                int action = ev.getAction();
                if (action == KeyEvent.ACTION_DOWN) setBit(idx, true);
                else if (action == KeyEvent.ACTION_UP) setBit(idx, false);
                push();
                return true;   // handled: otherwise B would act as "Back" and quit the app
            }
        }
        return super.dispatchKeyEvent(ev);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent ev) {
        if (fromPad(ev) && ev.getAction() == MotionEvent.ACTION_MOVE) {
            lx = dead(axis(ev, MotionEvent.AXIS_X));
            ly = dead(axis(ev, MotionEvent.AXIS_Y));
            // The right stick is Z/RZ on most controllers (Shield included), RX/RY on some.
            float z = dead(axis(ev, MotionEvent.AXIS_Z)), rz = dead(axis(ev, MotionEvent.AXIS_RZ));
            float rxx = dead(axis(ev, MotionEvent.AXIS_RX)), ryy = dead(axis(ev, MotionEvent.AXIS_RY));
            rx = z != 0f ? z : rxx;
            ry = rz != 0f ? rz : ryy;
            float lt = Math.max(axis(ev, MotionEvent.AXIS_LTRIGGER), axis(ev, MotionEvent.AXIS_BRAKE));
            float rt = Math.max(axis(ev, MotionEvent.AXIS_RTRIGGER), axis(ev, MotionEvent.AXIS_GAS));
            setBit(BTN_LT, lt > 0.5f);
            setBit(BTN_RT, rt > 0.5f);
            // A hat switch is how many controllers report the D-pad.
            float hx = axis(ev, MotionEvent.AXIS_HAT_X), hy = axis(ev, MotionEvent.AXIS_HAT_Y);
            setBit(BTN_LEFT, hx < -0.5f);
            setBit(BTN_RIGHT, hx > 0.5f);
            setBit(BTN_UP, hy < -0.5f);
            setBit(BTN_DOWN, hy > 0.5f);
            push();
            return true;
        }
        return super.dispatchGenericMotionEvent(ev);
    }
}
