// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.api;
import android.os.ParcelFileDescriptor;
oneway interface IDisplayConnection {
    void result(in ParcelFileDescriptor connection, String error);
}
