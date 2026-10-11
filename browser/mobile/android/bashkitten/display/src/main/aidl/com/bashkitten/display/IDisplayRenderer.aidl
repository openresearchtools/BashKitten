// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.display;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import android.content.res.Configuration;
import com.bashkitten.display.IDisplayClient;
oneway interface IDisplayRenderer {
    void attach(long generation, IBinder hostToken, int displayId, int width, int height,
                in Configuration configuration, in ParcelFileDescriptor connection, IDisplayClient client);
    void resize(long generation, int width, int height, in Configuration configuration);
    void focus(long generation, boolean focused);
    void detach(long generation);
}
