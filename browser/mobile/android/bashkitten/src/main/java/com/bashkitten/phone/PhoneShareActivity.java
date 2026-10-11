// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;
import android.app.Activity;
import android.os.Bundle;
public final class PhoneShareActivity extends Activity {
    @Override public void onCreate(Bundle state){super.onCreate(state);PhoneFiles.receive(this,getIntent(),error->runOnUiThread(()->{if(error!=null)android.widget.Toast.makeText(this,error,android.widget.Toast.LENGTH_SHORT).show();finish();}));}
}
