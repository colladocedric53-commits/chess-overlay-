package com.orsted.overlay

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    lateinit var webView: WebView
        private set
    private lateinit var prefs: android.content.SharedPreferences

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences(SitePickerActivity.PREFS_NAME, MODE_PRIVATE)
        webView = findViewById(R.id.webView)

        // Prefer the explicit picker Intent value. Fall back to saved settings
        // when Android recreates this Activity or it is launched independently.
        val desktop = intent.getBooleanExtra(
            SitePickerActivity.KEY_DESKTOP,
            prefs.getBoolean(SitePickerActivity.KEY_DESKTOP, false)
        )
        val startUrl = intent.getStringExtra(SitePickerActivity.KEY_START_URL)
            ?: prefs.getString(SitePickerActivity.KEY_START_URL, "https://www.chess.com")
            ?: "https://www.chess.com"

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = desktop
            loadWithOverviewMode = desktop
            userAgentString = if (desktop) DESKTOP_UA else MOBILE_UA
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                injectShim()
                injectAssetScripts()
            }
        }
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(JsBridge(this), "OrstedBridge")
        webView.loadUrl(startUrl)
    }

    private fun injectShim() {
        val shim = """
            window.GM_getValue = function(key, def) { return OrstedBridge.gm_getValue(key, def); };
            window.GM_setValue = function(key, val) { return OrstedBridge.gm_setValue(key, val); };
            window.GM_xmlhttpRequest = function(opts) {
                var cbId = 'cb_' + Math.random().toString(36).substr(2, 9);
                window[cbId] = function(res) {
                    if (opts.onload && res.status) opts.onload(res);
                    else if (opts.onerror && res.error) opts.onerror(res);
                    delete window[cbId];
                };
                OrstedBridge.gm_xmlhttpRequest(JSON.stringify(opts), cbId);
            };
        """.trimIndent()
        webView.evaluateJavascript(shim, null)
    }

    private fun injectAssetScripts() {
        val scripts = listOf("chess.min.js", "userscript.js")
        for (asset in scripts) {
            try {
                val code = assets.open(asset).bufferedReader().use { it.readText() }
                webView.evaluateJavascript(code, null)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    override fun onDestroy() {
        if (this::webView.isInitialized) {
            webView.apply {
                loadUrl("about:blank")
                clearHistory()
                (parent as? ViewGroup)?.removeView(this)
                destroy()
            }
        }
        super.onDestroy()
    }

    companion object {
        private const val MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        private const val DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
}
