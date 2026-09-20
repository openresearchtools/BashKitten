package com.bashkitten

import android.app.PendingIntent
import android.app.Activity
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

/** One result protocol for our protected service and upstream's user-granted service. */
object TermuxBridge {
    private val callbacks = ConcurrentHashMap<String, (Result<JSONObject>) -> Unit>()
    private val main = Handler(Looper.getMainLooper())
    const val prefix = "/data/data/com.termux/files/usr"
    const val permission = "com.termux.permission.RUN_COMMAND"
    const val connectCommand = "mkdir -p ~/.termux && printf '\\nallow-external-apps=true\\n' >> ~/.termux/termux.properties && termux-reload-settings"

    fun trusted(context: Context): Boolean = context.packageManager.checkSignatures(context.packageName, "com.termux") == PackageManager.SIGNATURE_MATCH
    fun available(context: Context): Boolean = AppStore.installed(context, "com.termux") != null &&
        (trusted(context) || context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED)
    private fun component(context: Context) = ComponentName("com.termux", if (trusted(context)) "com.termux.app.SuiteRunCommandService" else "com.termux.app.RunCommandService")
    fun probe(context: Context, callback: (Result<JSONObject>) -> Unit) {
        val script = "if [ -x '$prefix/bin/bashkittenctl' ]; then printf '{\"connected\":true,\"packages\":true}'; else printf '{\"connected\":true,\"packages\":false}'; fi"
        execute(context, "$prefix/bin/bash", arrayOf("-c", script), null, 15000, callback)
    }

    fun ensureManager(context: Context) {
        // The long-lived task belongs to Termux's foreground service, not this Activity.
        val script = "if [ -x '$prefix/bin/bashkitten-suite-manager' ]; then exec '$prefix/bin/bashkitten-suite-manager'; fi"
        runCatching { task(context, "$prefix/bin/bash", arrayOf("-c", script)) }
    }
    fun bootstrap(context: Context, sha256: String) {
        require(sha256.matches(Regex("[a-f0-9]{64}")))
        val script = context.assets.open("bootstrap.sh").bufferedReader().use { it.readText() }
        task(context, "$prefix/bin/bash", arrayOf("-c", script, "bashkitten-bootstrap", sha256, if (trusted(context)) "suite" else "external"))
    }
    private fun task(context: Context, path: String, args: Array<String>) {
        check(available(context)) { "Connect to Termux in Apps first" }
        val intent = Intent("com.termux.RUN_COMMAND").setComponent(component(context))
            .putExtra("com.termux.RUN_COMMAND_PATH", path)
            .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", args)
            .putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            .putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
        context.startForegroundService(intent)
    }
    fun bootstrapStatus(context: Context, callback: (Result<JSONObject>) -> Unit) {
        val script = """
            dir="${'$'}HOME/.local/share/bashkitten-pi/bootstrap"
            state=${'$'}(cat "${'$'}dir/status.json" 2>/dev/null || printf '{}')
            if [ -f "${'$'}dir/lock" ] && flock -n "${'$'}dir/lock" true; then
                case "${'$'}state" in *'"status":"running"'*) state='{"status":"interrupted","phase":"Setup interrupted. Resume to continue."}';; esac
            fi
            log=${'$'}(tail -c 24000 "${'$'}dir/output.log" 2>/dev/null | base64 | tr -d '\n')
            printf '{"bootstrap":%s,"logBase64":"%s"}\n' "${'$'}state" "${'$'}log"
        """.trimIndent()
        execute(context, "$prefix/bin/bash", arrayOf("-c", script), null, callback = callback)
    }

    fun command(context: Context, command: String, args: JSONObject = JSONObject(), callback: (Result<JSONObject>) -> Unit) {
        // Bootstrap may still be preparing packages; avoid Termux's missing-executable dialog.
        val script = "export BASHKITTEN_NO_AUTOSTART=1; if [ -x '$prefix/bin/bashkittenctl' ]; then exec '$prefix/bin/bashkittenctl' \"\$@\"; else printf 'BashKitten packages are not installed yet' >&2; exit 1; fi"
        execute(context, "$prefix/bin/bash", arrayOf("-c", script, "bashkitten-control", command, args.toString()), null, callback = callback)
    }

    fun execute(context: Context, path: String, args: Array<String>, stdin: String?, timeoutMillis: Long = 45000, callback: (Result<JSONObject>) -> Unit) {
        if (!available(context)) return callback(Result.failure(IllegalStateException("Allow BashKitten’s Termux command permission, then connect in Apps.")))
        val id = UUID.randomUUID().toString()
        callbacks[id] = callback
        val result = Intent(context, CommandResultReceiver::class.java).setAction("com.bashkitten.RESULT.$id").putExtra("requestId", id)
        val pending = PendingIntent.getBroadcast(context, id.hashCode(), result, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_ONE_SHOT)
        val intent = Intent("com.termux.RUN_COMMAND").setComponent(component(context))
            .putExtra("com.termux.RUN_COMMAND_PATH", path)
            .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", args)
            .putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            .putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
            .putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pending)
        if (stdin != null) intent.putExtra("com.termux.RUN_COMMAND_STDIN", stdin)
        try {
            context.startForegroundService(intent)
            main.postDelayed({ callbacks.remove(id)?.invoke(Result.failure(IllegalStateException("Termux did not return a result. Open Apps to retry."))); pending.cancel() }, timeoutMillis)
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
        // Upstream ResultData uses Activity.RESULT_OK (-1), independently of shell exitCode.
        if (bundle.getInt("err", 0) != Activity.RESULT_OK || bundle.getInt("exitCode", -1) != 0) {
            val message = runCatching { JSONObject(stderr).optString("error") }.getOrNull().orEmpty()
            callback(Result.failure(IllegalStateException(error.ifEmpty { message.ifEmpty { stderr.ifEmpty { "Termux command failed" } } }.take(1200))))
        } else {
            callback(runCatching { if (stdout.isBlank()) JSONObject() else JSONObject(stdout) })
        }
    }
}

class CommandResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = TermuxBridge.receive(intent)
}
