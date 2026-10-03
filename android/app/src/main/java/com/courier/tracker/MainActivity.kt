package com.courier.tracker

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Patterns
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    companion object {
        const val PREFS = "tracker_prefs"
        const val KEY_CONSENT = "consent_given"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_TOKEN = "activation_code"
        const val KEY_ACTIVE = "tracking_on"
    }

    private lateinit var prefs: SharedPreferences
    private lateinit var consentView: View
    private lateinit var setupView: View
    private lateinit var statusView: View
    private lateinit var urlInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var statusState: TextView
    private lateinit var statusDetail: TextView

    private val fineLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) requestOptionalPermissions() else {
            Toast.makeText(this, "Location permission is required", Toast.LENGTH_LONG).show()
            openAppSettings()
        }
    }
    private val notifLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { requestBackgroundPermission() }
    private val bgLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { startTracking() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        consentView = findViewById(R.id.consent_view)
        setupView = findViewById(R.id.setup_view)
        statusView = findViewById(R.id.status_view)
        urlInput = findViewById(R.id.server_url_input)
        tokenInput = findViewById(R.id.token_input)
        statusState = findViewById(R.id.status_state)
        statusDetail = findViewById(R.id.status_detail)

        findViewById<Button>(R.id.accept_button).setOnClickListener {
            prefs.edit().putBoolean(KEY_CONSENT, true).apply()
            showSetup()
        }
        findViewById<Button>(R.id.decline_button).setOnClickListener { finishAffinity() }
        findViewById<Button>(R.id.start_button).setOnClickListener { onStartClicked() }
        findViewById<Button>(R.id.battery_button).setOnClickListener { requestBatteryExemption() }

        when {
            !prefs.getBoolean(KEY_CONSENT, false) -> showConsent()
            prefs.getString(KEY_SERVER_URL, null).isNullOrBlank() -> showSetup()
            else -> showStatus()
        }
    }

    private fun showConsent() {
        consentView.visibility = View.VISIBLE
        setupView.visibility = View.GONE
        statusView.visibility = View.GONE
    }

    private fun showSetup() {
        consentView.visibility = View.GONE
        setupView.visibility = View.VISIBLE
        statusView.visibility = View.GONE
    }

    private fun showStatus() {
        consentView.visibility = View.GONE
        setupView.visibility = View.GONE
        statusView.visibility = View.VISIBLE

        val url = prefs.getString(KEY_SERVER_URL, "") ?: ""
        statusDetail.text = getString(R.string.status_detail_fmt, url)

        statusState.text = if (TrackingService.isRunning)
            getString(R.string.status_active)
        else if (prefs.getBoolean(KEY_ACTIVE, false))
            getString(R.string.status_connecting)
        else
            getString(R.string.status_not_started)
    }

    override fun onResume() {
        super.onResume()
        if (prefs.getBoolean(KEY_CONSENT, false) &&
            !prefs.getString(KEY_SERVER_URL, null).isNullOrBlank()
        ) showStatus()
    }

    private fun onStartClicked() {
        var url = urlInput.text.toString().trim().trimEnd('/')
        val token = tokenInput.text.toString().trim()
        if (url.isEmpty() || token.isEmpty()) {
            Toast.makeText(this, R.string.fill_both_fields, Toast.LENGTH_SHORT).show()
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://$url"
        }
        if (!Patterns.WEB_URL.matcher(url).matches()) {
            Toast.makeText(this, R.string.invalid_server_url, Toast.LENGTH_LONG).show()
            return
        }
        prefs.edit()
            .putString(KEY_SERVER_URL, url)
            .putString(KEY_TOKEN, token)
            .putBoolean(KEY_ACTIVE, false)
            .apply()
        requestFineLocation()
    }

    private fun requestFineLocation() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED
        ) {
            requestOptionalPermissions()
        } else {
            fineLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    private fun requestOptionalPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        requestBackgroundPermission()
    }

    private fun requestBackgroundPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            bgLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            if (prefs.getBoolean("bg_hint_shown", false) == false) {
                prefs.edit().putBoolean("bg_hint_shown", true).apply()
                Toast.makeText(
                    this,
                    "For continuous tracking choose 'Allow all the time' for location",
                    Toast.LENGTH_LONG
                ).show()
            }
            return
        }
        startTracking()
    }

    private fun startTracking() {
        val i = Intent(this, TrackingService::class.java)
        ContextCompat.startForegroundService(this, i)
        prefs.edit().putBoolean(KEY_ACTIVE, true).apply()
        requestBatteryExemption()
        showStatus()
    }

    private fun requestBatteryExemption() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            try {
                @Suppress("BatteryLife")
                startActivity(
                    Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:$packageName")
                    )
                )
            } catch (e: Exception) {
                // Some devices don't support the dialog; user can set it manually.
            }
        }
    }

    private fun openAppSettings() {
        try {
            startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:$packageName")
                )
            )
        } catch (e: Exception) {
        }
    }
}
