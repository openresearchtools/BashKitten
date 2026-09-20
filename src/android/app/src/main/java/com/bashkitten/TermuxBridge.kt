package com.bashkitten

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Uses Termux's existing result protocol through the suite signature permission. */
object TermuxBridge {
    private val callbacks = ConcurrentHashMap<String, (Result<JSONObject>) -> Unit>()
    private val main = Handler(Looper.getMainLooper())
    const val prefix = "/data/data/com.termux/files/usr"

    fun trusted(context: Context): Boolean = context.packageManager.checkSignatures(context.packageName, "com.termux") == PackageManager.SIGNATURE_MATCH

    fun command(context: Context, command: String, args: JSONObject = JSONObject(), callback: (Result<JSONObject>) -> Unit) {
        execute(context, "$prefix/bin/bashkittenctl", arrayOf(command, args.toString()), null, callback)
    }

    fun execute(context: Context, path: String, args: Array<String>, stdin: String?, callback: (Result<JSONObject>) -> Unit) {
        if (!trusted(context)) return callback(Result.failure(IllegalStateException("Install the suite-signed Termux before starting services. Back up an existing installation before changing its certificate.")))
        val id = UUID.randomUUID().toString()
        callbacks[id] = callback
        val result = Intent(context, CommandResultReceiver::class.java).setAction("com.bashkitten.RESULT.$id").putExtra("requestId", id)
        val pending = PendingIntent.getBroadcast(context, id.hashCode(), result, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_ONE_SHOT)
        val intent = Intent("com.termux.RUN_COMMAND").setComponent(ComponentName("com.termux", "com.termux.app.SuiteRunCommandService"))
            .putExtra("com.termux.RUN_COMMAND_PATH", path)
            .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", args)
            .putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            .putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
            .putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pending)
        if (stdin != null) intent.putExtra("com.termux.RUN_COMMAND_STDIN", stdin)
        try {
            context.startForegroundService(intent)
            main.postDelayed({ callbacks.remove(id)?.invoke(Result.failure(IllegalStateException("Termux did not return a result. Open Apps to retry."))); pending.cancel() }, 45000)
        } catch (error: Exception) {
            pending.cancel(); callbacks.remove(id)?.invoke(Result.failure(error))
        }
    }

    fun receive(intent: Intent) {
        val id = intent.getStringExtra("requestId") ?: return
        val callback = callbacks.remove(id) ?: return
        val bundle = intent.getBundleExtra("result")
        if (bundle == null) return callback(Result.failure(IllegalStateException("Termux returned no result")))
        val error = bundle.getString("errmsg").orEmpty()
        val stdout = bundle.getString("stdout").orEmpty()
        val stderr = bundle.getString("stderr").orEmpty()
        if (bundle.getInt("err") != 0 || bundle.getInt("exitCode") != 0) {
            callback(Result.failure(IllegalStateException(error.ifEmpty { stderr.ifEmpty { "Termux command failed" } }.take(1200))))
        } else {
            callback(runCatching { if (stdout.isBlank()) JSONObject() else JSONObject(stdout) })
        }
    }
}

class CommandResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = TermuxBridge.receive(intent)
}
