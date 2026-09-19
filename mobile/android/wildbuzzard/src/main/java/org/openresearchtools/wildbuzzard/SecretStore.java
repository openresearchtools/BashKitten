// SPDX-License-Identifier: AGPL-3.0-or-later
package org.openresearchtools.wildbuzzard;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class SecretStore {
    private final AtomicFile file;
    private final String alias;
    SecretStore(Context context, String name) {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), name + ".vault"));
        alias = "wildbuzzard." + name;
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(alias)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(alias, null);
    }
    synchronized JSONObject read() throws Exception {
        byte[] bytes;
        try { bytes = file.readFully(); }
        catch (java.io.FileNotFoundException error) {
            if (file.getBaseFile().exists()) throw error;
            return new JSONObject();
        }
        if (bytes.length < 29) throw new IllegalStateException("Invalid encrypted store");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, bytes, 0, 12));
        cipher.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
        byte[] plain = cipher.doFinal(bytes, 12, bytes.length - 12);
        try { return new JSONObject(new String(plain, StandardCharsets.UTF_8)); }
        finally { Arrays.fill(plain, (byte) 0); }
    }
    synchronized void write(JSONObject value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
        byte[] plain = value.toString().getBytes(StandardCharsets.UTF_8);
        FileOutputStream output = null;
        try {
            byte[] encrypted = cipher.doFinal(plain);
            output = file.startWrite();
            output.write(cipher.getIV());
            output.write(encrypted);
            file.finishWrite(output);
        } catch (Exception error) {
            if (output != null) file.failWrite(output);
            throw error;
        } finally { Arrays.fill(plain, (byte) 0); }
    }
}
