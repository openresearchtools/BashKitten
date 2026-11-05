// SPDX-License-Identifier: AGPL-3.0-only
package com.taskarian.api;
import android.os.ParcelFileDescriptor;
oneway interface IDisplayConnection {
    void result(in ParcelFileDescriptor connection, String error);
}
