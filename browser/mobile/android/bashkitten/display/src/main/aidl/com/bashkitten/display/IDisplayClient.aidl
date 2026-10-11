// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.display;
import android.view.SurfaceControlViewHost.SurfacePackage;
oneway interface IDisplayClient {
    void surface(long generation, in SurfacePackage surface);
    void state(long generation, boolean connected, String error);
    void close(long generation);
}
