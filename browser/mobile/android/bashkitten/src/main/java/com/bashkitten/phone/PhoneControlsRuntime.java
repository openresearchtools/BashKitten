// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Private typed CLI listener. All I/O/provider work stays off the Android UI thread. */
public final class PhoneControlsRuntime {
    private static volatile PhoneControlsRuntime singleton;
    public static PhoneControlsRuntime get(Context context) {
        if (singleton==null) synchronized(PhoneControlsRuntime.class) { if(singleton==null) singleton=new PhoneControlsRuntime(context.getApplicationContext()); }
        return singleton;
    }
    final Context context; public final PhonePolicy policy;
    private final PhoneGrantRegistry grants; private final ExecutorService io=Executors.newCachedThreadPool();
    private final Map<String,PhoneProviders> providers=new HashMap<>();
    private final Set<Socket> connections=ConcurrentHashMap.newKeySet();
    private volatile ServerSocket listener; private volatile String issuer="";
    private volatile Consumer<JSONObject> ownerChanged;
    private volatile Socket ownerWatch;
    private PhoneControlsRuntime(Context context) { this.context=context;policy=new PhonePolicy(context);grants=new PhoneGrantRegistry(policy); }
    /** Set by the native controller, delivering the link through Termux's stdin bridge. */
    public void setOwnerLinkListener(Consumer<JSONObject> callback) { ownerChanged=callback; reconcile(); }
    public boolean connected(){return listener!=null&&ownerWatch!=null&&!ownerWatch.isClosed();}
    public void disconnectOwner() { io.execute(() -> { stop(); }); }
    public void reconcile() { io.execute(() -> {
        synchronized(this) {
            grants.clear(); PhoneFiles.clearShares(); providers.values().forEach(PhoneProviders::close); providers.clear();
            for(Socket socket:connections) if(socket!=ownerWatch) try { socket.close(); } catch(IOException ignored) { }
            if(!policy.master()) stop();
            else if(listener==null) try { start(); } catch(IOException error) { stop(); }
            policy.reconcileServices();
        }
    }); }
    public synchronized JSONObject ownerLink() throws Exception {
        if(listener==null || !policy.master()) throw new IllegalStateException("Phone controls unavailable");
        return new JSONObject().put("version",1).put("endpoint","http://127.0.0.1:"+listener.getLocalPort()).put("owner",issuer);
    }
    private void start() throws IOException {
        listener=new ServerSocket(0,32,InetAddress.getByName("127.0.0.1"));issuer=PhoneGrantRegistry.random();policy.stateChanged();
        ServerSocket server=listener;
        io.execute(() -> { while(!server.isClosed()) try { Socket s=server.accept();connections.add(s);io.execute(() -> serve(s)); } catch(IOException ignored) { break; } });
        Consumer<JSONObject> callback=ownerChanged;
        if(callback!=null) try { callback.accept(ownerLink()); } catch(Exception ignored) { stop(); }
    }
    private synchronized void stop() {
        grants.clear(); issuer=""; ownerWatch=null;policy.stateChanged();
        ServerSocket old=listener;listener=null;if(old!=null)try{old.close();}catch(IOException ignored){}
        for(Socket socket:connections)try{socket.close();}catch(IOException ignored){}
        providers.values().forEach(PhoneProviders::close);providers.clear();
    }
    private synchronized PhoneProviders provider(PhoneCommand command) {
        if(!policy.effective(command.feature))throw new SecurityException("Phone feature unavailable");
        return providers.computeIfAbsent(command.feature.name(),key -> new PhoneProviders(context,policy,command.feature));
    }
    private void serve(Socket socket) {
        boolean sent=false;
        try {
            socket.setSoTimeout(120000);
            InputStream in=new BufferedInputStream(socket.getInputStream());OutputStream out=socket.getOutputStream();
            String first=line(in);if(!"POST /v1 HTTP/1.1".equals(first))throw new SecurityException("Unknown Phone protocol");
            Map<String,String> headers=new HashMap<>();
            for(String line;(line=line(in))!=null&&!line.isEmpty();) {
                int colon=line.indexOf(':');if(colon<=0)throw new SecurityException("Invalid request");
                String key=line.substring(0,colon).toLowerCase(Locale.ROOT),value=line.substring(colon+1).trim();
                if(headers.put(key,value)!=null)throw new SecurityException("Duplicate header");
            }
            if(headers.containsKey("origin")||headers.containsKey("sec-fetch-mode")||headers.containsKey("transfer-encoding"))throw new SecurityException("Browser requests are not accepted");
            String host=headers.getOrDefault("host","");if(!host.equals("127.0.0.1:"+socket.getLocalPort()))throw new SecurityException("Invalid Phone host");
            long length=Long.parseLong(headers.getOrDefault("content-length","-1"));if(length<0)throw new SecurityException("Length required");
            InputStream body=new LimitedInput(in,length);
            boolean binary="application/octet-stream".equals(headers.get("content-type"));
            if(!binary && !"application/json".equals(headers.get("content-type")))throw new SecurityException("Unsupported Phone content type");
            if(!binary&&length>1048576)throw new IllegalArgumentException("Control metadata exceeds protocol limit; stream file data instead");
            JSONObject request=new JSONObject(binary ? new String(Base64.getUrlDecoder().decode(headers.getOrDefault("x-phone-request","")),StandardCharsets.UTF_8) : new String(body.readAllBytes(),StandardCharsets.UTF_8));
            if(request.optInt("version")!=1)throw new IllegalArgumentException("Unsupported Phone version");
            String command=request.getString("command");JSONObject args=request.optJSONObject("args");if(args==null)args=new JSONObject();
            String authorization=headers.getOrDefault("authorization","");
            if(command.startsWith("owner.")) {
                if(binary || !constant(authorization,"Owner "+issuer) || issuer.isEmpty())throw new SecurityException("Owner authorization required");
                JSONObject result;
                if(command.equals("owner.watch")) {
                    Socket previous=ownerWatch;ownerWatch=socket;policy.stateChanged();if(previous!=null&&previous!=socket)try{previous.close();}catch(IOException ignored){}
                    socket.setSoTimeout(0);out.write("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nCache-Control: no-store\r\nConnection: close\r\n\r\nready\n".getBytes(StandardCharsets.US_ASCII));out.flush();sent=true;
                    try { while(in.read()!=-1) { /* owner closes this lifetime channel on shutdown */ } }
                    finally { if(ownerWatch==socket){ownerWatch=null;grants.clear();policy.stateChanged();} }
                    return;
                }
                if(command.equals("owner.issue")){if(ownerWatch==null||ownerWatch.isClosed())throw new SecurityException("Native controller disconnected");result=grants.issue(args);}
                else if(command.equals("owner.revoke")){grants.revoke(args.getString("worker"));result=new JSONObject().put("revoked",true);}
                else if(command.equals("owner.disconnect")){result=new JSONObject().put("revoked",true);grants.clear();}
                else throw new IllegalArgumentException("Unknown owner command");
                send(out,200,new JSONObject().put("result",result));sent=true;return;
            }
            if(!authorization.startsWith("Bearer "))throw new SecurityException("Worker authorization required");
            PhoneGrantRegistry.Grant grant=grants.require(authorization.substring(7));
            final long generation=policy.generation();
            if(command.equals("status")||command.equals("capabilities")||command.equals("help")) {
                grants.check(grant);send(out,200,new JSONObject().put("result",new JSONObject().put("available",true).put("session",grant.session).put("commands",PhoneCommand.available(policy,args.optString("group")))));sent=true;return;
            }
            PhoneCommand definition=PhoneCommand.ALL.get(command);
            if(definition==null||!policy.effective(definition.feature))throw new SecurityException("Command unavailable");
            final long deadline=android.os.SystemClock.elapsedRealtime()+Math.min(120000,Math.max(1,request.optLong("timeoutMs",30000)));
            Runnable check=() -> { grants.check(grant);policy.require(definition.feature,generation);if(socket.isClosed()||Thread.currentThread().isInterrupted()||android.os.SystemClock.elapsedRealtime()>deadline)throw new CancellationException("Phone request cancelled or deadline elapsed"); };
            check.run();
            if(binary&&!command.equals("files.write")&&!command.equals("files.append"))throw new IllegalArgumentException("Command does not accept bytes");
            PhoneCommand.Result result=provider(definition).execute(command,args,binary?body:null,check);
            try {
                check.run();
                if(result.stream==null){send(out,200,new JSONObject().put("result",result.json));sent=true;}
                else {
                    out.write(("HTTP/1.1 200 OK\r\nContent-Type: "+result.type+"\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));sent=true;
                    byte[] buffer=new byte[65536];int count;while((count=result.stream.read(buffer))!=-1){check.run();out.write(buffer,0,count);}out.flush();
                }
            } finally { if(result.stream!=null)result.stream.close();if(result.cleanup!=null)result.cleanup.close(); }
        } catch(Exception error) {
            if(!sent&&!socket.isClosed())try{send(socket.getOutputStream(),error instanceof SecurityException?403:400,new JSONObject().put("error",error instanceof SecurityException?"Phone authorization, feature or protected surface denied":error instanceof CancellationException?"Phone request cancelled; do not replay an uncertain action":"Phone operation failed: "+error.getClass().getSimpleName()).put("code",error instanceof SecurityException?"denied":error instanceof CancellationException?"cancelled":"unavailable"));}catch(Exception ignored){}
        } finally {connections.remove(socket);try{socket.close();}catch(IOException ignored){}}
    }
    private static boolean constant(String a,String b){return java.security.MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8));}
    private static String line(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();int b;while((b=in.read())!=-1){if(b=='\n')break;if(b!='\r')out.write(b);if(out.size()>65536)throw new IOException("Invalid protocol header");}return b==-1&&out.size()==0?null:out.toString(StandardCharsets.US_ASCII);}
    private static void send(OutputStream out,int status,JSONObject json)throws IOException{byte[] bytes=json.toString().getBytes(StandardCharsets.UTF_8);out.write(("HTTP/1.1 "+status+" Result\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(bytes);out.flush();}
    static final class LimitedInput extends InputStream { final InputStream source;long remaining;LimitedInput(InputStream source,long remaining){this.source=source;this.remaining=remaining;}public int read()throws IOException{if(remaining==0)return -1;int v=source.read();if(v<0)throw new EOFException();remaining--;return v;}public int read(byte[] b,int o,int l)throws IOException{if(remaining==0)return -1;int n=source.read(b,o,(int)Math.min(l,remaining));if(n<0)throw new EOFException();remaining-=n;return n;}}
}
