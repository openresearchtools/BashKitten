// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.telecom.CallAudioState;
import org.json.*;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ScheduledFuture;
import java.util.function.Consumer;

/** One cancellable state machine per call. Menus snapshot stable IDs, never mutable titles. */
final class CallFlow implements AutoCloseable {
    private final TelephonyRuntime owner;
    private final KittenConnection call;
    private final CallAudio audio;
    private int generation;
    private long sequence;
    private long stopGeneration;
    private String backendDigits="";
    private String state="starting",sessionId="",nativeSessionId="",draft="",captureMode="replace",submissionId;
    private JSONObject targetEvent;
    private final LinkedHashMap<String,JSONObject> choices=new LinkedHashMap<>();
    private static final class Playback {
        final JSONObject event;
        final boolean live;
        Playback(JSONObject event,boolean live){this.event=event;this.live=live;}
    }
    private final ArrayDeque<Playback> pending=new ArrayDeque<>();
    private final Set<String> spoken=new HashSet<>();
    private JSONArray mailbox=new JSONArray();
    private int mailboxIndex;
    private boolean listening,lateConfirmed,hasStopGeneration;
    private JSONObject liveSubscription;
    private ScheduledFuture<?> liveRenewal;
    private CompletableFuture<JSONObject> liveRequests=CompletableFuture.completedFuture(null);
    CallFlow(TelephonyRuntime owner,KittenConnection call){this.owner=owner;this.call=call;audio=new CallAudio(owner,call.id);}
    private void transition(String state){stopLive();generation++;audio.cancel();this.state=state;}
    private JSONObject request(Object...pairs){JSONObject value=TelephonyRuntime.json("callId",call.id,"menuRevision",generation,"backendId",call.backend,"sessionId",sessionId,"nativeSessionId",nativeSessionId);JSONObject extra=TelephonyRuntime.json(pairs);for(String key:TelephonyRuntime.keys(extra))TelephonyRuntime.put(value,key,extra.opt(key));return value;}
    private void ask(String action,JSONObject payload,Consumer<JSONObject> done){int token=generation;owner.gateway.request(action,payload).whenComplete((value,error)->owner.execute(()->{if(call.ended||token!=generation)return;if(error!=null)failure(error);else done.accept(value);}));}
    private void speak(String text,Runnable done){int token=generation;audio.speak(text,()->{if(token==generation&&!call.ended)done.run();},error->{if(token==generation&&!call.ended)failure(error);});}
    private void prompt(String text){speak(text,()->commandCapture());}
    private void commandCapture(){int token=generation;JSONObject config=TelephonyRuntime.json("finish","silence","silenceSeconds",owner.settings().optDouble("silenceSeconds",4));audio.capture(config,text->{if(token==generation)spokenChoice(text);},error->{if(token==generation)failure(error);});}
    void start(){ask("phone.speech.ready",request(),value->{if(!value.optBoolean("ready")){failure(new IllegalStateException(value.optString("error","Set up speech in LocalAI before calling")));return;}if(call.backend==null)backendMenu();else if(call.eventId!=null){JSONObject event=owner.event(call.eventId);if(event!=null){sessionId=event.optString("sessionId");nativeSessionId=event.optString("nativeSessionId","");targetEvent=event;eventPrompt(event);return;}chatMenu();}else chatMenu();});}
    private void backendMenu(){backendDigits="";transition("backends");choices.clear();ask("phone.backends",request(),value->{JSONArray list=value.optJSONArray("backends");StringBuilder text=new StringBuilder("Choose a backend. ");if(list!=null)for(int i=0;i<list.length();i++){JSONObject backend=list.optJSONObject(i);if(backend==null)continue;String digit=String.valueOf(i+1);choices.put(digit,backend);text.append("Say ").append(digit).append(" for ").append(backend.optString("name")).append(". ");}if(choices.isEmpty())text.append("No backends are connected to this phone.");else if(choices.size()>9)text.insert(0,"Enter the backend number followed by hash, or say its number after the beep. ");prompt(text.toString());});}
    private void chatMenu(){transition("chats");choices.clear();targetEvent=null;sessionId="";draft="";hasStopGeneration=false;lateConfirmed=false;listening=false;ask("phone.chats",request("recent",owner.settings().optInt("recent",5)),value->{StringBuilder text=new StringBuilder("Press or say 0 to start a new chat. ");JSONArray list=value.optJSONArray("chats");if(list!=null)for(int i=0;i<list.length();i++){JSONObject chat=list.optJSONObject(i);if(chat==null)continue;String key=String.valueOf(i+1);choices.put(key,chat);text.append("Press or say ").append(key).append(" for ").append(title(chat)).append(chat.optBoolean("running")?", working. ":", finished. ");}long unread=0;JSONArray items=owner.mailboxItems(call.backend);for(int i=0;i<items.length();i++)if(!items.optJSONObject(i).optBoolean("played"))unread++;if(unread>0)text.append("You have ").append(unread).append(" unread voicemail messages. ");text.append("Press star for voicemail.");prompt(text.toString());});}
    private static String title(JSONObject value){String project=value.optString("projectTitle");return (project.isBlank()?"":project+", ")+value.optString("title","Chat");}
    private static String playbackId(JSONObject event){return event.optString("sessionId")+":"+event.optString("nativeSessionId")+":"+event.optString("entryId",event.optString("eventId"));}
    private boolean playable(JSONObject event){return !spoken.contains(playbackId(event))&&!(event.optString("kind").equals("question")&&event.optLong("expiresAt",Long.MAX_VALUE)<System.currentTimeMillis());}
    private boolean presentPendingHook(){
        while(!pending.isEmpty()){
            Playback next=pending.poll();
            if(next.live||!playable(next.event))continue;
            eventPrompt(next.event);return true;
        }
        return false;
    }
    private void chatActions(){if(presentPendingHook())return;transition("actions");prompt("Press or say 1 to send a message, 2 to read the last final message, or 3 to stream live. Press star for voicemail.");}
    private void newChat(){hasStopGeneration=false;draft="";transition("new");String creationId=UUID.randomUUID().toString();ask("phone.new",request("mode",owner.settings().optString("callDefault","calls"),"creationId",creationId),value->{sessionId=value.optString("sessionId");if(sessionId.isBlank()){failure(new IllegalStateException("Backend did not create a chat"));return;}capture("replace");});}
    private void capture(String mode){if(hasStopGeneration){captureReady(mode);return;}transition("preparing-capture");ask("phone.begin",request(),result->{stopGeneration=result.optLong("stopGeneration");hasStopGeneration=true;nativeSessionId=result.isNull("nativeSessionId")?"":result.optString("nativeSessionId","");captureReady(mode);});}
    private void captureReady(String mode){transition("dictating");captureMode=mode;int token=generation;audio.capture(owner.settings(),text->{if(token!=generation)return;draft=mode.equals("append")&&!draft.isBlank()?draft+"\n"+text:text;submissionId=UUID.randomUUID().toString();review();},error->{if(token!=generation)return;owner.callFailed(call.id,error);if(!draft.isBlank())review();else chatActions();});}
    private void review(){transition("review");prompt(draft+". Press or say 1 to send, 2 to change, or 3 to add more.");}
    private void send(){if(draft.isBlank())return;transition("sending");JSONObject payload=request("text",draft,"deliveryId",submissionId,"source",targetEvent!=null&&targetEvent.optBoolean("played")?"voicemail":"call","lateConfirmed",lateConfirmed,"stopGeneration",stopGeneration);
        if(targetEvent!=null){TelephonyRuntime.put(payload,"eventId",targetEvent.optString("eventId"));TelephonyRuntime.put(payload,"questionId",targetEvent.optString("questionId"));TelephonyRuntime.put(payload,"revision",targetEvent.optInt("revision",1));}
        ask("phone.reply",payload,result->{if(result.optBoolean("requiresFollowupConfirmation")){lateConfirmed=true;transition("review");prompt("That question has already closed. This will be a new follow-up. "+draft+". Press 1 to send, 2 to change, or 3 to add more.");return;}
            if(!List.of("accepted","submitting").contains(result.optString("deliveryStatus"))){failure(new IllegalStateException("Submission is held. Review its delivery in the chat; it will not be sent again automatically."));return;}
            draft="";lateConfirmed=false;hasStopGeneration=false;if(targetEvent!=null){owner.finishEvent(targetEvent.optString("eventId"),"replied");owner.replied(targetEvent.optString("eventId"));}targetEvent=null;transition("actions");speak(result.optString("deliveryStatus").equals("submitting")?"Answer recorded. Delivery is pending.":"Message sent.",this::chatActions);
        });}
    private void readLast(){transition("reading");ask("phone.last",request(),result->{String text=result.optString("text");speak(text.isBlank()?"This chat has no final message yet.":text,this::chatActions);});}
    private CompletableFuture<JSONObject> liveRequest(JSONObject subscription,boolean enabled){
        JSONObject payload=TelephonyRuntime.json();for(String key:TelephonyRuntime.keys(subscription))TelephonyRuntime.put(payload,key,subscription.opt(key));TelephonyRuntime.put(payload,"enabled",enabled);
        // Preserve enable/disable order even when the transport completes asynchronously.
        liveRequests=liveRequests.handle((value,error)->null).thenCompose(ignored->owner.gateway.request("phone.live",payload));return liveRequests;
    }
    private void stream(){transition("live-starting");targetEvent=null;listening=true;JSONObject subscription=request();liveSubscription=subscription;int token=generation;liveRequest(subscription,true).whenComplete((value,error)->owner.execute(()->{if(call.ended||token!=generation||liveSubscription!=subscription)return;if(error!=null){failure(error);return;}renewLive(subscription,token);speak("Live listening is on. Press 1 to send a message, 2 for the last final message, or star for voicemail.",()->{state="live";drain();});}));}
    private void renewLive(JSONObject subscription,int token){
        if(!listening||call.ended||generation!=token||liveSubscription!=subscription)return;
        liveRenewal=owner.serial.schedule(()->{liveRenewal=null;if(!listening||call.ended||generation!=token||liveSubscription!=subscription)return;liveRequest(subscription,true).whenComplete((value,error)->owner.execute(()->{if(call.ended||generation!=token||liveSubscription!=subscription)return;if(error!=null)failure(error);else renewLive(subscription,token);}));},20,java.util.concurrent.TimeUnit.SECONDS);
    }
    private void stopLive(){
        listening=false;pending.removeIf(item->item.live);if(liveRenewal!=null){liveRenewal.cancel(false);liveRenewal=null;}JSONObject subscription=liveSubscription;liveSubscription=null;
        if(subscription!=null&&owner.gateway!=null)liveRequest(subscription,false).whenComplete((value,error)->{if(error!=null)owner.execute(()->owner.callFailed(call.id,error));});
    }
    void live(JSONObject event){if(!listening||!Objects.equals(call.backend,event.optString("backendId"))||!sessionId.equals(event.optString("sessionId")))return;enqueue(event,true);}
    void enqueue(JSONObject event){enqueue(event,false);}
    private void enqueue(JSONObject event,boolean live){if(spoken.contains(playbackId(event)))return;pending.add(new Playback(event,live));if(state.equals("live"))drain();}
    private void drain(){
        if(!state.equals("live"))return;
        while(!pending.isEmpty()){
            Playback next=pending.poll();JSONObject event=next.event;
            if(!playable(event))continue;
            // A completion hook from another chat is its own identified menu,
            // never text from the selected live stream with the old reply target.
            if(!next.live&&(!sessionId.equals(event.optString("sessionId"))||event.optString("kind").equals("question"))){eventPrompt(event);return;}
            if(!sessionId.equals(event.optString("sessionId")))continue;
            spoken.add(playbackId(event));state="live-speaking";
            speak(event.optString("text"),()->{state="live";drain();});return;
        }
    }
    private void eventPrompt(JSONObject event){if(targetEvent==null||!targetEvent.optString("eventId").equals(event.optString("eventId"))){draft="";hasStopGeneration=false;lateConfirmed=false;}sessionId=event.optString("sessionId");nativeSessionId=event.optString("nativeSessionId","");targetEvent=event;transition("event");if(event.optString("kind").equals("question")){choices.clear();JSONArray options=event.optJSONArray("options");StringBuilder text=new StringBuilder(title(event)+". "+event.optString("text")+". ");if(options!=null)for(int i=0;i<options.length()&&i<9;i++){String key=String.valueOf(i+1);choices.put(key,TelephonyRuntime.json("text",options.optString(i)));text.append("Press or say ").append(key).append(" for ").append(options.optString(i)).append(". ");}text.append("Press or say 0 to dictate your own answer.");state="question";prompt(text.toString());return;}spoken.add(playbackId(event));prompt(title(event)+". "+event.optString("text")+". Press 1 to reply, 2 for the last final message, or 3 to stream live.");}
    private void voicemail(){transition("mailbox");listening=false;JSONObject backend=owner.backend(call.backend);prompt("Voicemail. Press or say 1 to listen, 2 to turn call diversion "+(backend.optBoolean("divert")?"off":"on")+", or hash to return.");}
    private void toggleDiversion(){
        String backend=call.backend;boolean divert=!owner.backend(backend).optBoolean("divert");
        transition("setting-diversion");int token=generation;
        owner.divert(backend,divert).whenComplete((ignored,error)->owner.execute(()->{
            if(call.ended||token!=generation||!Objects.equals(backend,call.backend))return;
            if(error!=null)failure(error);else voicemail();
        }));
    }
    private void listenMailbox(){mailbox=owner.mailboxItems(call.backend);mailboxIndex=0;mailItem();}
    private void mailItem(){transition("mail-item");if(mailboxIndex>=mailbox.length()){speak("No more voicemail messages.",this::voicemail);return;}JSONObject item=mailbox.optJSONObject(mailboxIndex);targetEvent=item;draft="";hasStopGeneration=false;lateConfirmed=false;sessionId=item.optString("sessionId");nativeSessionId=item.optString("nativeSessionId","");owner.played(item.optString("eventId"));prompt(title(item)+". "+item.optString("kind","final")+". "+(item.has("questionStatus")?item.optString("questionStatus")+". ":item.optLong("expiresAt",Long.MAX_VALUE)<System.currentTimeMillis()&&item.optString("kind").equals("question")?"Expired. ":"")+item.optString("text")+". Press 1 to reply if its backend is available, 2 for next, or hash to return.");}
    void key(char key,long seq){if(call.ended||seq<=sequence)return;sequence=seq;if(state.equals("dictating")){if(key=='#'&&!owner.settings().optString("finish","either").equals("silence"))audio.hash();return;}if(key=='*'&&call.backend!=null){voicemail();return;}
        String value=String.valueOf(key);if(!"0123456789#".contains(value))return;
        if(state.equals("backends")&&choices.size()>9){audio.cancel();if(key=='#'){String selected=backendDigits;backendDigits="";choose(selected);}else backendDigits+=key;return;}
        choose(value);
    }
    private void choose(String value){
        if(state.equals("backends")){JSONObject selected=choices.get(value);if(selected!=null){call.backend=selected.optString("id");chatMenu();}return;}
        if(state.equals("chats")){if(value.equals("0")){newChat();return;}JSONObject selected=choices.get(value);if(selected!=null){sessionId=selected.optString("id");hasStopGeneration=false;draft="";chatActions();}return;}
        if(state.equals("question")){if(value.equals("0")){capture("replace");return;}JSONObject choice=choices.get(value);if(choice!=null){transition("preparing-choice");ask("phone.begin",request(),result->{stopGeneration=result.optLong("stopGeneration");hasStopGeneration=true;nativeSessionId=result.isNull("nativeSessionId")?"":result.optString("nativeSessionId","");draft=choice.optString("text");submissionId=UUID.randomUUID().toString();review();});}return;}
        if(state.equals("review")){switch(value){case "1"->send();case "2"->capture("replace");case "3"->capture("append");}return;}
        if(state.equals("mailbox")){switch(value){case "1"->listenMailbox();case "2"->toggleDiversion();case "#"->chatMenu();}return;}
        if(state.equals("mail-item")){switch(value){case "1"->capture("replace");case "2"->{mailboxIndex++;mailItem();}case "#"->voicemail();}return;}
        if(List.of("actions","event","reading","live-starting","live","live-speaking").contains(state)){switch(value){case "1"->{listening=false;capture("replace");}case "2"->readLast();case "3"->stream();}}
    }
    private boolean legalChoice(String value){
        if(value.equals("*"))return call.backend!=null;
        return switch(state){
            case "backends" -> choices.containsKey(value);
            case "chats","question" -> value.equals("0")||choices.containsKey(value);
            case "review","actions","event" -> Set.of("1","2","3").contains(value);
            case "mailbox","mail-item" -> Set.of("1","2","#").contains(value);
            default -> false;
        };
    }
    private Map<String,String> spokenAliases(){
        Map<String,String> aliases=new LinkedHashMap<>();
        if(call.backend!=null){aliases.put("star","*");aliases.put("voicemail","*");}
        if(state.equals("review")){aliases.put("send","1");aliases.put("change","2");aliases.put("edit","2");aliases.put("add more","3");aliases.put("append","3");}
        if(state.equals("actions")||state.equals("event")){
            aliases.put("send a message","1");if(state.equals("event"))aliases.put("reply","1");
            aliases.put("read last final","2");aliases.put("read last message","2");aliases.put("read the last message","2");aliases.put("stream live","3");
        }
        if(state.equals("chats")){aliases.put("new chat","0");aliases.put("start new","0");}
        if(state.equals("mailbox"))aliases.put("listen","1");
        if(state.equals("mail-item")){aliases.put("reply","1");aliases.put("next","2");}
        if(state.equals("mailbox")||state.equals("mail-item")){aliases.put("hash","#");aliases.put("return","#");}
        return aliases;
    }
    // One substitution, insertion/deletion or adjacent transposition; never a
    // general intent guess. Short words, numbers and Send remain exact-only.
    private static boolean nearCommand(String text,String command){
        if(command.length()<5||command.startsWith("send")||text.equals(command)||Math.abs(text.length()-command.length())>1)return false;
        if(text.length()==command.length()){
            int first=-1,second=-1;
            for(int i=0;i<text.length();i++)if(text.charAt(i)!=command.charAt(i)){if(first<0)first=i;else if(second<0)second=i;else return false;}
            return second<0||second==first+1&&text.charAt(first)==command.charAt(second)&&text.charAt(second)==command.charAt(first);
        }
        String longer=text.length()>command.length()?text:command,shorter=text.length()>command.length()?command:text;
        int skip=0;for(int i=0;i<shorter.length();i++)if(shorter.charAt(i)!=longer.charAt(i+skip)){if(skip++!=0)return false;i--;}
        return true;
    }
    private void spokenChoice(String text){
        if(!List.of("backends","chats","question","review","actions","event","mailbox","mail-item").contains(state))return;
        if(text.contains("\"")||text.contains("“")||text.contains("”")||text.contains("'")||text.contains("‘")||text.contains("’")||text.toLowerCase(Locale.ROOT).matches(".*\\b(don.t|do not|not|never|cancel)\\b.*")){prompt("No selection made. Please choose an announced option.");return;}
        String normalized=text.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}0-9 ]"," ").trim();
        List<String> words=Arrays.asList(normalized.split("\\s+"));words=words.subList(0,Math.min(10,words.size()));
        if(words.stream().anyMatch(Set.of("no","not","never","dont","cancel","quote","quoted")::contains)){prompt("No selection made. Please choose an announced option.");return;}
        Set<String> exact=new HashSet<>(),near=new HashSet<>();
        Map<String,String> numbers=Map.ofEntries(Map.entry("zero","0"),Map.entry("one","1"),Map.entry("two","2"),Map.entry("three","3"),Map.entry("four","4"),Map.entry("five","5"),Map.entry("six","6"),Map.entry("seven","7"),Map.entry("eight","8"),Map.entry("nine","9"));
        for(String word:words){if(word.matches("[0-9]+"))exact.add(word);if(numbers.containsKey(word))exact.add(numbers.get(word));}
        Map<String,String> aliases=spokenAliases();
        for(Map.Entry<String,String> alias:aliases.entrySet()){
            int count=alias.getKey().split(" ").length;
            for(int i=0;i+count<=words.size();i++){
                String phrase=String.join(" ",words.subList(i,i+count));
                if(phrase.equals(alias.getKey()))exact.add(alias.getValue());
                else if(nearCommand(phrase,alias.getKey()))near.add(alias.getValue());
            }
        }
        Set<String> candidates=new HashSet<>(exact);candidates.addAll(near);
        String selected=candidates.size()==1?candidates.iterator().next():null;
        // A fuzzy word inside a longer sentence is not enough to take action.
        // Only a complete short command, with optional polite wrappers, qualifies.
        int first=0,last=words.size();Set<String> polite=Set.of("please","okay","ok");
        while(first<last&&polite.contains(words.get(first)))first++;
        while(last>first&&polite.contains(words.get(last-1)))last--;
        String whole=String.join(" ",words.subList(first,last));
        boolean fuzzy=false;for(Map.Entry<String,String> alias:aliases.entrySet())if(Objects.equals(selected,alias.getValue())&&nearCommand(whole,alias.getKey()))fuzzy=true;
        if(selected==null||!legalChoice(selected)||!exact.contains(selected)&&!fuzzy){prompt("No clear selection. Please choose an announced option.");return;}
        if(selected.equals("*"))voicemail();else choose(selected);
    }
    private void failure(Throwable error){owner.callFailed(call.id,error);transition("failed"); /* Remains hangup/keypad-responsive; no alternate speech engine or blind retry. */ }
    void withdraw(String backend,String session){
        if(!Objects.equals(call.backend,backend))return;
        pending.removeIf(item->session==null||session.equals(item.event.optString("sessionId")));
        if(session==null||session.equals(sessionId)){
            draft="";targetEvent=null;hasStopGeneration=false;sessionId="";nativeSessionId="";
            transition("withdrawn");
            // Chat Off cancels only that chat. Other authorized hooks retain
            // their original identity and can be presented after cancellation.
            if(session!=null&&!presentPendingHook())chatMenu();
        }
    }
    void resolved(String eventId,String status){
        pending.removeIf(item -> eventId.equals(item.event.optString("eventId")));
        if(targetEvent==null||!eventId.equals(targetEvent.optString("eventId")))return;
        TelephonyRuntime.put(targetEvent,"questionStatus",status);
        if(state.equals("question")){transition("event");prompt("That question is "+status+". Press 1 to send a new follow-up, 2 for the last final message, or 3 to stream live.");}
    }
    void audioRoute(CallAudioState state){audio.route(state);}
    @Override public void close(){transition("closed");audio.close();draft="";for(Playback item:pending)if(item.event.optString("route").equals("calls"))owner.mailbox(item.event.optString("eventId"));pending.clear();}
}
