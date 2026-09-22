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
        controlEncoding();
        System.out.println("PASS: QR/auth_private/manual parsing and malformed input rejection");
    }
    private static void controlEncoding() {
        String host = "a".repeat(56) + ".onion";
        String zero = "A".repeat(52), ones = "7".repeat(51) + "Q";
        if (!new OnionKey(host, zero).controlKey().equals("A".repeat(43))) throw new AssertionError("zero conversion");
        if (!new OnionKey(host, ones).controlKey().equals("/".repeat(42) + "8")) throw new AssertionError("ones conversion");
        String mixed = "AAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPQ";
        String expected = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
        if (!OnionKey.parse("http://" + host + "?key=" + mixed).controlKey().equals(expected)) throw new AssertionError("QR conversion");
        if (!OnionKey.parse(host.substring(0, 56) + ":descriptor:x25519:" + mixed).controlKey().equals(expected)) throw new AssertionError("file conversion");
        try { new OnionKey(host, "A".repeat(51) + "B"); throw new AssertionError("Invalid padding accepted"); }
        catch (IllegalArgumentException expectedError) {}
        System.out.println("PASS: manual, QR and auth_private Base32 keys convert to Tor control Base64; invalid padding rejected");
    }
}
