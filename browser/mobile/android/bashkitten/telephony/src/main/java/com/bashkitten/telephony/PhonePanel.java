// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.telecom.TelecomManager;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.*;
import java.util.function.Consumer;

/** Setup-only native UI. All state/storage/Telecom/model work belongs to the async owner. */
public final class PhonePanel {
    private PhonePanel() { }
    public static void show(Activity activity, View controls) {
        TelephonyRuntime owner=TelephonyRuntime.get(activity);
        ScrollView scroll=new ScrollView(activity);LinearLayout panel=new LinearLayout(activity);panel.setOrientation(LinearLayout.VERTICAL);int padding=(int)(16*activity.getResources().getDisplayMetrics().density);panel.setPadding(padding,padding,padding,padding);scroll.addView(panel);
        TextView status=new TextView(activity);panel.addView(status);
        LinearLayout telephony=new LinearLayout(activity);telephony.setOrientation(LinearLayout.VERTICAL);panel.addView(telephony);
        LinearLayout backends=new LinearLayout(activity);backends.setOrientation(LinearLayout.VERTICAL);
        final boolean[] rendered={false}, syncing={false};
        Map<String,Switch> switches=new HashMap<>();Map<String,Spinner> selectors=new HashMap<>();Map<String,String[]> options=new HashMap<>();
        Consumer<JSONObject> observer=value->{
            if(activity.isFinishing()||activity.isDestroyed())return;
            JSONObject settings=value.optJSONObject("settings");if(settings==null){status.setText(value.optString("error"));return;}
            status.setText(value.optString("error").isBlank()?(value.optBoolean("connected")?"Phone backend connected":"Phone backend unavailable; connect this phone's Termux service"):value.optString("error"));
            if(!rendered[0]){
                rendered[0]=true;
                switches.put("telephony",toggle(activity,telephony,"Telephony",settings.optBoolean("telephony"),enabled->{
                    if(syncing[0])return;
                    if(enabled&&activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},7328);
                    owner.configure(TelephonyRuntime.json("telephony",enabled));
                }));
                switches.put("messages",toggle(activity,telephony,"Replyable messages",settings.optBoolean("messages"),enabled->{
                    if(syncing[0])return;
                    if(enabled&&Build.VERSION.SDK_INT>=33&&activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},7329);
                    owner.configure(TelephonyRuntime.json("messages",enabled));
                }));
                button(activity,telephony,"Calling account setup",()->owner.setupAccount().whenComplete((result,error)->activity.runOnUiThread(()->{if(error!=null){status.setText(error.getMessage());return;}try{activity.startActivity(new Intent(TelecomManager.ACTION_CHANGE_PHONE_ACCOUNTS));}catch(RuntimeException missing){status.setText("Calling account settings are unavailable on this device");}})));
                button(activity,telephony,"Check calling readiness",()->owner.readiness().whenComplete((ready,error)->activity.runOnUiThread(()->status.setText(error!=null?error.getMessage():ready.optBoolean("accountEnabled")&&ready.optBoolean("microphone")&&ready.optBoolean("gateway")?"Calling account and microphone are ready; LocalAI is checked on connection":"Calling unavailable. "+ready.optString("reason")+" Account enabled: "+ready.optBoolean("accountEnabled")+"; microphone: "+ready.optBoolean("microphone")+"; gateway: "+ready.optBoolean("gateway")))));
                button(activity,telephony,"Call agent",()->{if(activity.checkSelfPermission(Manifest.permission.CALL_PHONE)!=PackageManager.PERMISSION_GRANTED){activity.requestPermissions(new String[]{Manifest.permission.CALL_PHONE},7330);return;}owner.call(null);});
                button(activity,telephony,"Add Kitten contact",()->contact(activity,owner,null,status));
                button(activity,telephony,"Open LocalAI",owner::openLocalAI);
                options.put("ordinaryDefault",new String[]{"off","call-in","messages","calls"});selectors.put("ordinaryDefault",choose(activity,telephony,"New ordinary chats",new String[]{"Off","Call-in only","Messages","Calls"},new String[]{"off","call-in","messages","calls"},settings.optString("ordinaryDefault","off"),s->owner.configure(TelephonyRuntime.json("ordinaryDefault",s))));
                options.put("callDefault",new String[]{"call-in","messages","calls"});selectors.put("callDefault",choose(activity,telephony,"New chats started by call",new String[]{"Call-in only","Messages","Calls"},new String[]{"call-in","messages","calls"},settings.optString("callDefault","calls"),s->owner.configure(TelephonyRuntime.json("callDefault",s))));
                options.put("recent",new String[]{"1","2","3","4","5","6","7","8","9"});selectors.put("recent",choose(activity,telephony,"Recent chats to announce",new String[]{"1","2","3","4","5","6","7","8","9"},new String[]{"1","2","3","4","5","6","7","8","9"},String.valueOf(settings.optInt("recent",5)),s->owner.configure(TelephonyRuntime.json("recent",Integer.parseInt(s)))));
                options.put("finish",new String[]{"hash","silence","either"});selectors.put("finish",choose(activity,telephony,"Finish dictation",new String[]{"#","Silence","Either"},new String[]{"hash","silence","either"},settings.optString("finish","either"),s->owner.configure(TelephonyRuntime.json("finish",s))));
                EditText silence=new EditText(activity);silence.setInputType(android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);silence.setHint("Silence after speech, seconds");silence.setText(String.valueOf(settings.optDouble("silenceSeconds",4)));telephony.addView(silence);
                button(activity,telephony,"Save silence duration",()->{try{owner.configure(TelephonyRuntime.json("silenceSeconds",Double.parseDouble(silence.getText().toString())));}catch(NumberFormatException error){silence.setError("Use a positive number of seconds");}});
                TextView auto=new TextView(activity);auto.setText("For sideloaded Android Auto messaging, enable Allow unknown sources in Android Auto developer settings. Auto controls its own listen/reply review.");telephony.addView(auto);
                telephony.addView(backends);
                View divider=new View(activity);divider.setBackgroundColor(0xff808080);panel.addView(divider,new LinearLayout.LayoutParams(-1,1));if(controls!=null)panel.addView(controls);
            }
            syncing[0]=true;
            try { for(Map.Entry<String,Switch> entry:switches.entrySet())entry.getValue().setChecked(settings.optBoolean(entry.getKey()));
                for(Map.Entry<String,Spinner> entry:selectors.entrySet()){String selected=String.valueOf(settings.opt(entry.getKey()));entry.getValue().setTag(selected);int index=Arrays.asList(options.get(entry.getKey())).indexOf(selected);if(index>=0)entry.getValue().setSelection(index);}
            } finally { syncing[0]=false; }
            backends.removeAllViews();JSONObject list=value.optJSONObject("backends");JSONObject mailbox=value.optJSONObject("mailbox");if(list!=null)for(String id:TelephonyRuntime.keys(list)){
                JSONObject backend=list.optJSONObject(id);if(backend.optBoolean("revoked"))continue;
                TextView title=new TextView(activity);title.setText(backend.optString("name"));backends.addView(title);
                button(activity,backends,"Add contact",()->contact(activity,owner,id,status));
                toggle(activity,backends,"Divert calls to voicemail",backend.optBoolean("divert"),enabled->owner.divert(id,enabled));
                button(activity,backends,"View voicemail",()->{StringBuilder text=new StringBuilder();if(mailbox!=null)for(String key:TelephonyRuntime.keys(mailbox)){JSONObject item=mailbox.optJSONObject(key);if(id.equals(item.optString("backendId")))text.append(item.optString("title","Chat")).append(item.optBoolean("replied")?" · Replied":"").append(item.has("questionStatus")?" · "+item.optString("questionStatus"):"").append("\n").append(item.optString("text")).append("\n\n");}ScrollView view=new ScrollView(activity);TextView content=new TextView(activity);content.setText(text.length()==0?"No voicemail":text.toString());content.setTextIsSelectable(true);view.addView(content);new AlertDialog.Builder(activity).setTitle("Voicemail · "+backend.optString("name")).setView(view).setPositiveButton("Close",null).show();});
                button(activity,backends,"Clear voicemail",()->new AlertDialog.Builder(activity).setMessage("Clear this backend's voicemail? Pi chat history stays available.").setNegativeButton("Cancel",null).setPositiveButton("Clear",(d,w)->owner.clearMailbox(id)).show());
            }
        };
        AlertDialog dialog=new AlertDialog.Builder(activity).setTitle("Phone").setView(scroll).setPositiveButton("Close",null).create();dialog.setOnDismissListener(d->owner.unobserve(observer));dialog.show();owner.observe(observer);
    }
    private static void contact(Activity activity,TelephonyRuntime owner,String id,TextView status){owner.contact(id).whenComplete((intent,error)->activity.runOnUiThread(()->{if(error!=null){status.setText(error.getMessage());return;}try{activity.startActivity(intent);}catch(ActivityNotFoundException unavailable){status.setText("No contact editor is available");}}));}
    private static void button(Activity activity,LinearLayout parent,String label,Runnable action){Button button=new Button(activity);button.setText(label);button.setOnClickListener(v->action.run());parent.addView(button);}
    private static Switch toggle(Activity activity,LinearLayout parent,String label,boolean value,Consumer<Boolean> changed){Switch view=new Switch(activity);view.setText(label);view.setChecked(value);view.setOnCheckedChangeListener((button,enabled)->changed.accept(enabled));parent.addView(view);return view;}
    private static Spinner choose(Activity activity,LinearLayout parent,String title,String[] labels,String[] values,String current,Consumer<String> changed){TextView label=new TextView(activity);label.setText(title);parent.addView(label);Spinner spinner=new Spinner(activity);ArrayAdapter<String> adapter=new ArrayAdapter<>(activity,android.R.layout.simple_spinner_dropdown_item,labels);spinner.setAdapter(adapter);int index=Arrays.asList(values).indexOf(current);spinner.setSelection(Math.max(0,index));parent.addView(spinner);spinner.setTag(current);spinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> p,View view,int position,long id){String value=values[position];if(value.equals(spinner.getTag()))return;spinner.setTag(value);changed.accept(value);}public void onNothingSelected(AdapterView<?> p){}});return spinner;}
}
