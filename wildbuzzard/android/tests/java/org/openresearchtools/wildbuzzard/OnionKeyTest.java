// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

public final class OnionKeyTest {
    public static void main(String[] args) {
        String host = "a".repeat(56), key = "a".repeat(52);
        OnionKey qr = OnionKey.parse("http://" + host + ".onion?key=" + key);
        if (!qr.host.equals(host + ".onion") || !qr.key.equals(key.toUpperCase())) throw new AssertionError("QR");
        OnionKey file = OnionKey.parse(host + ":descriptor:x25519:" + key + "\n");
        if (!file.key.equals(qr.key)) throw new AssertionError("auth_private");
        String[] invalid = {"http://example.com?key=" + key, "http://" + host + ".onion?key=" + key + "&key=" + key,
            host + ":descriptor:x25519:" + "b".repeat(52), host + ":descriptor:x25519:" + key + "\r\nSETCONF x=y",
            "https://user@" + host + ".onion?key=" + key};
        for (String value : invalid) {
            try { OnionKey.parse(value); throw new AssertionError("Accepted invalid credential"); }
            catch (IllegalArgumentException expected) {}
        }
        System.out.println("PASS: QR/auth_private/manual parsing and malformed input rejection");
    }
}
