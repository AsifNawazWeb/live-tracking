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
