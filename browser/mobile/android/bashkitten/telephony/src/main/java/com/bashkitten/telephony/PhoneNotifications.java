// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.telephony;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import org.json.JSONObject;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

final class PhoneNotifications {
    static final String CHANNEL = "bashkitten-messages", INPUT = "reply";
    static void post(TelephonyRuntime owner, JSONObject event) {
        Context context = owner.context;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            throw new IllegalStateException("Allow notifications to receive replyable agent messages");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL,"Agent messages",NotificationManager.IMPORTANCE_DEFAULT));
        String id = event.optString("eventId"), session = event.optString("sessionId"), backend = event.optString("backendId");
        Person sender = new Person.Builder().setName(owner.label(backend)).setKey(backend).build();
        String title = event.optString("projectTitle"); if (!title.isBlank()) title += " · "; title += event.optString("title", "Chat");
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(new Person.Builder().setName("You").build())
            .setConversationTitle(title).addMessage(event.optString("text"), event.optLong("createdAt",System.currentTimeMillis()), sender);
        PendingIntent reply = action(context,id,"reply",true), read = action(context,id,"read",false);
        RemoteInput input = new RemoteInput.Builder(INPUT).setLabel("Reply").build();
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(0,"Reply",reply).addRemoteInput(input)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY).setShowsUserInterface(false).build();
        NotificationCompat.Action readAction = new NotificationCompat.Action.Builder(0,"Mark read",read)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ).setShowsUserInterface(false).build();
        Notification notification = new NotificationCompat.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.sym_action_chat)
            .setCategory(Notification.CATEGORY_MESSAGE).setStyle(style).setContentTitle(title)
            .setGroup("bashkitten-chat:"+backend+":"+session).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).addAction(replyAction).addAction(readAction).build();
        manager.notify(CHANNEL+":"+id,0,notification);
    }
    private static PendingIntent action(Context context,String id,String action,boolean mutable) {
        Intent intent = new Intent(context,PhoneReplyReceiver.class).setAction(action)
            .setData(new Uri.Builder().scheme("bashkitten-phone").authority(action).appendPath(id).build());
        return PendingIntent.getBroadcast(context,0,intent,PendingIntent.FLAG_UPDATE_CURRENT | (mutable ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE));
    }
    static void cancel(Context context,String id) { context.getSystemService(NotificationManager.class).cancel(CHANNEL+":"+id,0); }
    static void clear(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications())
            if (notification.getTag() != null && notification.getTag().startsWith(CHANNEL+":")) manager.cancel(notification.getTag(),notification.getId());
    }
}
