// SPDX-License-Identifier: MIT
// Adapted storage operations from Android Remote Control MCP v1.12.0.
// Copyright 2026–2027 Daniele Salvatore Albano. Modified for explicit SAF-only
// native location policies, bounded lifetime shares, streaming and live revocation.
package com.bashkitten.phone;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

final class PhoneFiles {
    private static final String transientDirectory="phone-control-"+UUID.randomUUID();
    static File temporary(Context context,String prefix,String suffix)throws IOException{
        File directory=new File(context.getCacheDir(),transientDirectory);
        if(!directory.isDirectory()&&!directory.mkdir()&&!directory.isDirectory())throw new IOException("Phone temporary storage unavailable");
        return File.createTempFile(prefix,suffix,directory);
    }
    static void discardPrevious(Context context){
        File[] entries=context.getCacheDir().listFiles();if(entries==null)return;
        for(File entry:entries){String name=entry.getName();
            if(name.startsWith("phone-control-")&&!name.equals(transientDirectory)){
                try{if(!entry.getCanonicalPath().equals(entry.getAbsolutePath())){entry.delete();continue;}}catch(IOException ignored){continue;}
                File[] children=entry.listFiles();if(children!=null)for(File child:children)child.delete();entry.delete();
            }else if(name.startsWith("phone-screen-")||name.startsWith("phone-share-")||name.startsWith("phone-replace-"))entry.delete();
        }
    }
    private final Context context;private final PhonePolicy policy;private final PhoneRequestScope scope;
    private static final class SharedFile {final File file;final String name;SharedFile(File file,String name){this.file=file;this.name=name;}}
    private static final List<SharedFile> shares=Collections.synchronizedList(new ArrayList<>());
    private static final java.util.Set<PhoneRequestScope> sharing=java.util.concurrent.ConcurrentHashMap.newKeySet();
    private static final java.util.concurrent.ExecutorService shareIO=java.util.concurrent.Executors.newCachedThreadPool();
    PhoneFiles(Context context,PhonePolicy policy){this(context,policy,new PhoneRequestScope());}
    PhoneFiles(Context context,PhonePolicy policy,PhoneRequestScope scope){this.context=context;this.policy=policy;this.scope=scope;}
    static void receive(Context context,Intent intent,java.util.function.Consumer<String> done){
        PhonePolicy policy=PhoneControlsRuntime.get(context).policy;if(!policy.effective(PhonePolicy.Feature.FILES)){done.accept("Files and sharing is Off");return;}
        // Keep the receiving Activity's temporary URI grant alive until the copy
        // completes off the UI thread. Content never survives the Files lifetime.
        List<Uri> received=new ArrayList<>();if(Intent.ACTION_SEND.equals(intent.getAction())){Uri uri=intent.getParcelableExtra(Intent.EXTRA_STREAM,Uri.class);if(uri!=null)received.add(uri);}
        else if(Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())){ArrayList<Uri> list=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM,Uri.class);if(list!=null)received.addAll(list);}
        final long generation=policy.generation();
        shareIO.execute(()->{String error=null;PhoneRequestScope scope=new PhoneRequestScope();sharing.add(scope);
            try {for(Uri uri:received){if(!"content".equals(uri.getScheme()))throw new SecurityException("Only deliberately shared content is accepted");Runnable check=()->policy.require(PhonePolicy.Feature.FILES,generation);check.run();
                android.content.pm.ProviderInfo source=context.getPackageManager().resolveContentProvider(uri.getAuthority(),0);if(source==null)throw new SecurityException("Shared provider unavailable");PhoneProviders.allowPackage(context,source.packageName);
                File file=temporary(context,"share-",".data");boolean kept=false;
                try {String name=new PhoneFiles(context,policy,scope).name(uri,check);try(InputStream in=scope.own(context.getContentResolver().openInputStream(uri));OutputStream out=scope.own(new FileOutputStream(file))){copy(in,out,check);}synchronized(shares){check.run();shares.add(new SharedFile(file,name));kept=true;}}finally{if(!kept)file.delete();}
            }}catch(Exception failure){error="Shared file unavailable or access was revoked";}finally{scope.close();sharing.remove(scope);}
            done.accept(error);
        });
    }
    static void clearShares(){for(PhoneRequestScope scope:sharing)scope.close();sharing.clear();synchronized(shares){for(SharedFile share:shares)share.file.delete();shares.clear();}}
    JSONArray locations(){try{return new JSONArray(policy.preferences.getString("locations","[]"));}catch(Exception e){return new JSONArray();}}
    private JSONObject location(String id)throws Exception{JSONArray all=locations();for(int i=0;i<all.length();i++){JSONObject item=all.getJSONObject(i);if(item.optString("id").equals(id))return item;}throw new SecurityException("Location not granted");}
    private Cursor query(Uri uri,String[] columns,Runnable check)throws Exception{
        android.os.CancellationSignal signal=new android.os.CancellationSignal();scope.own((AutoCloseable)signal::cancel);check.run();
        Cursor cursor=context.getContentResolver().query(uri,columns,null,null,null,signal);return cursor==null?null:scope.own(cursor);
    }
    private Uri resolve(JSONObject location,String path,boolean create,Runnable check)throws Exception{
        Uri tree=Uri.parse(location.getString("uri"));boolean granted=false;for(UriPermission p:context.getContentResolver().getPersistedUriPermissions())if(p.getUri().equals(tree)&&p.isReadPermission()&&(!create||p.isWritePermission()))granted=true;
        if(!granted)throw new SecurityException("Location Android access revoked");
        Uri current=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        String[] names=path.isEmpty()?new String[0]:path.split("/",-1);
        for(int i=0;i<names.length;i++){
            check.run();
            String name=names[i];if(name.isEmpty()||name.equals(".")||name.equals("..")||name.indexOf('\0')>=0)throw new IllegalArgumentException("Use relative document path");
            Uri child=null;try(Cursor c=query(DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(current)),new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},check)){
                if(c!=null)while(c.moveToNext())if(name.equals(c.getString(1))){child=DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0));break;}
            }
            if(child==null&&create&&i==names.length-1){check.run();child=DocumentsContract.createDocument(context.getContentResolver(),current,"application/octet-stream",name);}
            if(child==null)throw new FileNotFoundException();current=child;
        }
        return current;
    }
    PhoneCommand.Result execute(String command,JSONObject a,InputStream body,Runnable check)throws Exception{
        check.run();if(command.equals("files.locations")){JSONArray view=locations();for(int i=0;i<view.length();i++)view.getJSONObject(i).remove("uri");return result(new JSONObject().put("locations",view));}
        if(command.equals("files.shares")){JSONArray view=new JSONArray();synchronized(shares){for(int i=0;i<shares.size();i++)view.put(new JSONObject().put("share",i).put("name",shares.get(i).name));}return result(new JSONObject().put("shares",view));}
        if(a.has("share")){
            if(!command.equals("files.read"))throw new SecurityException("Shares are read-only");SharedFile shared; synchronized(shares){shared=shares.get(a.getInt("share"));}check.run();return new PhoneCommand.Result(scope.own(new FileInputStream(shared.file)),"application/octet-stream",null);
        }
        JSONObject location=location(a.getString("location"));
        boolean writing=Set.of("files.write","files.append","files.replace","files.download").contains(command),deleting=command.equals("files.delete");
        if(!location.optBoolean("read")||(writing&&!location.optBoolean("write"))||(deleting&&!location.optBoolean("delete")))throw new SecurityException("Location policy denies operation");
        Uri uri=resolve(location,a.optString("path"),writing,check);check.run();
        switch(command){
            case "files.list":
                JSONArray list=new JSONArray();try(Cursor c=query(DocumentsContract.buildChildDocumentsUriUsingTree(uri,DocumentsContract.getDocumentId(uri)),new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE},check)){
                    if(c!=null)while(c.moveToNext()){check.run();list.put(new JSONObject().put("name",c.getString(0)).put("type",c.getString(1)).put("size",c.isNull(2)?JSONObject.NULL:c.getLong(2)));}
                }return result(new JSONObject().put("files",list));
            case "files.read":return new PhoneCommand.Result(scope.own(context.getContentResolver().openInputStream(uri)),"application/octet-stream",null);
            case "files.delete":if(a.optString("path").isEmpty())throw new SecurityException("Cannot delete granted root");check.run();if(!DocumentsContract.deleteDocument(context.getContentResolver(),uri))throw new IOException("Delete rejected");break;
            case "files.download":
                try(PhoneDownload download=scope.own(new PhoneDownload(a.getString("url"),check));OutputStream out=scope.own(context.getContentResolver().openOutputStream(uri,"wt"))){copy(download.stream,out,check);}break;
            case "files.replace":
                String find=a.getString("find");if(find.isEmpty())throw new IllegalArgumentException("Find text must not be empty");
                // Stream the replacement into an owned temporary document before replacing the target.
                File temp=temporary(context,"replace-",".txt");
                try{
                    try(Reader in=new InputStreamReader(scope.own(context.getContentResolver().openInputStream(uri)),StandardCharsets.UTF_8);Writer out=new OutputStreamWriter(new FileOutputStream(temp),StandardCharsets.UTF_8)){
                        StringBuilder pending=new StringBuilder();int next;while((next=in.read())!=-1){check.run();pending.append((char)next);if(pending.length()>=find.length()){if(pending.toString().equals(find)){out.write(a.getString("text"));pending.setLength(0);}else{out.write(pending.charAt(0));pending.deleteCharAt(0);}}}out.write(pending.toString());
                    }
                    check.run();try(InputStream in=new FileInputStream(temp);OutputStream out=scope.own(context.getContentResolver().openOutputStream(uri,"wt"))){copy(in,out,check);}
                }finally{temp.delete();}break;
            default:
                if(body==null)body=new ByteArrayInputStream(a.getString("text").getBytes(StandardCharsets.UTF_8));
                try(OutputStream out=scope.own(context.getContentResolver().openOutputStream(uri,command.equals("files.append")?"wa":"wt"))){copy(body,out,check);}
        }
        check.run();return result(new JSONObject().put("status","completed"));
    }
    private String name(Uri uri,Runnable check)throws Exception{try(Cursor c=query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},check)){if(c!=null&&c.moveToFirst())return c.getString(0);}return "Shared file";}
    private static PhoneCommand.Result result(JSONObject json){return new PhoneCommand.Result(json);}
    static void copy(InputStream in,OutputStream out,Runnable check)throws IOException{if(in==null||out==null)throw new FileNotFoundException();byte[] bytes=new byte[65536];int n;while((n=in.read(bytes))!=-1){check.run();out.write(bytes,0,n);}check.run();}
    static void requirePublic(InetAddress address){
        byte[] raw=address.getAddress();
        if(address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isLinkLocalAddress()||address.isSiteLocalAddress()||address.isMulticastAddress()||(raw.length==16&&(raw[0]&0xfe)==0xfc)||(raw.length==4&&((raw[0]&255)==0||(raw[0]&255)==127||(raw[0]&255)>=224||(raw[0]&255)==100&&(raw[1]&0xc0)==64)))throw new SecurityException("Private/controller addresses cannot be downloaded or opened");
    }
    static URI publicUrl(String value)throws Exception{
        URI uri=new URI(value);if(!Set.of("https","http").contains(uri.getScheme())||uri.getUserInfo()!=null||uri.getHost()==null)throw new SecurityException("Use an ordinary public HTTP(S) address");
        for(InetAddress address:InetAddress.getAllByName(uri.getHost()))requirePublic(address);return uri;
    }
}
