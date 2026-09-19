// SPDX-License-Identifier: AGPL-3.0-or-later
package org.mozilla.geckoview;

import androidx.annotation.NonNull;
import androidx.annotation.UiThread;
import org.mozilla.gecko.util.GeckoBundle;

/** Product-private bridge to the session's privileged browser module. */
public final class WildBuzzardController {
    private WildBuzzardController() {}
    @UiThread
    public static @NonNull GeckoResult<String> request(
            @NonNull GeckoSession session, @NonNull String json) {
        GeckoBundle data = new GeckoBundle(1);
        data.putString("request", json);
        return session.getEventDispatcher().queryString("WildBuzzard:Request", data);
    }
}
