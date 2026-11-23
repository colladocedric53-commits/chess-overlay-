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
        var hash: Long = 0x811c9dc5L  // FNV offset basis for 32-bit
        val prime: Long = 0x01000193L  // FNV prime for 32-bit
        
        for (byte in bytes) {
            val b = byte.toInt() and 0xFF
            hash = hash xor b.toLong()
            hash = hash * prime
        }
        
        // Take lower 64 bits and format as 16 hex chars
        val hexString = String.format("%016x", hash and 0xFFFFFFFFFFFFFFFFL)
        return "osd-$hexString"
    }
}
