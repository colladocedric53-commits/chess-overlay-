package com.orsted.overlay

import android.content.Context
import android.webkit.JavascriptInterface
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

class JsBridge(private val context: Context, private val onUpdateRequired: () -> Unit) {
    
    private val sharedPrefs by lazy {
        val masterKey = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        EncryptedSharedPreferences.create(
            "orsted_encrypted",
            masterKey,
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }
    
    private val okHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }
    
    private val currentHwid by lazy {
        HwidProvider.getHwid(context)
    }
    
    @JavascriptInterface
    fun GM_getValue(key: String): String {
        return sharedPrefs.getString(key, "") ?: ""
    }
    
    @JavascriptInterface
    fun GM_setValue(key: String, value: String) {
        sharedPrefs.edit().putString(key, value).apply()
    }
    
    @JavascriptInterface
    fun GM_xmlhttpRequest(details: String): String {
        return try {
            val request = Request.Builder()
                .url(details)
                .get()
                .build()
            
            val response = okHttpClient.newCall(request).execute()
            val statusCode = response.code
            val body = response.body?.string() ?: ""
            
            when (statusCode) {
                426 -> {
                    onUpdateRequired()
                    "{\"status\":426}"
                }
                else -> {
                    "{\"status\":$statusCode,\"body\":\"$body\"}"
                }
            }
        } catch (e: Exception) {
            "{\"status\":0,\"error\":\"${e.message}\"}"
        }
    }
    
    @JavascriptInterface
    fun getHwid(): String {
        return currentHwid
    }
    
    @JavascriptInterface
    fun getLicenseKey(): String {
        return sharedPrefs.getString("license_key", "") ?: ""
    }
    
    @JavascriptInterface
    fun setLicenseKey(key: String) {
        sharedPrefs.edit().putString("license_key", key).apply()
    }
    
    @JavascriptInterface
    fun triggerUpdate() {
        onUpdateRequired()
    }
    
    fun validateLicense(key: String, version: String, callback: (Boolean, String?) -> Unit) {
        val url = "https://chess-engine-2-66am.onrender.com/api/validate?key=$key&hwid=${currentHwid}&ver=$version"
        
        val request = Request.Builder()
            .url(url)
            .get()
            .build()
        
        okHttpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                callback(false, null)
            }
            
            override fun onResponse(call: Call, response: Response) {
                when (response.code) {
                    200 -> {
                        val body = response.body?.string() ?: ""
                        val expiresAt = try {
                            org.json.JSONObject(body).optString("expires_at", "")
                        } catch (e: Exception) {
                            ""
                        }
                        sharedPrefs.edit().putString("license_expires", expiresAt).apply()
                        callback(true, expiresAt)
                    }
                    426 -> {
                        onUpdateRequired()
                        callback(false, null)
                    }
                    else -> {
                        callback(false, null)
                    }
                }
            }
        })
    }
}
