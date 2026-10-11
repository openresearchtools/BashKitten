// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.media.*;
import android.telecom.CallAudioState;
import java.io.*;
import java.nio.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.json.JSONObject;

/** PCM stays in transient memory. LocalAI and VAD work off the audio/UI callback. */
final class CallAudio implements AutoCloseable {
    private final TelephonyRuntime owner;
    private final String callId;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService vadWork = Executors.newSingleThreadExecutor();
    private final ExecutorService routes = Executors.newSingleThreadExecutor();
    private final AudioManager audio;
    private volatile AudioRecord recorder;
    private volatile AudioTrack player;
    private volatile boolean muted, finish;
    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile String requestId;
    private volatile String cancelledRequestId;
    private volatile int generation;
    CallAudio(TelephonyRuntime owner,String callId) { this.owner = owner; this.callId = callId; audio = owner.context.getSystemService(AudioManager.class); }
    void route(CallAudioState state) {
        muted = state.isMuted();
        routes.execute(() -> {
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            int type = switch(state.getRoute()) {
                case CallAudioState.ROUTE_SPEAKER -> AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
                case CallAudioState.ROUTE_BLUETOOTH -> AudioDeviceInfo.TYPE_BLUETOOTH_SCO;
                case CallAudioState.ROUTE_WIRED_HEADSET -> AudioDeviceInfo.TYPE_WIRED_HEADSET;
                default -> AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            };
            for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) if (device.getType() == type) { audio.setCommunicationDevice(device); break; }
        });
    }
    synchronized void cancel() {
        generation++; finish = true;
        if (requestId != null) { cancelledRequestId = requestId; if(owner.gateway != null)owner.gateway.cancel(requestId); }
        AudioRecord input = recorder; if (input != null) try { input.stop(); } catch (RuntimeException ignored) { }
        AudioTrack output = player; if (output != null) try { output.pause(); output.flush(); } catch (RuntimeException ignored) { }
    }
    void hash() { finish = true; AudioRecord input = recorder; if (input != null) try { input.stop(); } catch (RuntimeException ignored) { } }
    synchronized int ticket() { return generation; }
    boolean current(int ticket) { return !closed.get() && generation == ticket; }
    void speak(String text, Runnable done, Consumer<Throwable> failure) {
        int ticket = ticket(); String id = UUID.randomUUID().toString(); requestId = id;
        owner.gateway.audio("phone.speech.synthesize",new byte[0],TelephonyRuntime.json("text",text,"requestId",id,"callId",callId,"cancelledRequestId",cancelledRequestId)).whenComplete((wav,error) -> {
            if (error != null) { if(current(ticket)) owner.execute(() -> failure.accept(error)); return; }
            if(!current(ticket)){Arrays.fill(wav,(byte)0);return;}
            io.execute(() -> {
                try { if(current(ticket)) play(wav,ticket); if(current(ticket)) owner.execute(done); }
                catch (Throwable failed) { if(current(ticket)) owner.execute(() -> failure.accept(failed)); }
                finally { Arrays.fill(wav,(byte)0); }
            });
        });
    }
    private void play(byte[] wav,int ticket) throws IOException {
        ByteBuffer bytes = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
        if(wav.length<44 || bytes.getInt(0)!=0x46464952 || bytes.getInt(8)!=0x45564157) throw new IOException("LocalAI returned invalid WAV");
        int channels=0,rate=0,bits=0,format=0,start=-1,length=0;
        for(int offset=12; offset+8<=wav.length;) {
            int tag=bytes.getInt(offset), size=bytes.getInt(offset+4);
            if(size<0 || offset+8L+size>wav.length) throw new IOException("Truncated LocalAI WAV");
            if(tag==0x20746d66 && size>=16) { format=bytes.getShort(offset+8); channels=bytes.getShort(offset+10); rate=bytes.getInt(offset+12); bits=bytes.getShort(offset+22); }
            if(tag==0x61746164) { start=offset+8; length=size; }
            offset+=8+size+(size&1);
        }
        if(format!=1 || (channels!=1 && channels!=2) || bits!=16 || rate<=0 || start<0) throw new IOException("LocalAI call playback requires PCM16 WAV");
        int mask=channels==1?AudioFormat.CHANNEL_OUT_MONO:AudioFormat.CHANNEL_OUT_STEREO;
        AudioTrack output=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setAudioFormat(new AudioFormat.Builder().setSampleRate(rate).setChannelMask(mask).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
            .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(Math.max(AudioTrack.getMinBufferSize(rate,mask,AudioFormat.ENCODING_PCM_16BIT),4096)).build();
        player=output;
        try {
            output.play(); int written=0;
            while(written<length && current(ticket)) { int count=output.write(wav,start+written,Math.min(4096,length-written)); if(count<0)throw new IOException("Call audio output failed"); written+=count; }
            int frames=written/(channels*2);
            while(current(ticket) && output.getPlaybackHeadPosition()<frames) { try { Thread.sleep(10); } catch(InterruptedException e) { Thread.currentThread().interrupt(); break; } }
        } finally { player=null; output.release(); }
    }
    void capture(JSONObject settings,Consumer<String> complete,Consumer<Throwable> failure) {
        int ticket=ticket(); finish=false; String id=UUID.randomUUID().toString(); requestId=id;
        io.execute(() -> {
            byte[] wav=null; WipingBytes pcm=new WipingBytes();
            AudioRecord input=null; byte[] frame=new byte[1024];
            BlockingQueue<byte[]> frames=new LinkedBlockingQueue<>(); AtomicBoolean captured=new AtomicBoolean();
            CompletableFuture<Boolean> detection=null;
            try {
                audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
                ToneGenerator beep=new ToneGenerator(AudioManager.STREAM_VOICE_CALL,25);
                try { beep.startTone(ToneGenerator.TONE_PROP_BEEP,120); Thread.sleep(160); } finally { beep.release(); }
                if(!current(ticket))return;
                owner.gateway.request("phone.speech.vad.open",TelephonyRuntime.json("captureId",id)).get();
                int min=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
                input=new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(4096,min)); recorder=input;
                if(input.getState()!=AudioRecord.STATE_INITIALIZED)throw new IOException("Call microphone is unavailable");
                detection=CompletableFuture.supplyAsync(()->{
                    boolean speech=false; long sequence=0,lastSpeechFrame=0;
                    try {
                        while(current(ticket)&&(!captured.get()||!frames.isEmpty())) {
                            byte[] samples=frames.poll(100,TimeUnit.MILLISECONDS); if(samples==null)continue;
                            byte[] result=null;
                            try {
                                result=owner.gateway.audio("phone.speech.vad.frame",samples,TelephonyRuntime.json("captureId",id,"sequence",++sequence)).get();
                                JSONObject vad=new JSONObject(new String(result,java.nio.charset.StandardCharsets.UTF_8));
                                if(vad.getDouble("probability")>=0.5){speech=true;lastSpeechFrame=sequence;}
                                // Measure captured audio time, not slow-model or scheduler wall time.
                                if(speech&&!settings.optString("finish","either").equals("hash")&&(sequence-lastSpeechFrame)*512.0/16000>=settings.optDouble("silenceSeconds",4))hash();
                            } finally { Arrays.fill(samples,(byte)0);if(result!=null)Arrays.fill(result,(byte)0); }
                        }
                        return speech;
                    } catch(Exception error) { hash();throw new CompletionException(error); }
                },vadWork);
                input.startRecording();int offset=0;
                while(current(ticket) && !finish) {
                    int count=input.read(frame,offset,frame.length-offset);
                    if(count<0){if(finish)break;throw new IOException("Call microphone stopped");} if(count==0)continue;
                    offset+=count;if(offset<frame.length)continue;offset=0;
                    if(muted)Arrays.fill(frame,(byte)0);
                    pcm.write(frame);frames.add(frame.clone());
                }
                captured.set(true);
                boolean speech=detection.get();
                Arrays.fill(frame,(byte)0);input.stop();recorder=null;input.release();input=null;
                if(!current(ticket))return;
                if(!speech)throw new IOException("No speech detected. Try again after the beep.");
                byte[] raw=pcm.toByteArray();wav=wav(raw);Arrays.fill(raw,(byte)0);pcm.wipe();
                byte[] result=owner.gateway.audio("phone.speech.transcribe",wav,TelephonyRuntime.json("requestId",id)).get();
                String transcript;
                try{transcript=new JSONObject(new String(result,java.nio.charset.StandardCharsets.UTF_8)).optString("text").trim();}finally{Arrays.fill(result,(byte)0);}
                if(transcript.isBlank())throw new IOException("No speech transcript returned");
                if(current(ticket))owner.execute(() -> complete.accept(transcript));
            }catch(Throwable error){if(current(ticket))owner.execute(() -> failure.accept(error));}
            finally{
                captured.set(true);Arrays.fill(frame,(byte)0);byte[] queued;while((queued=frames.poll())!=null)Arrays.fill(queued,(byte)0);
                if(detection!=null&&!detection.isDone()&&owner.gateway!=null)owner.gateway.cancel(id);
                if(input!=null){try{input.stop();}catch(RuntimeException ignored){}input.release();}recorder=null;
                if(wav!=null)Arrays.fill(wav,(byte)0); byte[] remaining=pcm.toByteArray();Arrays.fill(remaining,(byte)0);pcm.wipe();
                if(owner.gateway!=null)owner.gateway.request("phone.speech.vad.close",TelephonyRuntime.json("captureId",id));
            }
        });
    }
    private static final class WipingBytes extends ByteArrayOutputStream {
        @Override public synchronized void write(byte[] bytes,int offset,int length){
            int needed=Math.addExact(count,length);
            if(needed>buf.length){byte[] old=buf;buf=Arrays.copyOf(old,Math.max(needed,Math.multiplyExact(old.length,2)));Arrays.fill(old,(byte)0);}
            System.arraycopy(bytes,offset,buf,count,length);count=needed;
        }
        void wipe(){Arrays.fill(buf,(byte)0);reset();}
    }
    private static byte[] wav(byte[] raw){
        ByteBuffer out=ByteBuffer.allocate(raw.length+44).order(ByteOrder.LITTLE_ENDIAN);
        out.putInt(0x46464952).putInt(raw.length+36).putInt(0x45564157).putInt(0x20746d66).putInt(16).putShort((short)1).putShort((short)1).putInt(16000).putInt(32000).putShort((short)2).putShort((short)16).putInt(0x61746164).putInt(raw.length).put(raw);return out.array();
    }
    @Override public void close(){closed.set(true);cancel();io.execute(() -> { audio.clearCommunicationDevice();audio.setMode(AudioManager.MODE_NORMAL); });io.shutdown();vadWork.shutdown();routes.shutdown();}
}
