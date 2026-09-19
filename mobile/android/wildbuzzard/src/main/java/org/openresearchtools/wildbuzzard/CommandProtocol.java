// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.json.JSONObject;

/** Framed, authenticated local IPC. The command key is never sent over the socket. */
final class CommandProtocol {
    static final int PORT = 48271;
    static final String PACKAGE = "org.openresearchtools.wildbuzzard";
    static final String ACTIVITY = PACKAGE + "/" + PACKAGE + ".CommandAccessActivity";
    static final SecureRandom RANDOM = new SecureRandom();
    static byte[] random(int size) { byte[] bytes = new byte[size]; RANDOM.nextBytes(bytes); return bytes; }
    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
    static byte[] key(String text) {
        if (text == null || !text.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid command key");
        byte[] bytes = new byte[32];
        for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) Integer.parseInt(text.substring(i * 2, i * 2 + 2), 16);
        return bytes;
    }
    static String id(byte[] key) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(key)); }
    static byte[] mac(byte[] key, String message) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
    }
    static JSONObject read(InputStream input, int limit) throws Exception {
        DataInputStream stream = new DataInputStream(input);
        int length = stream.readInt();
        if (length <= 0 || length > limit) throw new IOException("Invalid command frame");
        byte[] bytes = new byte[length]; stream.readFully(bytes);
        return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    }
    static void write(OutputStream output, JSONObject value) throws Exception {
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 1200000) throw new IOException("Command frame too large");
        DataOutputStream stream = new DataOutputStream(output);
        stream.writeInt(bytes.length); stream.write(bytes); stream.flush();
    }
    static JSONObject encrypt(byte[] key, String transcript, String text) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        byte[] iv = random(12);
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(mac(key, "encryption"), "AES"), new GCMParameterSpec(128, iv));
        cipher.updateAAD(transcript.getBytes(StandardCharsets.UTF_8));
        return new JSONObject().put("iv", Base64.getEncoder().encodeToString(iv))
            .put("data", Base64.getEncoder().encodeToString(cipher.doFinal(text.getBytes(StandardCharsets.UTF_8))));
    }
    static String decrypt(byte[] key, String transcript, JSONObject frame) throws Exception {
        byte[] iv = Base64.getDecoder().decode(frame.getString("iv"));
        if (iv.length != 12) throw new IOException("Invalid command nonce");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(mac(key, "encryption"), "AES"), new GCMParameterSpec(128, iv));
        cipher.updateAAD(transcript.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(Base64.getDecoder().decode(frame.getString("data"))), StandardCharsets.UTF_8);
    }
}
