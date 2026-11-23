package com.orsted.overlay

import android.content.Context
import android.provider.Settings
import android.os.Build
import java.nio.charset.StandardCharsets

object HwidProvider {
    
    fun getHwid(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
        val deviceInfo = "${Build.MODEL}|${Build.MANUFACTURER}|${Build.PRODUCT}|${Build.SERIAL}|$androidId"
        
        val bytes = deviceInfo.toByteArray(StandardCharsets.UTF_8)
        var hash = 14695981039346656037L
        val prime = 1099511628211L
        
        for (byte in bytes) {
            val b = byte.toInt() and 0xFF
            hash = hash xor b.toLong()
            hash = hash * prime
        }
        
        val hexString = String.format("%016x", hash and 0xFFFFFFFFFFFFFFFFL)
        return "osd-$hexString"
    }
}
