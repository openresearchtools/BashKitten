// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.api;
import com.bashkitten.api.IDisplayConnection;
oneway interface IDisplaySource {
    void connect(IDisplayConnection callback);
    void refreshAuthorization();
}
