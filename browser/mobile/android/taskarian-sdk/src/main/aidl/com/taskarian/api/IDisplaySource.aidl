// SPDX-License-Identifier: AGPL-3.0-only
package com.taskarian.api;
import com.taskarian.api.IDisplayConnection;
oneway interface IDisplaySource {
    void connect(IDisplayConnection callback);
    void refreshAuthorization();
}
