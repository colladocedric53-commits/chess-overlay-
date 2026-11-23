# Android proguard rules
-keep class androidx.** { *; }
-keep class com.google.android.material.** { *; }
-keep class android.webkit.** { *; }

# Keep all Kotlin classes
-keep class kotlin.** { *; }
-keep class org.jetbrains.** { *; }

# Keep Orsted package classes
-keep class com.orsted.overlay.** { *; }

# Keep WebView JavaScript interfaces
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep OkHttp classes
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-keep class okio.** { *; }

# Keep for EncryptedSharedPreferences
-keep class androidx.security.** { *; }
