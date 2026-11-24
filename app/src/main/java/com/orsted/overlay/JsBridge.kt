package com.orsted.overlay

import android.app.AlertDialog
import android.content.Context
import android.webkit.JavascriptInterface
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class JsBridge(private val activity: MainActivity) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS) // 60s for Render cold starts
        .followRedirects(true)
        .build()

    private val gmPrefs by lazy {
        activity.getSharedPreferences("orsted_gm", Context.MODE_PRIVATE)
    }

    @JavascriptInterface
    fun gm_getValue(key: String, defaultValue: String?): String? {
        return gmPrefs.getString(key, defaultValue)
    }

    @JavascriptInterface
    fun gm_setValue(key: String, value: String?) {
        gmPrefs.edit().putString(key, value ?: "").apply()
    }

    @JavascriptInterface
    fun gm_getHwid(): String {
        return HwidProvider.getHwid(activity)
    }

    @JavascriptInterface
    fun gm_xmlhttpRequest(detailsJson: String, callbackId: String) {
        val details = JSONObject(detailsJson)
        val method = details.optString("method", "GET").uppercase()
        val url = details.getString("url")
        val body = details.optString("data", "")

        val builder = Request.Builder().url(url)

        val headers = details.optJSONObject("headers") ?: JSONObject()
        val keyIter = headers.keys()
        while (keyIter.hasNext()) {
            val name = keyIter.next()
            builder.header(name, headers.optString(name))
        }

        when (method) {
            "POST" -> builder.post(body.toRequestBody(FORM_TYPE))
            "PUT" -> builder.put(body.toRequestBody(FORM_TYPE))
            "PATCH" -> builder.patch(body.toRequestBody(FORM_TYPE))
            "DELETE" -> builder.delete(body.toRequestBody(FORM_TYPE))
            "HEAD" -> builder.head()
            else -> builder.get()
        }

        client.newCall(builder.build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                dispatch(callbackId, JSONObject().put("error", e.message ?: "network failure"))
            }

            override fun onResponse(call: Call, response: Response) {
                response.use { resp ->
                    if (resp.code == HTTP_426) {
                        showBlockedDialog(resp.body?.string().orEmpty())
                        return
                    }

                    val headersJson = JSONObject()
                    for ((name, value) in resp.headers) {
                        headersJson.put(name, value)
                    }

                    val payload = JSONObject()
                        .put("status", resp.code)
                        .put("responseText", resp.body?.string().orEmpty())
                        .put("headers", headersJson)
                        .put("finalUrl", resp.request.url.toString())

                    dispatch(callbackId, payload)
                }
            }
        })
    }

    private fun dispatch(callbackId: String, payload: JSONObject) {
        activity.runOnUiThread {
            if (activity.webView.isAttachedToWindow) {
                activity.webView.evaluateJavascript(
                    "if (window['$callbackId']) window['$callbackId']($payload);",
                    null
                )
            }
        }
    }

    private fun showBlockedDialog(serverMessage: String) {
        activity.runOnUiThread {
            val message = if (serverMessage.isNotBlank()) serverMessage.take(300) else activity.getString(R.string.blocked_message)
            AlertDialog.Builder(activity)
                .setTitle(R.string.blocked_title)
                .setMessage(message)
                .setCancelable(false)
                .setPositiveButton(R.string.blocked_exit) { _, _ -> activity.finishAffinity() }
                .show()
        }
    }

    companion object {
        private const val HTTP_426 = 426
        private val FORM_TYPE = "application/x-www-form-urlencoded".toMediaTypeOrNull()
    }
}
