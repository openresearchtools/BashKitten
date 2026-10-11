// SPDX-License-Identifier: MIT
// Platform operations adapted from Android Remote Control MCP v1.12.0.
// Copyright 2026–2027 Daniele Salvatore Albano. BashKitten changes 2026:
// typed lazy providers, no MCP, live revocation, protected surfaces, no caches/logs.
package com.bashkitten.phone;

import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.location.*;
import android.net.Uri;
import android.os.*;
import android.service.notification.StatusBarNotification;
import org.json.*;
import java.io.InputStream;
import java.util.*;
import java.util.concurrent.*;

final class PhoneProviders implements AutoCloseable {
    private final Context context;private final PhonePolicy policy;private final PhonePolicy.Feature feature;
    private final Set<PhoneRequestScope> requests=ConcurrentHashMap.newKeySet();
    private final Set<CancellationSignal> cancellations=ConcurrentHashMap.newKeySet();
    private volatile boolean closed;
    PhoneProviders(Context context,PhonePolicy policy,PhonePolicy.Feature feature){this.context=context;this.policy=policy;this.feature=feature;}
    public void close(){closed=true;for(CancellationSignal s:cancellations)s.cancel();cancellations.clear();for(PhoneRequestScope scope:requests)scope.close();requests.clear();}
    PhoneCommand.Result execute(String command,JSONObject a,InputStream body,Runnable check)throws Exception{
        check.run();if(closed)throw new CancellationException("Phone request closed");JSONObject result;
        switch(feature){
            case APPS:result=apps(command,a,check);break;
            case NOTIFICATIONS:result=notifications(command,a,check);break;
            case CLIPBOARD:result=clipboard(command,a,check);break;
            case LOCATION:result=location(a,check);break;
            case FILES:
                PhoneRequestScope scope=new PhoneRequestScope();requests.add(scope);if(closed)scope.close();
                try {
                    PhoneCommand.Result value=new PhoneFiles(context,policy,scope).execute(command,a,body,check);
                    if(value.stream==null){scope.close();requests.remove(scope);return value;}
                    return new PhoneCommand.Result(value.stream,value.type,()->{scope.close();requests.remove(scope);if(value.cleanup!=null)value.cleanup.close();});
                }catch(Exception error){scope.close();requests.remove(scope);throw error;}
            default:
                PhoneAccessibilityService service=PhoneAccessibilityService.current;
                if(service==null)throw new IllegalStateException("Accessibility disconnected");
                return service.execute(command,a,check);
        }
        check.run();return new PhoneCommand.Result(result);
    }
    static void allowPackage(Context context,String name){
        if(name==null||name.equals(context.getPackageName())||name.equals("com.android.settings")||name.contains("permissioncontroller")||name.equals("com.android.systemui"))throw new SecurityException("Protected application");
    }
    private JSONObject apps(String command,JSONObject a,Runnable check)throws Exception{
        PackageManager pm=context.getPackageManager();
        if(command.equals("apps.list")){
            JSONArray values=new JSONArray();for(ResolveInfo info:pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0)){
                check.run();try{allowPackage(context,info.activityInfo.packageName);}catch(SecurityException e){continue;}
                values.put(new JSONObject().put("package",info.activityInfo.packageName).put("name",info.loadLabel(pm)));
            }return new JSONObject().put("applications",values);
        }
        Intent intent;
        if(command.equals("apps.open")){String name=a.getString("package");allowPackage(context,name);intent=pm.getLaunchIntentForPackage(name);if(intent==null)throw new IllegalStateException("Application not visible or launchable");}
        else {
            Uri uri=Uri.parse(a.getString("uri"));String scheme=uri.getScheme();
            if(!Set.of("https","http","mailto","tel","geo").contains(scheme)||uri.getUserInfo()!=null)throw new SecurityException("Unsupported link");
            if(scheme.equals("http")||scheme.equals("https"))PhoneFiles.publicUrl(uri.toString());
            // Resolve a single ordinary target, never an intent URI, component or private native intent.
            intent=new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE);
            ResolveInfo resolved=pm.resolveActivity(intent,PackageManager.MATCH_DEFAULT_ONLY);
            if(resolved==null)throw new IllegalStateException("No visible application can open link");
            allowPackage(context,resolved.activityInfo.packageName);intent.setPackage(resolved.activityInfo.packageName);
        }
        check.run();context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));return new JSONObject().put("status","requested_unconfirmed");
    }
    private JSONObject clipboard(String command,JSONObject a,Runnable check)throws Exception{
        ClipboardManager manager=(ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE);check.run();
        if(command.equals("clipboard.write")){manager.setPrimaryClip(ClipData.newPlainText("",a.getString("text")));return new JSONObject().put("status","written");}
        ClipData data=manager.getPrimaryClip();if(data==null||data.getItemCount()==0)throw new IllegalStateException("Clipboard is empty or Android denied background read");
        CharSequence value=data.getItemAt(0).getText();if(value==null)throw new IllegalStateException("Clipboard does not contain plain text");check.run();return new JSONObject().put("text",value);
    }
    private JSONObject location(JSONObject a,Runnable check)throws Exception{
        LocationManager manager=(LocationManager)context.getSystemService(Context.LOCATION_SERVICE);
        String provider=manager.isProviderEnabled(LocationManager.GPS_PROVIDER)?LocationManager.GPS_PROVIDER:LocationManager.NETWORK_PROVIDER;
        if(!manager.isProviderEnabled(provider))throw new IllegalStateException("Location provider unavailable");
        Location value;
        if(!a.optBoolean("fresh",true))value=manager.getLastKnownLocation(provider);
        else{
            CompletableFuture<Location> future=new CompletableFuture<>();CancellationSignal signal=new CancellationSignal();cancellations.add(signal);if(closed)signal.cancel();
            try{check.run();manager.getCurrentLocation(provider,signal,Runnable::run,future::complete);value=waitFor(future,check,10000);}finally{signal.cancel();cancellations.remove(signal);}
        }
        check.run();if(value==null)throw new IllegalStateException("No location fix available");
        return new JSONObject().put("latitude",value.getLatitude()).put("longitude",value.getLongitude()).put("accuracyMeters",value.getAccuracy()).put("time",value.getTime()).put("provider",value.getProvider());
    }
    private JSONObject notifications(String command,JSONObject a,Runnable check)throws Exception{
        PhoneNotificationService listener=PhoneNotificationService.current;if(listener==null)throw new IllegalStateException("Notification listener disconnected");
        check.run();StatusBarNotification[] notifications=listener.getActiveNotifications();if(notifications==null)throw new IllegalStateException("Notifications unavailable");
        if(command.equals("notifications.list")){
            JSONArray values=new JSONArray();for(StatusBarNotification item:notifications){
                check.run();try{allowPackage(context,item.getPackageName());}catch(SecurityException e){continue;}
                Notification n=item.getNotification();JSONArray actions=new JSONArray();if(n.actions!=null)for(int index=0;index<n.actions.length;index++)actions.put(new JSONObject().put("index",index).put("title",n.actions[index].title).put("reply",hasReply(n.actions[index])));
                values.put(new JSONObject().put("key",item.getKey()).put("package",item.getPackageName()).put("title",n.extras.getCharSequence(Notification.EXTRA_TITLE,"")).put("text",n.extras.getCharSequence(Notification.EXTRA_TEXT,"")).put("time",item.getPostTime()).put("actions",actions));
            }return new JSONObject().put("notifications",values);
        }
        StatusBarNotification item=Arrays.stream(notifications).filter(n -> n.getKey().equals(a.optString("key"))).findFirst().orElseThrow(()->new IllegalArgumentException("Notification no longer exists"));
        allowPackage(context,item.getPackageName());Notification n=item.getNotification();check.run();
        switch(command){
            case "notifications.dismiss":listener.cancelNotification(item.getKey());break;
            case "notifications.snooze":long duration=a.getLong("durationMs");if(duration<=0)throw new IllegalArgumentException("Positive snooze required");listener.snoozeNotification(item.getKey(),duration);break;
            case "notifications.open":send(n.contentIntent,null,check);return new JSONObject().put("status","requested_unconfirmed");
            default:
                int index=a.getInt("action");if(n.actions==null||index<0||index>=n.actions.length)throw new IllegalArgumentException("Action no longer exists");Notification.Action action=n.actions[index];Intent fill=null;
                if(command.equals("notifications.reply")){
                    if(!hasReply(action))throw new IllegalArgumentException("Action has no current text reply");
                    Bundle results=new Bundle();for(RemoteInput input:action.getRemoteInputs())if(input.getAllowFreeFormInput())results.putCharSequence(input.getResultKey(),a.getString("text"));
                    fill=new Intent();RemoteInput.addResultsToIntent(action.getRemoteInputs(),fill,results);RemoteInput.setResultsSource(fill,RemoteInput.SOURCE_FREE_FORM_INPUT);
                }
                send(action.actionIntent,fill,check);return new JSONObject().put("status","requested_unconfirmed");
        }
        return new JSONObject().put("status","requested");
    }
    private static boolean hasReply(Notification.Action a){if(a.getRemoteInputs()!=null)for(RemoteInput input:a.getRemoteInputs())if(input.getAllowFreeFormInput())return true;return false;}
    private void send(PendingIntent intent,Intent fill,Runnable check)throws Exception{if(intent==null)throw new IllegalStateException("No current action");allowPackage(context,intent.getCreatorPackage());check.run();intent.send(context,0,fill);}
    static <T>T waitFor(CompletableFuture<T> future,Runnable check,long timeout)throws Exception{
        long end=SystemClock.elapsedRealtime()+timeout;
        try{while(true){check.run();long remaining=end-SystemClock.elapsedRealtime();if(remaining<=0)throw new TimeoutException();try{return future.get(Math.min(remaining,100),TimeUnit.MILLISECONDS);}catch(TimeoutException e){if(remaining<=100)throw e;}}}catch(Exception e){future.cancel(true);throw e;}
    }
}
