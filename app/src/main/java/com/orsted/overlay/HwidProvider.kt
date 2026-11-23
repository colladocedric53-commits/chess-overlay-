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
        var hash: Long = 0x811c9dc5L
        val prime: Long = 0x01000193L

        for (byte in bytes) {
            val b = byte.toInt() and 0xFF
            hash = ((hash xor b.toLong()) * prime) and 0xFFFFFFFFL
        }

        val hexString = String.format("%016x", hash)
        return "osd-$hexString"
    }
}
