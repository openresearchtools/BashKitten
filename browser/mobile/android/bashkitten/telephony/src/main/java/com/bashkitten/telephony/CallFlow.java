// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.telecom.CallAudioState;
import org.json.*;
import java.util.*;
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
    private final ArrayDeque<JSONObject> pending=new ArrayDeque<>();
    private final Set<String> spoken=new HashSet<>();
    private JSONArray mailbox=new JSONArray();
    private int mailboxIndex;
    private boolean listening,lateConfirmed,hasStopGeneration;
    CallFlow(TelephonyRuntime owner,KittenConnection call){this.owner=owner;this.call=call;audio=new CallAudio(owner,call.id);}
    private void transition(String state){generation++;audio.cancel();this.state=state;}
    private JSONObject request(Object...pairs){JSONObject value=TelephonyRuntime.json("callId",call.id,"menuRevision",generation,"backendId",call.backend,"sessionId",sessionId,"nativeSessionId",nativeSessionId);JSONObject extra=TelephonyRuntime.json(pairs);for(String key:TelephonyRuntime.keys(extra))TelephonyRuntime.put(value,key,extra.opt(key));return value;}
    private void ask(String action,JSONObject payload,Consumer<JSONObject> done){int token=generation;owner.gateway.request(action,payload).whenComplete((value,error)->owner.execute(()->{if(call.ended||token!=generation)return;if(error!=null)failure(error);else done.accept(value);}));}
    private void speak(String text,Runnable done){int token=generation;audio.speak(text,()->{if(token==generation&&!call.ended)done.run();},error->{if(token==generation&&!call.ended)failure(error);});}
    private void prompt(String text){speak(text,()->commandCapture());}
    private void commandCapture(){int token=generation;JSONObject config=TelephonyRuntime.json("finish","silence","silenceSeconds",owner.settings().optDouble("silenceSeconds",4));audio.capture(config,text->{if(token==generation)spokenChoice(text);},error->{if(token==generation)failure(error);});}
    void start(){ask("phone.speech.ready",request(),value->{if(!value.optBoolean("ready")){failure(new IllegalStateException(value.optString("error","Set up speech in LocalAI before calling")));return;}if(call.backend==null)backendMenu();else if(call.eventId!=null){JSONObject event=owner.event(call.eventId);if(event!=null){sessionId=event.optString("sessionId");nativeSessionId=event.optString("nativeSessionId","");targetEvent=event;eventPrompt(event);return;}chatMenu();}else chatMenu();});}
    private void backendMenu(){backendDigits="";transition("backends");ask("phone.backends",request(),value->{choices.clear();JSONArray list=value.optJSONArray("backends");StringBuilder text=new StringBuilder("Choose a backend. ");if(list!=null)for(int i=0;i<list.length();i++){JSONObject backend=list.optJSONObject(i);if(backend==null)continue;String digit=String.valueOf(i+1);choices.put(digit,backend);text.append("Say ").append(digit).append(" for ").append(backend.optString("name")).append(". ");}if(choices.isEmpty())text.append("No backends are connected to this phone.");else if(choices.size()>9)text.insert(0,"Enter the backend number followed by hash, or say its number after the beep. ");prompt(text.toString());});}
    private void chatMenu(){transition("chats");targetEvent=null;sessionId="";draft="";hasStopGeneration=false;lateConfirmed=false;listening=false;ask("phone.chats",request("recent",owner.settings().optInt("recent",5)),value->{choices.clear();StringBuilder text=new StringBuilder("Press or say 0 to start a new chat. ");JSONArray list=value.optJSONArray("chats");if(list!=null)for(int i=0;i<list.length();i++){JSONObject chat=list.optJSONObject(i);if(chat==null)continue;String key=String.valueOf(i+1);choices.put(key,chat);text.append("Press or say ").append(key).append(" for ").append(title(chat)).append(chat.optBoolean("running")?", working. ":", finished. ");}long unread=0;JSONArray items=owner.mailboxItems(call.backend);for(int i=0;i<items.length();i++)if(!items.optJSONObject(i).optBoolean("played"))unread++;if(unread>0)text.append("You have ").append(unread).append(" unread voicemail messages. ");text.append("Press star for voicemail.");prompt(text.toString());});}
    private static String title(JSONObject value){String project=value.optString("projectTitle");return (project.isBlank()?"":project+", ")+value.optString("title","Chat");}
    private void chatActions(){if(!pending.isEmpty()){JSONObject event=pending.poll();if(!event.optString("kind").equals("question")||event.optLong("expiresAt",Long.MAX_VALUE)>=System.currentTimeMillis()){eventPrompt(event);return;}}transition("actions");prompt("Press or say 1 to send a message, 2 to read the last final message, or 3 to stream live. Press star for voicemail.");}
    private void newChat(){hasStopGeneration=false;draft="";transition("new");ask("phone.new",request("mode",owner.settings().optString("callDefault","calls"),"creationId",call.id),value->{sessionId=value.optString("sessionId");if(sessionId.isBlank()){failure(new IllegalStateException("Backend did not create a chat"));return;}capture("replace");});}
    private void capture(String mode){if(hasStopGeneration){captureReady(mode);return;}transition("preparing-capture");ask("phone.begin",request(),result->{stopGeneration=result.optLong("stopGeneration");hasStopGeneration=true;nativeSessionId=result.isNull("nativeSessionId")?"":result.optString("nativeSessionId","");captureReady(mode);});}
    private void captureReady(String mode){transition("dictating");captureMode=mode;int token=generation;audio.capture(owner.settings(),text->{if(token!=generation)return;draft=mode.equals("append")&&!draft.isBlank()?draft+"\n"+text:text;submissionId=UUID.randomUUID().toString();review();},error->{if(token!=generation)return;owner.failed(error);if(!draft.isBlank())review();else chatActions();});}
    private void review(){transition("review");prompt(draft+". Press or say 1 to send, 2 to change, or 3 to add more.");}
    private void send(){if(draft.isBlank())return;transition("sending");JSONObject payload=request("text",draft,"deliveryId",submissionId,"source",targetEvent!=null&&targetEvent.optBoolean("played")?"voicemail":"call","lateConfirmed",lateConfirmed,"stopGeneration",stopGeneration);
        if(targetEvent!=null){TelephonyRuntime.put(payload,"eventId",targetEvent.optString("eventId"));TelephonyRuntime.put(payload,"questionId",targetEvent.optString("questionId"));TelephonyRuntime.put(payload,"revision",targetEvent.optInt("revision",1));}
        ask("phone.reply",payload,result->{if(result.optBoolean("requiresFollowupConfirmation")){lateConfirmed=true;transition("review");prompt("That question has already closed. This will be a new follow-up. "+draft+". Press 1 to send, 2 to change, or 3 to add more.");return;}
            if(!List.of("accepted","submitting").contains(result.optString("deliveryStatus"))){failure(new IllegalStateException("Submission is held. Review its delivery in the chat; it will not be sent again automatically."));return;}
            draft="";lateConfirmed=false;hasStopGeneration=false;if(targetEvent!=null){owner.finishEvent(targetEvent.optString("eventId"),"replied");owner.replied(targetEvent.optString("eventId"));}targetEvent=null;transition("actions");speak(result.optString("deliveryStatus").equals("submitting")?"Answer recorded. Delivery is pending.":"Message sent.",this::chatActions);
        });}
    private void readLast(){transition("reading");ask("phone.last",request(),result->{String text=result.optString("text");speak(text.isBlank()?"This chat has no final message yet.":text,this::chatActions);});}
    private void stream(){transition("live");listening=true;renewLive();ask("phone.live",request("enabled",true),value->speak("Live listening is on. Press 1 to send a message, 2 for the last final message, or star for voicemail.",this::drain));}
    private void renewLive(){ if(!listening||call.ended)return;owner.serial.schedule(()->{if(listening&&!call.ended){owner.gateway.request("phone.live",request("enabled",true));renewLive();}},20,java.util.concurrent.TimeUnit.SECONDS); }
    void live(JSONObject event){if(!listening||!Objects.equals(call.backend,event.optString("backendId"))||!sessionId.equals(event.optString("sessionId")))return;enqueue(event);}
    void enqueue(JSONObject event){if(spoken.contains(event.optString("entryId",event.optString("eventId"))))return;pending.add(event);if(state.equals("live"))drain();}
    private void drain(){if(!state.equals("live")||pending.isEmpty())return;JSONObject event=pending.poll();String id=event.optString("entryId",event.optString("eventId"));if(spoken.contains(id)){drain();return;}if(event.optString("kind").equals("question")&&event.optLong("expiresAt",Long.MAX_VALUE)<System.currentTimeMillis()){drain();return;}if(event.optString("kind").equals("question")){eventPrompt(event);return;}spoken.add(id);state="live-speaking";speak(event.optString("text"),()->{state="live";drain();});}
    private void eventPrompt(JSONObject event){if(targetEvent==null||!targetEvent.optString("eventId").equals(event.optString("eventId"))){draft="";hasStopGeneration=false;lateConfirmed=false;}sessionId=event.optString("sessionId");nativeSessionId=event.optString("nativeSessionId","");targetEvent=event;transition("event");if(event.optString("kind").equals("question")){choices.clear();JSONArray options=event.optJSONArray("options");StringBuilder text=new StringBuilder(title(event)+". "+event.optString("text")+". ");if(options!=null)for(int i=0;i<options.length()&&i<9;i++){String key=String.valueOf(i+1);choices.put(key,TelephonyRuntime.json("text",options.optString(i)));text.append("Press or say ").append(key).append(" for ").append(options.optString(i)).append(". ");}text.append("Press or say 0 to dictate your own answer.");state="question";prompt(text.toString());return;}spoken.add(event.optString("entryId",event.optString("eventId")));prompt(title(event)+". "+event.optString("text")+". Press 1 to reply, 2 for the last final message, or 3 to stream live.");}
    private void voicemail(){transition("mailbox");listening=false;JSONObject backend=owner.backend(call.backend);prompt("Voicemail. Press or say 1 to listen, 2 to turn call diversion "+(backend.optBoolean("divert")?"off":"on")+", or hash to return.");}
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
        if(state.equals("mailbox")){switch(value){case "1"->listenMailbox();case "2"->{owner.divert(call.backend,!owner.backend(call.backend).optBoolean("divert"));voicemail();}case "#"->chatMenu();}return;}
        if(state.equals("mail-item")){switch(value){case "1"->capture("replace");case "2"->{mailboxIndex++;mailItem();}case "#"->voicemail();}return;}
        if(List.of("actions","event","reading","live","live-speaking").contains(state)){switch(value){case "1"->{listening=false;capture("replace");}case "2"->readLast();case "3"->stream();}}
    }
    private void spokenChoice(String text){if(text.contains("\"")||text.contains("“")||text.contains("”")||text.toLowerCase(Locale.ROOT).matches(".*\\b(don.t|do not|not|never|cancel)\\b.*")){prompt("No selection made. Please choose an announced option.");return;}String normalized=text.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}0-9 ]"," ").trim();List<String> words=Arrays.asList(normalized.split("\\s+"));words=words.subList(0,Math.min(10,words.size()));
        if(words.stream().anyMatch(Set.of("no","not","never","don't","dont","cancel","quote","quoted")::contains)){prompt("No selection made. Please choose an announced option.");return;}
        Set<String> candidates=new HashSet<>();Map<String,String> numbers=Map.ofEntries(Map.entry("zero","0"),Map.entry("one","1"),Map.entry("two","2"),Map.entry("three","3"),Map.entry("four","4"),Map.entry("five","5"),Map.entry("six","6"),Map.entry("seven","7"),Map.entry("eight","8"),Map.entry("nine","9"));
        for(String word:words){if(word.matches("[0-9]+"))candidates.add(word);if(numbers.containsKey(word))candidates.add(numbers.get(word));}
        if(words.contains("star")||words.contains("voicemail"))candidates.add("*");if(words.contains("hash")||words.contains("return"))candidates.add("#");
        if(state.equals("review")){if(words.contains("send"))candidates.add("1");if(words.contains("change")||words.contains("edit"))candidates.add("2");if(words.contains("append")||normalized.contains("add more"))candidates.add("3");}
        if(state.equals("actions")){if(normalized.equals("send a message"))candidates.add("1");if(normalized.equals("read last final")||normalized.equals("read last message"))candidates.add("2");if(normalized.equals("stream live"))candidates.add("3");}
        if(candidates.size()!=1){prompt("No clear selection. Please choose an announced option.");return;}String selected=candidates.iterator().next();if(selected.equals("*")){if(call.backend!=null)voicemail();}else choose(selected);
    }
    private void failure(Throwable error){owner.failed(error);transition("failed"); /* Remains hangup/keypad-responsive; no alternate speech engine or blind retry. */ }
    void withdraw(String backend,String session){if(!Objects.equals(call.backend,backend))return;if(session==null||session.equals(sessionId)){draft="";targetEvent=null;pending.clear();transition("withdrawn");}}
    void resolved(String eventId,String status){
        pending.removeIf(item -> eventId.equals(item.optString("eventId")));
        if(targetEvent==null||!eventId.equals(targetEvent.optString("eventId")))return;
        TelephonyRuntime.put(targetEvent,"questionStatus",status);
        if(state.equals("question")){transition("event");prompt("That question is "+status+". Press 1 to send a new follow-up, 2 for the last final message, or 3 to stream live.");}
    }
    void audioRoute(CallAudioState state){audio.route(state);}
    @Override public void close(){transition("closed");audio.close();draft="";for(JSONObject event:pending)if(event.optString("route").equals("calls"))owner.mailbox(event.optString("eventId"));pending.clear();if(owner.gateway!=null&&listening)owner.gateway.request("phone.live",request("enabled",false));}
}
