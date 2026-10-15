// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten;

import com.bashkitten.telephony.TelephonyRuntime;
import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Native lifetime owner; no Gecko document, shared worker token or remote audio. */
final class PhoneVoiceGateway implements TelephonyRuntime.Backend, AutoCloseable {
    private final BrowserApp app;
    private final AgentRuntime agent;
    private final TelephonyRuntime phone;
    private final ExecutorService io=Executors.newCachedThreadPool();
    private final ScheduledExecutorService delivery=Executors.newSingleThreadScheduledExecutor();
    private final Map<String,JSONObject> remotes=new ConcurrentHashMap<>();
    private final Map<String,Socket> active=new ConcurrentHashMap<>();
    private final Map<String,Long> seen=new ConcurrentHashMap<>();
    private volatile ServerSocket server;
    private volatile byte[] key;
    private volatile int port;
    private volatile boolean desired,requested,starting,localAvailable,registrationReady;
    private volatile long epoch,localEpoch;
    private final Set<Socket> accepted=ConcurrentHashMap.newKeySet();
    private boolean current(long token){return desired && token==epoch;}
    private void require(long token){if(!current(token))throw new CancellationException("Phone connection changed");}
    private boolean localCurrent(long token){return desired&&localAvailable&&token==localEpoch;}
    private void requireLocal(long token){if(!localCurrent(token))throw new CancellationException("Local phone gateway changed");}
    private String phoneId,generation;
    private final AtomicBoolean polling=new AtomicBoolean();
    private ScheduledFuture<?> remotePoll;
    PhoneVoiceGateway(BrowserApp app,AgentRuntime agent){
        this.app=app;this.agent=agent;phone=TelephonyRuntime.get(app);
        phone.install(this,()->app.main.post(()->{android.app.Activity activity=agent.activity.get();if(activity!=null)AgentSettingsActivity.open(activity,"localai");}));
        phone.setEnabledListener(enabled->{desired=enabled;requested=enabled;if(enabled){try{app.keepAlive();start();}catch(RuntimeException denied){phone.transportError(denied.getMessage());}}else close();});
        // Restoring a saved master is not itself a request to start transport.
        phone.settingsSnapshot().thenAccept(settings->app.main.post(()->desired=settings.optBoolean("telephony")||settings.optBoolean("messages")));
    }
    CompletableFuture<Void> restoreStartup(){return phone.settingsSnapshot().thenCompose(settings->{
        if(!settings.optBoolean("startup")||!settings.optBoolean("telephony")&&!settings.optBoolean("messages"))return CompletableFuture.completedFuture(null);
        return prepare(settings.optBoolean("telephony"),null);
    });}
    synchronized void ready(){localAvailable=true;if(desired&&requested)start();}
    synchronized void start(){
        if(!desired)return;
        if(remotePoll==null)remotePoll=delivery.scheduleWithFixedDelay(this::pollRemotes,2,2,TimeUnit.SECONDS);
        if(starting||port!=0||registrationReady&&!localAvailable)return;starting=true;final long token=++localEpoch,transport=epoch;phone.connectionChanged();
        io.execute(()->{
            try{
                if(!registrationReady){
                JSONObject saved=new SecretStore(app,"phone-registration").read();
                phoneId=saved.optString("phoneId",UUID.randomUUID().toString());generation=saved.optString("generation",UUID.randomUUID().toString());
                JSONObject remembered=saved.optJSONObject("remotes");if(remembered!=null){Iterator<String> keys=remembered.keys();while(keys.hasNext()){String id=keys.next();remotes.put(id,remembered.getJSONObject(id));}}
                require(transport);saveRegistration();registrationReady=true;
                }
                if(!desired||token!=localEpoch)return;
                if(!localAvailable){starting=false;phone.connectionChanged();phone.settingsSnapshot().thenAccept(settings->request("phone.settings",TelephonyRuntime.json("settings",settings)));return;}
                ServerSocket previous=server;if(previous!=null)previous.close();
                byte[] fresh=new byte[32];new SecureRandom().nextBytes(fresh);
                ServerSocket opened=new ServerSocket();opened.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),0));
                synchronized(this){if(!localCurrent(token)){opened.close();Arrays.fill(fresh,(byte)0);return;}key=fresh;server=opened;}
                io.execute(()->accept(opened,fresh,token));
                JSONObject bootstrap=TelephonyRuntime.json("port",opened.getLocalPort(),"key",hex(fresh),"phoneId",phoneId,"generation",generation);
                app.main.post(()->agent.command("phone-gateway-connect",bootstrap,result->{
                    if(!localCurrent(token)||server!=opened)return;
                    port=result.optInt("port");starting=false;
                    phone.registerBackend("local","Local",generation);
                    phone.settingsSnapshot().thenAccept(settings->request("phone.settings",TelephonyRuntime.json("settings",settings)));
                },message->{if(localCurrent(token)){starting=false;phone.transportError(message);}}));
            }catch(Exception failure){if(desired&&token==localEpoch){starting=false;phone.transportError(failure.getMessage());}}
        });
    }
    private void saveRegistration()throws Exception{JSONObject values=new JSONObject();for(Map.Entry<String,JSONObject> entry:remotes.entrySet())values.put(entry.getKey(),entry.getValue());new SecretStore(app,"phone-registration").write(TelephonyRuntime.json("phoneId",phoneId,"generation",generation,"remotes",values));}
    void connectRemote(String id,String name,Runnable done,java.util.function.Consumer<String> fail){
        if(!desired||!requested||!registrationReady){fail.accept("Turn on Calls or Messages before connecting a backend");return;}
        final long token=epoch;JSONObject previous=remotes.get(id);
        JSONObject identity=previous!=null?previous:TelephonyRuntime.json("phoneId",phoneId,"backendId",UUID.randomUUID().toString(),"generation",UUID.randomUUID().toString());
        agent.phoneRemoteRequest(id,"phone.register",TelephonyRuntime.json("phoneId",phoneId,"backendId",identity.optString("backendId"),"generation",identity.optString("generation"),"name",name),identity,result->{
            if(!current(token)||remotes.get(id)!=previous){fail.accept("Phone connection changed during registration");return;}
            remotes.put(id,identity);io.execute(()->{try{saveRegistration();phone.registerBackend(identity.optString("backendId"),name,identity.optString("generation")).thenRun(()->phone.settingsSnapshot().thenAccept(settings->app.main.post(()->agent.phoneRemoteRequest(id,"phone.settings",TelephonyRuntime.json("settings",settings),identity,ignored->done.run(),fail))));}catch(Exception error){app.main.post(()->fail.accept(error.getMessage()));}});
        },fail);
    }
    void renameRemote(String id,String name){JSONObject identity=remotes.get(id);if(identity!=null)phone.registerBackend(identity.optString("backendId"),name,identity.optString("generation"));}
    void removeRemote(String id){JSONObject identity=remotes.remove(id);if(identity==null)return;phone.revokeBackend(identity.optString("backendId"));agent.phoneRemoteRequest(id,"phone.revoke",new JSONObject(),identity,ignored->{},ignored->{});io.execute(()->{try{saveRegistration();}catch(Exception error){phone.transportError(error.getMessage());}});}
    private void accept(ServerSocket opened,byte[] secret,long token){while(!opened.isClosed()){try{Socket socket=opened.accept();accepted.add(socket);io.execute(()->receive(socket,secret,token));}catch(IOException closed){return;}}}
    private void receive(Socket socket,byte[] secret,long epochToken){try(socket){socket.setSoTimeout(30000);JSONObject envelope=read(socket,secret);JSONObject payload=verify(secret,envelope);requireLocal(epochToken);String token=envelope.getString("id")+":"+envelope.getString("nonce");long now=System.currentTimeMillis();seen.entrySet().removeIf(e->e.getValue()<now-30000);if(seen.putIfAbsent(token,now)!=null)throw new SecurityException("Replayed gateway request");String action=payload.getString("action");JSONObject value=payload.optJSONObject("value");
        CompletableFuture<JSONObject> result=switch(action){
            case "ready"->CompletableFuture.completedFuture(TelephonyRuntime.json("ok",true));
            case "deliver"->phone.deliver(value);
            case "live"->{phone.completedMessage(value);yield CompletableFuture.completedFuture(TelephonyRuntime.json("ok",true));}
            case "resolved"->phone.resolveEvent(value.optString("resolvedEventId"),value.optString("status")).thenApply(ignored->TelephonyRuntime.json("ok",true));
            case "withdraw"->phone.withdraw(value.optString("backendId"),value.optString("sessionId",null)).thenApply(ignored->TelephonyRuntime.json("ok",true));
            default->CompletableFuture.failedFuture(new SecurityException("Unknown native phone operation"));
        };
        JSONObject response;try{response=TelephonyRuntime.json("ok",true,"result",result.get());}catch(Exception error){response=TelephonyRuntime.json("ok",false,"error",error.getMessage());}
        requireLocal(epochToken);write(socket,secret,seal(secret,response,envelope.getString("id"),envelope.getString("nonce")));
    }catch(Exception denied){/* Unauthenticated or disconnected peers receive no native data. */}finally{accepted.remove(socket);}}
    @Override public CompletableFuture<Void> prepare(){return prepare(true,null);}
    @Override public CompletableFuture<Void> prepare(String backendId){return prepare("local".equals(backendId),backendId);}
    private CompletableFuture<Void> prepare(boolean local,String backendId){
        CompletableFuture<Void> ready=new CompletableFuture<>();
        phone.settingsSnapshot().whenComplete((settings,error)->app.main.post(()->{
            try{
                if(error!=null)throw new CompletionException(error);
                desired=settings.optBoolean("telephony")||settings.optBoolean("messages");
                if(!desired)throw new IllegalStateException("Phone is off");
                requested=true;app.keepAlive();start();awaitReady(ready,System.currentTimeMillis()+30000,local,backendId,epoch);
            }catch(Exception denied){ready.completeExceptionally(denied);}
        }));
        return ready;
    }
    private void awaitReady(CompletableFuture<Void> ready,long deadline,boolean local,String backendId,long token){
        if(!current(token)){ready.completeExceptionally(new CancellationException("Phone connection changed"));return;}
        if(local&&!localAvailable){ready.completeExceptionally(new IOException("Local is off; call speech is unavailable"));return;}
        if(local?connected():registrationReady){
            if(backendId!=null&&!backendId.equals("local")&&remotes.values().stream().noneMatch(value->backendId.equals(value.optString("backendId"))))ready.completeExceptionally(new IOException("Original backend is no longer registered"));
            else ready.complete(null);return;
        }
        if(System.currentTimeMillis()>deadline){ready.completeExceptionally(new IOException(local?"Phone's Termux gateway is unavailable":"Phone registration is unavailable"));return;}
        delivery.schedule(()->awaitReady(ready,deadline,local,backendId,token),100,TimeUnit.MILLISECONDS);
    }
    @Override public boolean connected(){return desired&&localAvailable&&port>0&&key!=null;}
    @Override public String connectionState(){return connected()?"connected":starting?"connecting":requested?"disconnected":"not-started";}
    @Override public CompletableFuture<JSONObject> request(String action,JSONObject value){
        final long token=epoch;if(!desired||!requested||!registrationReady)return CompletableFuture.failedFuture(new IOException("Phone transport is disconnected"));
        if(action.equals("phone.backends"))return phone.registeredBackends();
        if(action.equals("phone.settings")){for(Map.Entry<String,JSONObject> remote:remotes.entrySet())app.main.post(()->agent.phoneRemoteRequest(remote.getKey(),action,value,remote.getValue(),ignored->{},error->phone.transportError(error)));}
        String backend=value.optString("backendId","local");
        if(!action.startsWith("phone.speech.")&&!action.equals("phone.cancel")&&!backend.equals("local")&&!backend.isBlank()){
            Map.Entry<String,JSONObject> binding=remotes.entrySet().stream().filter(entry->backend.equals(entry.getValue().optString("backendId"))).findFirst().orElse(null);
            JSONObject identity=binding==null?null:binding.getValue();if(identity==null)return CompletableFuture.failedFuture(new SecurityException("Backend is not connected to this phone"));
            CompletableFuture<JSONObject> done=new CompletableFuture<>();app.main.post(()->agent.phoneRemoteRequest(binding.getKey(),action,value,identity,result->{if(current(token)&&remotes.get(binding.getKey())==identity)done.complete(result);else done.completeExceptionally(new CancellationException("Phone connection changed"));},error->done.completeExceptionally(new IOException(error))));return done;
        }
        if(action.equals("phone.settings")&&!connected())return CompletableFuture.completedFuture(TelephonyRuntime.json("ok",true));
        return exchange(action,value,null).thenApply(answer->answer.optJSONObject("result"));
    }
    @Override public CompletableFuture<byte[]> audio(String action,byte[] audio,JSONObject metadata){
        if(!action.startsWith("phone.speech."))return CompletableFuture.failedFuture(new SecurityException("Only phone LocalAI handles call audio"));
        return exchange(action,metadata,audio).thenApply(answer->Base64.getDecoder().decode(answer.optString("audio")));
    }
    private CompletableFuture<JSONObject> exchange(String action,JSONObject value,byte[] bytes){
        final long token=localEpoch;final byte[] secret=key;final int target=port;
        return CompletableFuture.supplyAsync(()->{
            requireLocal(token);if(!connected()||secret==null)throw new CompletionException(new IOException("Phone's Termux gateway is disconnected"));
            String id=UUID.randomUUID().toString(),nonce=UUID.randomUUID().toString();
            JSONObject payload=TelephonyRuntime.json("action",action,"value",value);try{if(bytes!=null)payload.put("audio",Base64.getEncoder().encodeToString(bytes));
                Socket socket=new Socket();String request=value.optString("requestId",value.optString("captureId",id));active.put(request,socket);
                try(socket){socket.connect(new InetSocketAddress("127.0.0.1",target),15000);socket.setSoTimeout(0);write(socket,secret,seal(secret,payload,id,nonce));socket.shutdownOutput();JSONObject envelope=read(socket,secret);if(!id.equals(envelope.optString("id"))||!nonce.equals(envelope.optString("nonce")))throw new SecurityException("Phone response identity changed");JSONObject result=verify(secret,envelope);requireLocal(token);if(!result.optBoolean("ok"))throw new IOException(result.optString("error","Phone request failed"));return result;}finally{active.remove(request,socket);}
            }catch(Exception failure){throw new CompletionException(failure);}
        },io);
    }
    @Override public void cancel(String requestId){Socket socket=active.remove(requestId);if(socket!=null)try{socket.close();}catch(IOException ignored){}if(connected())request("phone.cancel",TelephonyRuntime.json("requestId",requestId));}
    private void pollRemotes(){if(!desired||!requested||!registrationReady||!polling.compareAndSet(false,true))return;final long token=epoch;List<CompletableFuture<Void>> work=new ArrayList<>();for(Map.Entry<String,JSONObject> entry:remotes.entrySet()){
        CompletableFuture<Void> item=new CompletableFuture<>();work.add(item);
        app.main.post(()->agent.phoneRemoteRequest(entry.getKey(),"phone.pending",new JSONObject(),entry.getValue(),result->{
            if(!current(token)||remotes.get(entry.getKey())!=entry.getValue()){item.complete(null);return;}
            List<CompletableFuture<?>> sent=new ArrayList<>();
            JSONArray updates=result.optJSONArray("updates");if(updates!=null)for(int n=0;n<updates.length();n++){
                JSONObject update=updates.optJSONObject(n);if(update==null)continue;
                CompletableFuture<Void> saved=update.has("resolvedEventId")?phone.resolveEvent(update.optString("resolvedEventId"),update.optString("status")):phone.withdraw(update.optString("backendId"),update.optString("sessionId",null));
                sent.add(saved.thenRun(()->app.main.post(()->{if(current(token)&&remotes.get(entry.getKey())==entry.getValue())agent.phoneRemoteRequest(entry.getKey(),"phone.update-ack",TelephonyRuntime.json("eventId",update.optString("eventId")),entry.getValue(),ignored->{},ignored->{});})));
            }
            JSONArray live=result.optJSONArray("live");if(live!=null)for(int n=0;n<live.length();n++){JSONObject message=live.optJSONObject(n);if(message==null)continue;phone.completedMessage(message);agent.phoneRemoteRequest(entry.getKey(),"phone.live-ack",TelephonyRuntime.json("key",message.optString("key")),entry.getValue(),ignored->{},ignored->{});}
            JSONArray events=result.optJSONArray("events");if(events!=null)for(int i=0;i<events.length();i++){JSONObject event=events.optJSONObject(i);if(event==null)continue;sent.add(phone.deliver(event).handle((delivery,error)->{if(error!=null)phone.transportError(error.getMessage());if(current(token)&&remotes.get(entry.getKey())==entry.getValue())app.main.post(()->agent.phoneRemoteRequest(entry.getKey(),"phone.ack",TelephonyRuntime.json("eventId",event.optString("eventId"),"state",error==null?delivery.optString("state"):"failed"),entry.getValue(),ignored->{},ignored->{}));return null;}));}
            CompletableFuture.allOf(sent.toArray(new CompletableFuture[0])).whenComplete((ignored,error)->{if(error!=null)phone.transportError(error.getMessage());item.complete(null);});
        },error->{item.complete(null);}));
    }CompletableFuture.allOf(work.toArray(new CompletableFuture[0])).whenComplete((v,e)->polling.set(false));}
    private static JSONObject read(Socket socket,byte[] key)throws Exception{DataInputStream input=new DataInputStream(socket.getInputStream());byte[] proof=new byte[32];input.readFully(proof);if(!MessageDigest.isEqual(proof,proof(key)))throw new SecurityException("Unauthorized phone peer");int length=input.readInt();if(length<=0)throw new IOException("Invalid phone frame");byte[] bytes=new byte[length];input.readFully(bytes);try{return new JSONObject(new String(bytes,StandardCharsets.UTF_8));}finally{Arrays.fill(bytes,(byte)0);}}
    private static void write(Socket socket,byte[] key,JSONObject value)throws Exception{byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);try{DataOutputStream output=new DataOutputStream(socket.getOutputStream());output.write(proof(key));output.writeInt(bytes.length);output.write(bytes);output.flush();}finally{Arrays.fill(bytes,(byte)0);}}
    private static JSONObject seal(byte[] key,JSONObject payload,String id,String nonce)throws Exception{JSONObject value=TelephonyRuntime.json("id",id,"nonce",nonce,"time",System.currentTimeMillis(),"payload",payload.toString());value.put("mac",mac(key,value));return value;}
    private static JSONObject verify(byte[] key,JSONObject value)throws Exception{if(Math.abs(System.currentTimeMillis()-value.getLong("time"))>30000||!MessageDigest.isEqual(mac(key,value).getBytes(StandardCharsets.US_ASCII),value.optString("mac").getBytes(StandardCharsets.US_ASCII)))throw new SecurityException("Phone message failed authentication");return new JSONObject(value.getString("payload"));}
    private static String mac(byte[] key,JSONObject value)throws Exception{Mac hmac=Mac.getInstance("HmacSHA256");hmac.init(new SecretKeySpec(key,"HmacSHA256"));return hex(hmac.doFinal((value.getString("id")+"\n"+value.getString("nonce")+"\n"+value.getLong("time")+"\n"+value.getString("payload")).getBytes(StandardCharsets.UTF_8)));}
    private static byte[] proof(byte[] key)throws Exception{Mac hmac=Mac.getInstance("HmacSHA256");hmac.init(new SecretKeySpec(key,"HmacSHA256"));return hmac.doFinal("bashkitten-phone-frame-v1".getBytes(StandardCharsets.US_ASCII));}
    private static String hex(byte[] bytes){StringBuilder text=new StringBuilder();for(byte b:bytes)text.append(String.format(Locale.ROOT,"%02x",b&255));return text.toString();}
    synchronized void localStopped(){
        localAvailable=false;localEpoch++;port=0;starting=false;
        for(Socket socket:accepted)try{socket.close();}catch(IOException ignored){}accepted.clear();
        for(Socket socket:active.values())try{socket.close();}catch(IOException ignored){}active.clear();
        if(server!=null)try{server.close();}catch(IOException ignored){}server=null;
        byte[] old=key;key=null;if(old!=null)Arrays.fill(old,(byte)0);seen.clear();phone.hangup();phone.connectionChanged();
    }
    @Override public synchronized void close(){
        epoch++;requested=false;
        if(remotePoll!=null){remotePoll.cancel(false);remotePoll=null;}
        for(Map.Entry<String,JSONObject> remote:remotes.entrySet())app.main.post(()->agent.phoneRemoteRequest(remote.getKey(),"phone.disable",new JSONObject(),remote.getValue(),ignored->{},ignored->{}));
        boolean wasLocal=localAvailable;localStopped();localAvailable=wasLocal;
        app.main.post(()->agent.command("phone-gateway-disconnect",new JSONObject(),ignored->{},ignored->{}));
    }
}
