package com.courier.tracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class TrackingService : Service() {

    companion object {
        const val CHANNEL_ID = "tracking_channel"
        const val NOTIF_ID = 1001
        const val UPDATE_INTERVAL_MS = 60_000L
        @Volatile
        var isRunning = false
    }

    private lateinit var prefs: android.content.SharedPreferences
    private var fusedClient: FusedLocationProviderClient? = null
    private var callback: LocationCallback? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val serverUrl = BuildConfig.SERVER_URL.trimEnd('/')
        val token = prefs.getString(MainActivity.KEY_TOKEN, null)
        if (token.isNullOrBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForegroundCompat()
        isRunning = true
        requestLocationUpdates(serverUrl, token)
        return START_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Location tracking",
                NotificationManager.IMPORTANCE_LOW
            )
            channel.description = "Shows when location is being reported to your employer"
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setOngoing(true)
            .setContentIntent(pi)
            .build()
    }

    private fun startForegroundCompat() {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        else 0
        ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), type)
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun requestLocationUpdates(serverUrl: String, token: String) {
        callback?.let { fusedClient?.removeLocationUpdates(it) }
        val client = LocationServices.getFusedLocationProviderClient(this)
        fusedClient = client
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                sendLocation(serverUrl, token, loc)
            }
        }
        callback = cb
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, UPDATE_INTERVAL_MS)
            .setMinUpdateIntervalMillis(UPDATE_INTERVAL_MS)
            .build()
        client.requestLocationUpdates(request, cb, Looper.getMainLooper())
    }

    private fun sendLocation(serverUrl: String, token: String, location: Location) {
        val battery = try {
            val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        } catch (e: Exception) {
            -1
        }
        ApiClient.sendLocation(serverUrl, token, location, battery) { code, _ ->
            if (code != null && code == 403) {
                mainHandler.post { deactivateByServer() }
            }
        }
    }

    private fun deactivateByServer() {
        stopLocationUpdates()
        prefs.edit().putBoolean(MainActivity.KEY_ACTIVE, false).apply()
        isRunning = false
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        RestartReceiver.scheduleRetry(this)
    }

    private fun stopLocationUpdates() {
        callback?.let { cb -> fusedClient?.removeLocationUpdates(cb) }
        callback = null
        fusedClient = null
    }

    override fun onDestroy() {
        stopLocationUpdates()
        isRunning = false
        super.onDestroy()
    }
}
