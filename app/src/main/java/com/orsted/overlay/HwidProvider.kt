package com.orsted.overlay

import android.content.Context
import android.provider.Settings
import android.os.Build
import java.nio.charset.StandardCharsets

object HwidProvider {
    
    private const val FNV_OFFSET_BASIS = 14695981039346656037L
    private const val FNV_PRIME = 1099511628211L
    
    fun getHwid(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
        val deviceInfo = "${Build.MODEL}|${Build.MANUFACTURER}|${Build.PRODUCT}|${Build.SERIAL}|$androidId"
        
        val bytes = deviceInfo.toByteArray(StandardCharsets.UTF_8)
        var hash = FNV_OFFSET_BASIS
        
        for (byte in bytes) {
            hash = hash xor (byte.toLong() and 0xFF)
            hash = hash * FNV_PRIME
        }
        
        val hexString = String.format("%016x", hash and 0xFFFFFFFFFFFFFFFF)
        return "osd-$hexString"
    }
}
