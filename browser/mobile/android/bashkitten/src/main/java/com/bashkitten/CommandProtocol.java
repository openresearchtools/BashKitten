// SPDX-License-Identifier: AGPL-3.0-or-later
package com.bashkitten;

import java.security.SecureRandom;
import java.util.Locale;

/** Installed application identity and opaque file-transfer token helpers. */
final class CommandProtocol {
    static final String PACKAGE = "com.bashkitten";
    static final String ACTIVITY = PACKAGE + "/com.bashkitten.CommandAccessActivity";
    private static final SecureRandom RANDOM = new SecureRandom();
    static byte[] random(int size) { byte[] bytes = new byte[size]; RANDOM.nextBytes(bytes); return bytes; }
    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
}
