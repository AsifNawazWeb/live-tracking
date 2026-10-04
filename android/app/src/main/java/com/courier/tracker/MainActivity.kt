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
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.checkbox.MaterialCheckBox
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout

class MainActivity : AppCompatActivity() {

    companion object {
        const val PREFS = "tracker_prefs"
        const val KEY_TOKEN = "activation_code"
        const val KEY_NAME = "employee_name"
        const val KEY_ACTIVE = "tracking_on"
        const val KEY_ICON_STATE = "icon_state" // 1 = hidden

        /**
         * Show/hide the launcher icon (dashboard-controlled). The icon is the
         * .LauncherAlias activity-alias; MainActivity stays enabled so the
         * tracking notification tap still opens the status screen.
         */
        fun applyIconHidden(context: Context, hidden: Boolean) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val alreadyHidden = prefs.getInt(KEY_ICON_STATE, 0) == 1
            if (hidden == alreadyHidden) return
            val pm = context.packageManager
            val alias = android.content.ComponentName(context, ".LauncherAlias")
            val state = if (hidden)
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            else
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            try {
                pm.setComponentEnabledSetting(
                    alias, state,
                    android.content.pm.PackageManager.DONT_KILL_APP
                )
                prefs.edit().putInt(KEY_ICON_STATE, if (hidden) 1 else 0).apply()
            } catch (e: Exception) {
            }
        }
    }

    private lateinit var prefs: SharedPreferences
    // UK National Insurance number: 2 valid prefix letters, 6 digits, 1 suffix letter
    private val niRegex = Regex("^[ABCEGHJ-NPRSTW-Z]{2}\\d{6}[A-D ]$")
    private val ukPhoneRegex = Regex("^(\\+44|0)\\d{9,10}$")
    private lateinit var registerView: View
    private lateinit var statusView: View
    private lateinit var tilName: TextInputLayout
    private lateinit var tilEmail: TextInputLayout
    private lateinit var tilNi: TextInputLayout
    private lateinit var tilPhone: TextInputLayout
    private lateinit var nameInput: TextInputEditText
    private lateinit var emailInput: TextInputEditText
    private lateinit var niInput: TextInputEditText
    private lateinit var phoneInput: TextInputEditText
    private lateinit var deviceInput: TextInputEditText
    private lateinit var consentCheckbox: MaterialCheckBox
    private lateinit var submitButton: Button
    private lateinit var errorText: TextView
    private lateinit var statusState: TextView
    private lateinit var statusDetail: TextView

    // UK National Insurance number: 2 valid prefix letters, 6 digits, 1 suffix letter
    private val NI_REGEX = Regex("^[ABCEGHJ-NPRSTW-Z]{2}\\d{6}[A-D ]$")

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

        registerView = findViewById(R.id.register_view)
        statusView = findViewById(R.id.status_view)
        tilName = findViewById(R.id.til_name)
        tilEmail = findViewById(R.id.til_email)
        tilNi = findViewById(R.id.til_ni)
        tilPhone = findViewById(R.id.til_phone)
        nameInput = findViewById(R.id.input_name)
        emailInput = findViewById(R.id.input_email)
        niInput = findViewById(R.id.input_ni)
        phoneInput = findViewById(R.id.input_phone)
        deviceInput = findViewById(R.id.input_device)
        consentCheckbox = findViewById(R.id.consent_checkbox)
        submitButton = findViewById(R.id.submit_button)
        errorText = findViewById(R.id.register_error)
        statusState = findViewById(R.id.status_state)
        statusDetail = findViewById(R.id.status_detail)

        // auto-filled device model, e.g. "Pixel 7"
        deviceInput.setText("${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}")

        // uppercase NI input as the user types
        niInput.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) {
                val text = s?.toString() ?: return
                val up = text.uppercase()
                if (text != up) {
                    niInput.setText(up)
                    niInput.setSelection(up.length)
                }
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        submitButton.setOnClickListener { onSubmitClicked() }
        findViewById<Button>(R.id.battery_button).setOnClickListener { requestBatteryExemption() }

        if (prefs.getString(KEY_TOKEN, null).isNullOrBlank()) {
            showRegister()
        } else {
            showStatus()
        }
    }

    override fun onResume() {
        super.onResume()
        if (!prefs.getString(KEY_TOKEN, null).isNullOrBlank()) {
            // safety net: if tracking should be on but the service was killed
            // (e.g. by the OS) without a server 403, restart it
            if (prefs.getBoolean(KEY_ACTIVE, false) && !TrackingService.isRunning) {
                startForegroundServiceSafe()
            }
            showStatus()
        }
    }

    private fun startForegroundServiceSafe() {
        val i = Intent(this, TrackingService::class.java)
        ContextCompat.startForegroundService(this, i)
    }

    private fun showRegister() {
        registerView.visibility = View.VISIBLE
        statusView.visibility = View.GONE
    }

    private fun showStatus() {
        registerView.visibility = View.GONE
        statusView.visibility = View.VISIBLE

        statusState.text = if (TrackingService.isRunning)
            getString(R.string.status_active)
        else if (prefs.getBoolean(KEY_ACTIVE, false))
            getString(R.string.status_connecting)
        else
            getString(R.string.status_not_started)
        statusDetail.text = getString(R.string.status_detail)
    }

    private fun onSubmitClicked() {
        clearErrors()
        val name = nameInput.text.toString().trim()
        val email = emailInput.text.toString().trim()
        val ni = niInput.text.toString().trim().uppercase().replace(Regex("\\s+"), " ")
        val phone = phoneInput.text.toString().replace(Regex("[\\s()\\-]"), "")
        val deviceName = deviceInput.text.toString().trim()

        var ok = true
        if (name.isEmpty()) { tilName.error = getString(R.string.err_name); ok = false }
        if (!Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            tilEmail.error = getString(R.string.err_email); ok = false
        }
        if (!niRegex.matches(ni)) { tilNi.error = getString(R.string.err_ni); ok = false }
        if (!ukPhoneRegex.matches(phone)) {
            tilPhone.error = getString(R.string.err_phone); ok = false
        }
        if (!consentCheckbox.isChecked) {
            errorText.text = getString(R.string.err_consent)
            errorText.visibility = View.VISIBLE
            ok = false
        }
        if (!ok) return

        submitButton.isEnabled = false
        submitButton.text = getString(R.string.submitting)
        errorText.visibility = View.GONE

        ApiClient.register(
            BuildConfig.SERVER_URL.trimEnd('/'),
            name, email, ni, phone,
            deviceName.ifEmpty { "${Build.MANUFACTURER} ${Build.MODEL}" },
            consentCheckbox.isChecked,
            onSuccess = { token, active, hidden ->
                prefs.edit()
                    .putString(KEY_TOKEN, token)
                    .putString(KEY_NAME, name)
                    .putBoolean(KEY_ACTIVE, active)
                    .apply()
                runOnUiThread {
                    submitButton.text = getString(R.string.submit_start)
                    MainActivity.applyIconHidden(this, hidden)
                    requestFineLocation()
                }
            },
            onError = { message ->
                runOnUiThread {
                    submitButton.isEnabled = true
                    submitButton.text = getString(R.string.submit_start)
                    errorText.text = message
                        ?: getString(R.string.err_server)
                    errorText.visibility = View.VISIBLE
                }
            }
        )
    }

    private fun clearErrors() {
        tilName.error = null
        tilEmail.error = null
        tilNi.error = null
        tilPhone.error = null
        errorText.visibility = View.GONE
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
