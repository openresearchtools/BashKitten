// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.LinkedHashMap;
import java.util.Map;

final class PhoneCommand {
    final String name, usage; final PhonePolicy.Feature feature;
    private PhoneCommand(String name, PhonePolicy.Feature feature, String usage) { this.name=name;this.feature=feature;this.usage=usage; }
    static final Map<String,PhoneCommand> ALL=new LinkedHashMap<>();
    static void add(PhonePolicy.Feature feature,String name,String usage) { ALL.put(name,new PhoneCommand(name,feature,usage)); }
    static {
        add(PhonePolicy.Feature.APPS,"apps.list",""); add(PhonePolicy.Feature.APPS,"apps.open","package"); add(PhonePolicy.Feature.APPS,"apps.link","uri (https/http/mailto/tel/geo)");
        for (String name:new String[]{"list","open","dismiss","snooze","action","reply"}) add(PhonePolicy.Feature.NOTIFICATIONS,"notifications."+name,"key; action index; text (reply); durationMs (snooze)");
        for (String name:new String[]{"locations","list","read","write","append","replace","download","delete","shares"}) add(PhonePolicy.Feature.FILES,"files."+name,"location; path; input/output for streams; url for download; find/text for replace");
        add(PhonePolicy.Feature.CLIPBOARD,"clipboard.read","");add(PhonePolicy.Feature.CLIPBOARD,"clipboard.write","text");add(PhonePolicy.Feature.LOCATION,"location.get","fresh (default true)");
        for (String name:new String[]{"tree","find","wait","inspect","screenshot"}) add(PhonePolicy.Feature.SCREEN,"screen."+name,"node (path); text; timeoutMs; output for screenshot");
        for (String name:new String[]{"tap","longtap","doubletap","swipe","scroll","pinch","gesture","node"}) add(PhonePolicy.Feature.TOUCH,"touch."+name,"x,y; endX,endY; durationMs; paths; node/action");
        for (String name:new String[]{"append","insert","replace","clear","key"}) add(PhonePolicy.Feature.TEXT,"text."+name,"node; text; start/end for insert; keyCode for key");
        for (String name:new String[]{"back","home","recents","notifications","quicksettings","keyboard"}) add(PhonePolicy.Feature.NAVIGATION,"navigation."+name,"");
    }
    static JSONArray available(PhonePolicy policy,String group) throws Exception {
        JSONArray list=new JSONArray(); for (PhoneCommand c:ALL.values()) if (policy.effective(c.feature) && (group.isEmpty() || c.name.startsWith(group+"."))) list.put(new JSONObject().put("command",c.name).put("arguments",c.usage)); return list;
    }
    static final class Result {
        final JSONObject json; final InputStream stream; final String type; final AutoCloseable cleanup;
        Result(JSONObject json) { this.json=json;this.stream=null;this.type="application/json";this.cleanup=null; }
        Result(InputStream stream,String type,AutoCloseable cleanup) { this.json=null;this.stream=stream;this.type=type;this.cleanup=cleanup; }
    }
}
