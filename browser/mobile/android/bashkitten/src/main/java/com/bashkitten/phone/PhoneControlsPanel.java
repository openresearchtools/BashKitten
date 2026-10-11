// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.provider.Settings;
import android.view.View;
import android.widget.*;

/** Native-only policy controls. No CLI command can change these settings. */
public final class PhoneControlsPanel {
    private static final class Binding {final Activity activity;final PhonePolicy policy;final LinearLayout root;Binding(Activity a,PhonePolicy p,LinearLayout r){activity=a;policy=p;root=r;}}
    public static View build(Activity activity){
        PhonePolicy policy=PhoneControlsRuntime.get(activity).policy;LinearLayout root=new LinearLayout(activity);root.setOrientation(LinearLayout.VERTICAL);root.setTag(new Binding(activity,policy,root));Runnable update=()->refresh(root);
        android.view.ViewTreeObserver.OnWindowFocusChangeListener focus=focused->{if(focused)refresh(root);};
        root.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){public void onViewAttachedToWindow(View view){policy.observe(update);root.getViewTreeObserver().addOnWindowFocusChangeListener(focus);refresh(root);}public void onViewDetachedFromWindow(View view){policy.unobserve(update);if(root.getViewTreeObserver().isAlive())root.getViewTreeObserver().removeOnWindowFocusChangeListener(focus);}});
        refresh(root);return root;
    }
    public static void refresh(View view){if(!(view.getTag() instanceof Binding))return;Binding b=(Binding)view.getTag();b.root.removeAllViews();
        TextView heading=new TextView(b.activity);heading.setText("Phone controls");heading.setTextSize(18);b.root.addView(heading);
        Switch master=new Switch(b.activity);master.setText("Phone controls");master.setChecked(b.policy.master());master.setOnCheckedChangeListener((button,value)->{b.policy.setMaster(value);refresh(view);});b.root.addView(master);
        TextView connection=new TextView(b.activity);connection.setText(!b.policy.master()?"Off":PhoneControlsRuntime.get(b.activity).connected()?"Local Agent connected":"Waiting for the local Agent connection");b.root.addView(connection);
        for(PhonePolicy.Feature feature:PhonePolicy.Feature.values()){
            if(feature==PhonePolicy.Feature.SCREEN){View divider=new View(b.activity);divider.setBackgroundColor(0xff777777);b.root.addView(divider,new LinearLayout.LayoutParams(-1,1));TextView label=new TextView(b.activity);label.setText("Optional Accessibility controls");b.root.addView(label);Button permission=new Button(b.activity);permission.setText("Accessibility settings");permission.setOnClickListener(v->b.activity.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));b.root.addView(permission);}
            Switch option=new Switch(b.activity);String unavailable=b.policy.unavailable(feature);option.setText(feature.label+(unavailable.isEmpty()?"":" — "+unavailable));option.setChecked(b.policy.selected(feature));option.setEnabled(b.policy.master()&&(!feature.accessibility||unavailable.isEmpty()));option.setOnCheckedChangeListener((button,value)->{b.policy.setSelected(feature,value);});b.root.addView(option);
            if(feature==PhonePolicy.Feature.NOTIFICATIONS){Button permission=new Button(b.activity);permission.setText("Notification access");permission.setOnClickListener(v->b.activity.startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));b.root.addView(permission);}
            if(feature==PhonePolicy.Feature.FILES){Button locations=new Button(b.activity);locations.setText("Granted file locations");locations.setOnClickListener(v->b.activity.startActivity(new Intent(b.activity,PhoneFilesActivity.class)));b.root.addView(locations);}
            if(feature==PhonePolicy.Feature.LOCATION){Button permission=new Button(b.activity);permission.setText("Allow precise location");permission.setOnClickListener(v->b.activity.requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.ACCESS_FINE_LOCATION},8612));b.root.addView(permission);}
        }
    }
}
