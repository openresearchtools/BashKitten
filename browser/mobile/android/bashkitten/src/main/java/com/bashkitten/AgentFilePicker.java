// SPDX-License-Identifier: GPL-3.0-only
package com.bashkitten;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import java.io.*;
import java.util.*;

/** Gives Gecko private local files for content selected in Android's document picker. */
final class AgentFilePicker {
    static Uri[] copy(Context context, List<Uri> selected) throws IOException {
        File root = new File(context.getCacheDir(), "agent-uploads");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Upload cache is unavailable");
        // Cache files can outlive a prompt because the page retains its File objects.
        File directory = new File(root, UUID.randomUUID().toString());
        if (!directory.mkdir()) throw new IOException("Upload cache is unavailable");
        try {
            ArrayList<Uri> files = new ArrayList<>();
            byte[] buffer = new byte[64 * 1024];
            for (Uri uri : selected) {
                // A picker must grant content access, never nominate a private app path.
                if (!"content".equals(uri.getScheme())) throw new IOException("Unsupported selected file");
                String name = null;
                try (Cursor cursor = context.getContentResolver().query(uri,
                        new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                }
                if (name == null || name.isBlank()) name = "attachment";
                name = name.replaceAll("[\\\\/\\p{Cntrl}]", "_");
                if (name.equals(".") || name.equals("..")) name = "attachment";
                File item = new File(directory, Integer.toString(files.size()));
                if (!item.mkdir()) throw new IOException("Upload cache is unavailable");
                File target = new File(item, name);
                try (InputStream input = context.getContentResolver().openInputStream(uri);
                        OutputStream output = new FileOutputStream(target)) {
                    if (input == null) throw new IOException("Selected file could not be read");
                    for (int count; (count = input.read(buffer)) != -1;) {
                        output.write(buffer, 0, count);
                    }
                }
                files.add(Uri.fromFile(target));
            }
            return files.toArray(new Uri[0]);
        } catch (Exception error) {
            remove(directory);
            if (error instanceof IOException) throw (IOException) error;
            throw new IOException("Selected files could not be read", error);
        }
    }

    private static void remove(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        file.delete();
    }
}
