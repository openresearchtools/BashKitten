// SPDX-License-Identifier: MIT
// Accessibility operations adapted from Android Remote Control MCP v1.12.0.
// Copyright 2026–2027 Daniele Salvatore Albano. BashKitten changes: no caches,
// event channels/MCP; every command checks current policy and protected windows.
package com.bashkitten.phone;

import android.accessibilityservice.*;
import android.graphics.*;
import android.hardware.HardwareBuffer;
import android.os.*;
import android.view.*;
import android.view.accessibility.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

public final class PhoneAccessibilityService extends AccessibilityService {
    static volatile PhoneAccessibilityService current;
    private final Handler main=new Handler(Looper.getMainLooper());
    @Override protected void onServiceConnected(){current=this;PhoneControlsRuntime.get(this).policy.changed();reconcile();}
    @Override public void onAccessibilityEvent(AccessibilityEvent event){} // No content extraction/cache/collection.
    @Override public void onInterrupt(){}
    @Override public void onDestroy(){if(current==this){current=null;PhoneControlsRuntime.get(this).policy.stateChanged();}super.onDestroy();}
    void reconcile(){main.post(()->{
        PhonePolicy policy=PhoneControlsRuntime.get(this).policy;boolean used=false;for(PhonePolicy.Feature f:PhonePolicy.Feature.values())if(f.accessibility&&policy.master()&&policy.selected(f))used=true;
        AccessibilityServiceInfo info=getServiceInfo();if(info==null)return;
        info.eventTypes=0;info.notificationTimeout=0;
        info.flags=used ? AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS|AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS|(Build.VERSION.SDK_INT>=33?AccessibilityServiceInfo.FLAG_INPUT_METHOD_EDITOR:0):0;
        setServiceInfo(info);if(Build.VERSION.SDK_INT>=33)clearCache();
    });}
    private boolean protectedPackage(CharSequence packageName){String name=String.valueOf(packageName);return name.equals(getPackageName())||name.equals("com.android.settings")||name.contains("permissioncontroller")||name.equals("com.android.systemui");}
    private AccessibilityNodeInfo root(Runnable check){
        check.run();AccessibilityNodeInfo root=getRootInActiveWindow();if(root==null)throw new IllegalStateException("No accessible active window");
        if(protectedPackage(root.getPackageName()))throw new SecurityException("Protected Agent/browser/settings window");return root;
    }
    private void boundary(Runnable check){AccessibilityNodeInfo root=root(check);root.recycle();}
    private AccessibilityNodeInfo node(String path,Runnable check){
        AccessibilityNodeInfo node=root(check);if(path==null||path.isEmpty()||path.equals("0"))return node;
        if(!path.matches("0(?:/[0-9]+)*"))throw new IllegalArgumentException("Use current tree node path");
        for(String part:path.substring(2).split("/")){check.run();AccessibilityNodeInfo child=node.getChild(Integer.parseInt(part));node.recycle();if(child==null)throw new IllegalArgumentException("Node no longer exists");node=child;}
        if(protectedPackage(node.getPackageName())){node.recycle();throw new SecurityException("Protected node");}return node;
    }
    PhoneCommand.Result execute(String command,JSONObject a,Runnable check)throws Exception{
        boundary(check);
        if(command.equals("screen.screenshot"))return screenshot(check);
        JSONObject result;
        if(command.startsWith("screen."))result=screen(command,a,check);
        else if(command.startsWith("navigation.")){
            Map<String,Integer> actions=Map.of("back",GLOBAL_ACTION_BACK,"home",GLOBAL_ACTION_HOME,"recents",GLOBAL_ACTION_RECENTS,"notifications",GLOBAL_ACTION_NOTIFICATIONS,"quicksettings",GLOBAL_ACTION_QUICK_SETTINGS,"keyboard",GLOBAL_ACTION_BACK);
            int action=actions.get(command.substring(11));boolean success=onMain(()->{boundary(check);return performGlobalAction(action);},check);result=new JSONObject().put("accepted",success);
        }else if(command.startsWith("text."))result=text(command,a,check);
        else result=touch(command,a,check);
        check.run();return new PhoneCommand.Result(result);
    }
    private JSONObject screen(String command,JSONObject a,Runnable check)throws Exception{
        if(command.equals("screen.inspect")){AccessibilityNodeInfo node=node(a.optString("node","0"),check);try{return describe(node,a.optString("node","0"));}finally{node.recycle();}}
        long end=SystemClock.elapsedRealtime()+Math.min(120000,Math.max(1,a.optLong("timeoutMs",10000)));
        do{
            check.run();JSONArray nodes=new JSONArray();AccessibilityNodeInfo root=root(check);
            try{walk(root,"0",nodes,command.equals("screen.tree")?null:a.getString("text"),check);}finally{root.recycle();}
            if(!command.equals("screen.wait")||nodes.length()>0)return new JSONObject().put("nodes",nodes);
            if(SystemClock.elapsedRealtime()>=end)throw new TimeoutException("Element did not appear");Thread.sleep(100);
        }while(true);
    }
    private void walk(AccessibilityNodeInfo node,String path,JSONArray out,String query,Runnable check)throws Exception{
        check.run();if(protectedPackage(node.getPackageName()))return;
        JSONObject info=describe(node,path);String words=info.optString("text")+" "+info.optString("description")+" "+info.optString("viewId");if(query==null||words.toLowerCase(Locale.ROOT).contains(query.toLowerCase(Locale.ROOT)))out.put(info);
        for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)try{walk(child,path+"/"+i,out,query,check);}finally{child.recycle();}}
    }
    private JSONObject describe(AccessibilityNodeInfo node,String path)throws Exception{
        Rect rect=new Rect();node.getBoundsInScreen(rect);JSONArray actions=new JSONArray();for(AccessibilityNodeInfo.AccessibilityAction action:node.getActionList())actions.put(new JSONObject().put("id",action.getId()).put("label",action.getLabel()));
        return new JSONObject().put("node",path).put("package",node.getPackageName()).put("text",node.isPassword()?"":node.getText()).put("description",node.isPassword()?"":node.getContentDescription()).put("viewId",node.getViewIdResourceName()).put("class",node.getClassName()).put("bounds",new JSONArray(new int[]{rect.left,rect.top,rect.right,rect.bottom})).put("editable",node.isEditable()).put("enabled",node.isEnabled()).put("focused",node.isFocused()).put("actions",actions);
    }
    private JSONObject text(String command,JSONObject a,Runnable check)throws Exception{
        if(command.equals("text.key")){
            int key=a.getInt("keyCode");if(!Set.of(KeyEvent.KEYCODE_ENTER,KeyEvent.KEYCODE_DEL,KeyEvent.KEYCODE_FORWARD_DEL,KeyEvent.KEYCODE_TAB,KeyEvent.KEYCODE_ESCAPE,KeyEvent.KEYCODE_DPAD_LEFT,KeyEvent.KEYCODE_DPAD_RIGHT,KeyEvent.KEYCODE_DPAD_UP,KeyEvent.KEYCODE_DPAD_DOWN,KeyEvent.KEYCODE_MOVE_HOME,KeyEvent.KEYCODE_MOVE_END).contains(key))throw new IllegalArgumentException("Unsupported editing key");
            boolean success=onMain(()->{boundary(check);if(Build.VERSION.SDK_INT<33||getInputMethod()==null||getInputMethod().getCurrentInputConnection()==null)throw new IllegalStateException("Accessibility input connection unavailable");getInputMethod().getCurrentInputConnection().sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN,key));getInputMethod().getCurrentInputConnection().sendKeyEvent(new KeyEvent(KeyEvent.ACTION_UP,key));return true;},check);
            return new JSONObject().put("accepted",success);
        }
        AccessibilityNodeInfo target=node(a.optString("node","0"),check);
        try{
            if(!target.isEditable()||target.isPassword())throw new SecurityException("Target is not an editable non-password node");String old=target.getText()==null?"":target.getText().toString(),value=a.optString("text");
            if(command.equals("text.clear"))value="";else if(command.equals("text.append"))value=old+value;else if(command.equals("text.insert")){int start=a.optInt("start",target.getTextSelectionStart()),end=a.optInt("end",target.getTextSelectionEnd());if(start<0||end<start||end>old.length())throw new IllegalArgumentException("Invalid selection");value=old.substring(0,start)+value+old.substring(end);}
            Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,value);
            boolean success=onMain(()->{boundary(check);if(!target.refresh()||protectedPackage(target.getPackageName()))throw new SecurityException("Target changed");return target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args);},check);return new JSONObject().put("accepted",success);
        }finally{target.recycle();}
    }
    private JSONObject touch(String command,JSONObject a,Runnable check)throws Exception{
        if(command.equals("touch.node")||command.equals("touch.scroll")){
            AccessibilityNodeInfo target=node(a.optString("node","0"),check);
            try{
                int action=command.equals("touch.scroll")?(a.optString("direction","forward").equals("backward")?AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD:AccessibilityNodeInfo.ACTION_SCROLL_FORWARD):a.getInt("action");
                if(!Set.of(AccessibilityNodeInfo.ACTION_CLICK,AccessibilityNodeInfo.ACTION_LONG_CLICK,AccessibilityNodeInfo.ACTION_FOCUS,AccessibilityNodeInfo.ACTION_SELECT,AccessibilityNodeInfo.ACTION_SCROLL_FORWARD,AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD,AccessibilityNodeInfo.ACTION_EXPAND,AccessibilityNodeInfo.ACTION_COLLAPSE).contains(action))throw new IllegalArgumentException("Unsupported node action");
                boolean success=onMain(()->{boundary(check);if(!target.refresh()||protectedPackage(target.getPackageName()))throw new SecurityException("Target changed");return target.performAction(action);},check);return new JSONObject().put("accepted",success);
            }finally{target.recycle();}
        }
        GestureDescription.Builder gesture=new GestureDescription.Builder();long duration=Math.max(1,a.optLong("durationMs",command.equals("touch.longtap")?600:command.equals("touch.tap")||command.equals("touch.doubletap")?60:350));
        if(duration>GestureDescription.getMaxGestureDuration())throw new IllegalArgumentException("Gesture duration unsupported");
        if(command.equals("touch.gesture")){
            JSONArray paths=a.getJSONArray("paths");if(paths.length()>GestureDescription.getMaxStrokeCount())throw new IllegalArgumentException("Too many simultaneous strokes");
            for(int p=0;p<paths.length();p++){JSONArray points=paths.getJSONArray(p);Path path=new Path();for(int i=0;i<points.length();i++){JSONArray point=points.getJSONArray(i);if(i==0)path.moveTo((float)point.getDouble(0),(float)point.getDouble(1));else path.lineTo((float)point.getDouble(0),(float)point.getDouble(1));}gesture.addStroke(new GestureDescription.StrokeDescription(path,0,duration));}
        }else{
            float x=(float)a.getDouble("x"),y=(float)a.getDouble("y");Path path=new Path();path.moveTo(x,y);
            if(command.equals("touch.swipe"))path.lineTo((float)a.getDouble("endX"),(float)a.getDouble("endY"));
            if(command.equals("touch.pinch")){float start=(float)a.getDouble("startRadius"),end=(float)a.getDouble("endRadius");path=new Path();path.moveTo(x-start,y);path.lineTo(x-end,y);Path second=new Path();second.moveTo(x+start,y);second.lineTo(x+end,y);gesture.addStroke(new GestureDescription.StrokeDescription(second,0,duration));}
            gesture.addStroke(new GestureDescription.StrokeDescription(path,0,duration));if(command.equals("touch.doubletap"))gesture.addStroke(new GestureDescription.StrokeDescription(path,duration+100,duration));
        }
        CompletableFuture<Boolean> future=new CompletableFuture<>();onMain(()->{boundary(check);if(!dispatchGesture(gesture.build(),new GestureResultCallback(){@Override public void onCompleted(GestureDescription g){future.complete(true);}@Override public void onCancelled(GestureDescription g){future.complete(false);}},main))future.complete(false);return true;},check);
        return new JSONObject().put("completed",PhoneProviders.waitFor(future,check,duration+5000));
    }
    private PhoneCommand.Result screenshot(Runnable check)throws Exception{
        boundary(check);for(AccessibilityWindowInfo window:getWindows()){AccessibilityNodeInfo root=window.getRoot();if(root!=null)try{if(protectedPackage(root.getPackageName()))throw new SecurityException("Protected window is visible");}finally{root.recycle();}}
        CompletableFuture<Bitmap> future=new CompletableFuture<>();
        onMain(()->{boundary(check);takeScreenshot(Display.DEFAULT_DISPLAY,Runnable::run,new TakeScreenshotCallback(){
            @Override public void onSuccess(ScreenshotResult result){try(HardwareBuffer buffer=result.getHardwareBuffer()){check.run();Bitmap hardware=Bitmap.wrapHardwareBuffer(buffer,result.getColorSpace());if(hardware==null)throw new IllegalStateException("Screenshot unavailable");Bitmap pixels=hardware.copy(Bitmap.Config.ARGB_8888,false);hardware.recycle();if(!future.complete(pixels))pixels.recycle();}catch(Exception e){future.completeExceptionally(e);}}
            @Override public void onFailure(int error){future.completeExceptionally(new IllegalStateException("Android rejected screenshot: "+error));}
        });return true;},check);
        Bitmap bitmap=PhoneProviders.waitFor(future,check,10000);File file=File.createTempFile("phone-screen-",".png",getCacheDir());
        try{boundary(check);try(OutputStream out=new FileOutputStream(file)){if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,out))throw new IOException("Screenshot encode failed");}check.run();return new PhoneCommand.Result(new FileInputStream(file),"image/png",()->file.delete());}catch(Exception e){file.delete();throw e;}finally{bitmap.recycle();}
    }
    private <T>T onMain(Callable<T> action,Runnable check)throws Exception{CompletableFuture<T> future=new CompletableFuture<>();main.post(()->{try{check.run();future.complete(action.call());}catch(Exception e){future.completeExceptionally(e);}});return PhoneProviders.waitFor(future,check,10000);}
}
