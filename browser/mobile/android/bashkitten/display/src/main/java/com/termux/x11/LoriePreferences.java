// SPDX-License-Identifier: GPL-3.0-only
// Adapted from Termux:X11 fa3a8b430e28 PrefsProto. BashKitten removes the standalone
// Activity/broadcast and global Application dependency; writes remain asynchronous.
package com.termux.x11;

import android.content.SharedPreferences;

public final class LoriePreferences {
    public static class PrefsProto {
        private final SharedPreferences values;
        public PrefsProto(SharedPreferences values) { this.values = values; }
        public SharedPreferences get() { return values; }
        public abstract static class Preference {
            final String key;
            Preference(String key) { this.key = key; }
            public ListPreference asList() { return (ListPreference) this; }
            public StringPreference asString() { return (StringPreference) this; }
            public BooleanPreference asBoolean() { return (BooleanPreference) this; }
            public IntPreference asInt() { return (IntPreference) this; }
        }
        public class BooleanPreference extends Preference {
            final boolean fallback;
            BooleanPreference(String key, boolean fallback) { super(key); this.fallback = fallback; }
            public boolean get() { return values.getBoolean(key, fallback); }
            public void put(boolean value) { values.edit().putBoolean(key, value).apply(); }
        }
        public class IntPreference extends Preference {
            final int fallback;
            IntPreference(String key, int fallback) { super(key); this.fallback = fallback; }
            public int get() { return values.getInt(key, fallback); }
            public int defValue() { return fallback; }
        }
        public class StringPreference extends Preference {
            final String fallback;
            StringPreference(String key, String fallback) { super(key); this.fallback = fallback; }
            public String get() { return values.getString(key, fallback); }
            public void put(String value) { values.edit().putString(key, value).apply(); }
        }
        public class ListPreference extends StringPreference {
            ListPreference(String key, String fallback) { super(key, fallback); }
        }
    }
}
