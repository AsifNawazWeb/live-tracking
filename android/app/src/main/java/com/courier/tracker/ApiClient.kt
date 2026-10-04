package com.courier.tracker

import android.location.Location
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

object ApiClient {

    private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    fun sendLocation(
        baseUrl: String,
        token: String,
        location: Location,
        battery: Int,
        onResult: (code: Int?, error: IOException?) -> Unit
    ) {
        val body = JSONObject()
        body.put("token", token)
        body.put("lat", location.latitude)
        body.put("lng", location.longitude)
        if (location.hasAccuracy()) body.put("accuracy", location.accuracy.toDouble())
        if (location.hasSpeed()) body.put("speed", location.speed.toDouble())
        if (location.hasBearing()) body.put("bearing", location.bearing.toDouble())
        if (battery in 0..100) body.put("battery", battery)
        body.put("recorded_at", formatIso(location.time))
        post("$baseUrl/api/v1/location", body.toString(), onResult)
    }

    fun checkStatus(
        baseUrl: String,
        token: String,
        onResult: (code: Int?, error: IOException?) -> Unit
    ) {
        val req = Request.Builder()
            .url("$baseUrl/api/v1/ping?token=$token")
            .get()
            .build()
        client.newCall(req).enqueue(wrap(onResult))
    }

    /**
     * Self-registration from the app's first-run form.
     * onSuccess receives the device token issued by the server; tracking starts
     * immediately after. onError gets a user-facing message.
     */
    fun register(
        baseUrl: String,
        name: String,
        email: String,
        niNumber: String,
        phone: String,
        deviceName: String,
        consent: Boolean,
        onSuccess: (token: String) -> Unit,
        onError: (userMessage: String?) -> Unit
    ) {
        val body = JSONObject()
        body.put("name", name)
        body.put("email", email)
        body.put("ni_number", niNumber)
        body.put("phone", phone)
        body.put("device_name", deviceName)
        body.put("consent", consent)
        val req = Request.Builder()
            .url("$baseUrl/api/v1/register")
            .post(body.toString().toRequestBody(JSON_TYPE))
            .apply {
                if (BuildConfig.REGISTRATION_KEY.isNotEmpty()) {
                    addHeader("X-Registration-Key", BuildConfig.REGISTRATION_KEY)
                }
            }
            .build()
        client.newCall(req).enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                val text = try { response.body?.string() } catch (e: Exception) { null }
                val code = response.code
                response.close()
                if (code in 200..299) {
                    val token = try {
                        JSONObject(text
                            ?: "").optString("token")
                    } catch (e: Exception) { "" }
                    if (token.isNotEmpty()) {
                        onSuccess(token)
                        return
                    }
                    onError("Server sent an unexpected response")
                } else {
                    val msg = try {
                        JSONObject(text ?: "").optString("error")
                    } catch (e: Exception) { "" }
                    onError(msg.ifEmpty { "Server error (HTTP $code)" })
                }
            }

            override fun onFailure(call: Call, e: IOException) {
                onError("Cannot reach the server")
            }
        })
    }

    private fun post(
        url: String,
        json: String,
        onResult: (code: Int?, error: IOException?) -> Unit
    ) {
        val req = Request.Builder()
            .url(url)
            .post(json.toRequestBody(JSON_TYPE))
            .build()
        client.newCall(req).enqueue(wrap(onResult))
    }

    private fun wrap(onResult: (code: Int?, error: IOException?) -> Unit): Callback {
        return object : Callback {
            override fun onResponse(call: Call, response: Response) {
                val code = response.code
                response.use { }
                onResult(code, null)
            }

            override fun onFailure(call: Call, e: IOException) {
                onResult(null, e)
            }
        }
    }

    private fun formatIso(millis: Long): String {
        val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
        return sdf.format(java.util.Date(millis))
    }
}
