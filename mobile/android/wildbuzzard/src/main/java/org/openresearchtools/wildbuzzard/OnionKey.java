// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

final class OnionKey {
    final String host, key;
    OnionKey(String address, String value) {
        String normalized = address.trim().toLowerCase(Locale.ROOT);
        if (normalized.contains("://")) normalized = URI.create(normalized).getHost();
        if (normalized != null && normalized.matches("[a-z2-7]{56}")) normalized += ".onion";
        if (normalized == null || !normalized.matches("[a-z2-7]{56}\\.onion")) throw new IllegalArgumentException("A v3 onion root address is required");
        String secret = value.trim().toUpperCase(Locale.ROOT);
        if (!secret.matches("[A-Z2-7]{51}[AQ]")) throw new IllegalArgumentException("Use the 52-character X25519 private key");
        host = normalized;
        key = secret;
    }
    String controlKey() {
        byte[] bytes = new byte[32];
        int buffer = 0, bits = 0, offset = 0;
        for (int i = 0; i < key.length(); i++) {
            char value = key.charAt(i);
            buffer = (buffer << 5) | (value >= 'A' && value <= 'Z' ? value - 'A' : value - '2' + 26);
            bits += 5;
            if (bits >= 8) { bits -= 8; bytes[offset++] = (byte) (buffer >>> bits); }
        }
        try { return java.util.Base64.getEncoder().withoutPadding().encodeToString(bytes); }
        finally { java.util.Arrays.fill(bytes, (byte) 0); }
    }
    static OnionKey parse(String text) {
        String value = text.trim();
        if (value.length() > 2048) throw new IllegalArgumentException("Credential too large");
        if (value.startsWith("http://") || value.startsWith("https://")) {
            URI uri = URI.create(value);
            if (uri.getUserInfo() != null || uri.getFragment() != null) throw new IllegalArgumentException("Invalid enrollment URL");
            String secret = null;
            for (String part : (uri.getRawQuery() == null ? "" : uri.getRawQuery()).split("&")) {
                if (part.startsWith("key=")) {
                    if (secret != null) throw new IllegalArgumentException("Duplicate key");
                    try { secret = URLDecoder.decode(part.substring(4), "UTF-8"); }
                    catch (java.io.UnsupportedEncodingException e) { throw new IllegalArgumentException(e); }
                }
            }
            if (secret == null) throw new IllegalArgumentException("QR does not contain an onion key");
            return new OnionKey(uri.getHost(), secret);
        }
        String[] fields = value.split(":", -1);
        if (fields.length != 4 || !fields[1].equals("descriptor") || !fields[2].equals("x25519")) throw new IllegalArgumentException("Expected address:descriptor:x25519:key");
        return new OnionKey(fields[0], fields[3]);
    }
}
