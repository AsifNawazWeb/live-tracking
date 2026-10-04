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

        // Ask the server whether this device is still active.
        ApiClient.checkStatus(url, token) { code, _ ->
            if (code == 200) {
                val svc = Intent(context, TrackingService::class.java)
                ContextCompat.startForegroundService(context, svc)
            } else {
                scheduleRetry(context)
            }
        }
    }

    companion object {
        const val ACTION_RETRY = "com.courier.tracker.RETRY"
        private const val RETRY_MS = 15 * 60 * 1000L

        fun scheduleRetry(context: Context) {
            val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pi = PendingIntent.getBroadcast(
                context, 0,
                Intent(context, RestartReceiver::class.java).setAction(ACTION_RETRY),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            alarm.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + RETRY_MS,
                pi
            )
        }
    }
}
