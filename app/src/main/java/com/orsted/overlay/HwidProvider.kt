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
        var hash: Long = 0xcbf29ce484222325L  // FNV offset basis for 64-bit
        val prime: Long = 0x100000001b3L       // FNV prime for 64-bit
        
        for (byte in bytes) {
            val b = byte.toInt() and 0xFF
            hash = hash xor b.toLong()
            hash = hash * prime
        }
        
        val hexString = String.format("%016x", hash)
        return "osd-$hexString"
    }
}
