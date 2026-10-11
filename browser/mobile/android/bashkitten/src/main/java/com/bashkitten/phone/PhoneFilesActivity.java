// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.widget.*;
import org.json.*;
import java.util.UUID;

/** User-selected SAF roots and independent per-location read/write/delete policy. */
public final class PhoneFilesActivity extends Activity {
    private PhonePolicy policy;
    @Override public void onCreate(Bundle state){super.onCreate(state);policy=PhoneControlsRuntime.get(this).policy;render();}
    private void render(){LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);ScrollView scroll=new ScrollView(this);scroll.addView(layout);setContentView(scroll);
        Button add=new Button(this);add.setText("Add folder");add.setOnClickListener(v->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION),1));layout.addView(add);
        JSONArray items=new PhoneFiles(this,policy).locations();for(int i=0;i<items.length();i++)try{JSONObject item=items.getJSONObject(i);TextView name=new TextView(this);name.setText(item.optString("name","Folder"));layout.addView(name);
            for(String field:new String[]{"read","write","delete"}){Switch toggle=new Switch(this);toggle.setText(field);toggle.setChecked(item.optBoolean(field));toggle.setOnCheckedChangeListener((v,on)->{try{item.put(field,on);save(items);}catch(Exception ignored){}});layout.addView(toggle);}
            Button remove=new Button(this);remove.setText("Remove access");remove.setOnClickListener(v->{JSONArray next=new JSONArray();for(int n=0;n<items.length();n++)if(items.optJSONObject(n)!=item)next.put(items.optJSONObject(n));try{getContentResolver().releasePersistableUriPermission(Uri.parse(item.optString("uri")),Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(SecurityException ignored){}save(next);render();});layout.addView(remove);
        }catch(Exception ignored){}
    }
    private void save(JSONArray items){policy.preferences.edit().putString("locations",items.toString()).apply();policy.changed();}
    @Override public void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=1||result!=RESULT_OK||data==null||data.getData()==null)return;
        try{Uri uri=data.getData();int flags=data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);getContentResolver().takePersistableUriPermission(uri,flags);
            JSONArray items=new PhoneFiles(this,policy).locations();items.put(new JSONObject().put("id",UUID.randomUUID()).put("uri",uri).put("name",uri.getLastPathSegment()).put("read",true).put("write",false).put("delete",false));save(items);render();
        }catch(Exception e){new AlertDialog.Builder(this).setMessage("Android did not grant this folder").setPositiveButton("OK",null).show();}
    }
}
