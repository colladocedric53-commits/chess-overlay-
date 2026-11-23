package com.orsted.overlay

import android.annotation.SuppressLint
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    
    private lateinit var webView: WebView
    private lateinit var sharedPrefs: SharedPreferences
    private lateinit var jsBridge: JsBridge
    
    @SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        
        sharedPrefs = getSharedPreferences("orsted_prefs", MODE_PRIVATE)
        
        val site = intent.getStringExtra("site") ?: sharedPrefs.getString("selected_site", "chess.com")
        val webviewMode = sharedPrefs.getString("webview_mode", "mobile")
        val url = if (site == "chess.com") "https://www.chess.com" else "https://lichess.org"
        
        webView = findViewById(R.id.webView)
        
        jsBridge = JsBridge(this) {
            showUpdateDialog()
        }
        
        configureWebView(webviewMode == "desktop")
        
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectScripts()
            }
            
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return false
            }
        }
        
        webView.loadUrl(url)
    }
    
    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(isDesktopMode: Boolean) {
        val settings = webView.settings
        
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.setSupportMultipleWindows(true)
        settings.setGeolocationEnabled(false)
        settings.allowFileAccess = true
        settings.allowFileAccessFromFileURLs = true
        settings.allowUniversalAccessFromFileURLs = true
        
        if (isDesktopMode) {
            settings.userAgentString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
        } else {
            settings.useWideViewPort = false
            settings.loadWithOverviewMode = false
            settings.builtInZoomControls = false
        }
        
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.setBackgroundColor(Color.BLACK)
        
        webView.addJavascriptInterface(jsBridge, "OrstedBridge")
    }
    
    private fun injectScripts() {
        val hwid = HwidProvider.getHwid(this)
        val licenseKey = sharedPrefs.getString("license_key", "") ?: ""
        
        val gmShim = """
            window.GM_getValue = function(key) {
                return OrstedBridge.GM_getValue(key);
            };
            window.GM_setValue = function(key, value) {
                OrstedBridge.GM_setValue(key, value);
            };
            window.GM_xmlhttpRequest = function(details) {
                return JSON.parse(OrstedBridge.GM_xmlhttpRequest(details));
            };
            window.OrstedHWID = "$hwid";
            window.OrstedLicenseKey = "$licenseKey";
        """.trimIndent()
        
        webView.evaluateJavascript(gmShim) { _ ->
            loadAssetScript("chess.min.js")
        }
    }
    
    private fun loadAssetScript(filename: String) {
        val js = try {
            assets.open(filename).bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            ""
        }
        
        if (js.isNotEmpty()) {
            webView.evaluateJavascript(js) { _ ->
                when (filename) {
                    "chess.min.js" -> loadAssetScript("stockfish.js")
                    "stockfish.js" -> loadAssetScript("userscript.js")
                }
            }
        }
    }
    
    private fun showUpdateDialog() {
        runOnUiThread {
            AlertDialog.Builder(this)
                .setTitle("APK Update Required")
                .setMessage("A new version is required. Please update to continue using Orsted.")
                .setPositiveButton("Telegram Support") { _, _ ->
                    val intent = Intent(Intent.ACTION_VIEW)
                    intent.data = android.net.Uri.parse("https://t.me/orstedph")
                    startActivity(intent)
                    finishAffinity()
                }
                .setCancelable(false)
                .show()
        }
    }
    
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
