package com.courier.tracker

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat

class RestartReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val prefs = context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
        val url = BuildConfig.SERVER_URL.trimEnd('/')
        val token = prefs.getString(MainActivity.KEY_TOKEN, null) ?: return

        // Ask the server whether this device is active. Runs every ~60 s while
        // we're not reporting, so a dashboard re-activation / global resume
        // takes effect within about a minute.
        ApiClient.checkStatus(url, token) { code, active, hidden, _ ->
            MainActivity.applyIconHidden(context, hidden)
            if (code == 200 && active) {
                if (prefs.getBoolean(MainActivity.KEY_ACTIVE, false)) {
                    val svc = Intent(context, TrackingService::class.java)
                    ContextCompat.startForegroundService(context, svc)
                    cancelRetry(context) // actively tracking — no more polling
                } else {
                    // reactivated from the dashboard: flip local flag and start
                    prefs.edit().putBoolean(MainActivity.KEY_ACTIVE, true).apply()
                    val svc = Intent(context, TrackingService::class.java)
                    ContextCompat.startForegroundService(context, svc)
                    cancelRetry(context)
                }
            } else {
                // still deactivated/paused, server unreachable, or flag lagging:
                // keep the next check scheduled
                scheduleRetry(context)
            }
        }
    }

    companion object {
        const val ACTION_RETRY = "com.courier.tracker.RETRY"
        private const val RETRY_MS = 60 * 1000L

        fun scheduleRetry(context: Context) {
            val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pi = PendingIntent.getBroadcast(
                context, 0,
                Intent(context, RestartReceiver::class.java).setAction(ACTION_RETRY),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarm.canScheduleExactAlarms()) {
                alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + RETRY_MS, pi)
            } else {
                alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + RETRY_MS, pi)
            }
        }

        fun cancelRetry(context: Context) {
            val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pi = PendingIntent.getBroadcast(
                context, 0,
                Intent(context, RestartReceiver::class.java).setAction(ACTION_RETRY),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            alarm.cancel(pi)
        }
    }
}
