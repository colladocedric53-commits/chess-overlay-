package com.orsted.overlay

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.UserAgentMetadata
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {
    lateinit var webView: WebView
        private set
    private lateinit var prefs: android.content.SharedPreferences
    private var desktop = false
    private var startScriptInstalled = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = getSharedPreferences(SitePickerActivity.PREFS_NAME, MODE_PRIVATE)
        webView = findViewById(R.id.webView)

        desktop = intent.getBooleanExtra(
            SitePickerActivity.KEY_DESKTOP,
            prefs.getBoolean(SitePickerActivity.KEY_DESKTOP, false)
        )
        val url = intent.getStringExtra(SitePickerActivity.KEY_START_URL)
            ?: prefs.getString(SitePickerActivity.KEY_START_URL, "https://www.chess.com")
            ?: "https://www.chess.com"

        val settings = webView.settings
        val defaultUa = settings.userAgentString
        val version = Regex("Chrome/([0-9.]+)").find(defaultUa)?.groupValues?.get(1) ?: "120.0.0.0"

        settings.apply {
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
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            textZoom = 100
            userAgentString = if (desktop) {
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$version Safari/537.36"
            } else defaultUa
            cacheMode = if (desktop) WebSettings.LOAD_NO_CACHE else WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        if (desktop) {
            webView.clearCache(true)
            setDesktopHints(settings)
            installDesktopScript()
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                if (desktop && !startScriptInstalled) view.evaluateJavascript(DESKTOP_SCRIPT, null)
                injectShim()
                injectAssetScripts()
            }
        }
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(JsBridge(this), "OrstedBridge")
        webView.loadUrl(url)
    }

    private fun setDesktopHints(settings: WebSettings) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) return
        try {
            WebSettingsCompat.setUserAgentMetadata(
                settings,
                UserAgentMetadata.Builder()
                    .setMobile(false)
                    .setPlatform("Windows")
                    .setPlatformVersion("10.0.0")
                    .setArchitecture("x86")
                    .setBitness(64)
                    .setModel("")
                    .build()
            )
        } catch (e: Exception) {
            Log.w("OrstedWebView", "Desktop UA hints unavailable", e)
        }
    }

    private fun installDesktopScript() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        try {
            WebViewCompat.addDocumentStartJavaScript(
                webView, DESKTOP_SCRIPT,
                setOf("https://chess.com", "https://*.chess.com",
                    "https://lichess.org", "https://*.lichess.org")
            )
            startScriptInstalled = true
        } catch (e: Exception) {
            Log.w("OrstedWebView", "Document-start script unavailable", e)
        }
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
        for (asset in listOf("chess.min.js", "userscript.js")) {
            try {
                val script = assets.open(asset).bufferedReader().use { it.readText() }
                webView.evaluateJavascript(script, null)
            } catch (e: Exception) {
                Log.e("OrstedWebView", "Failed to inject $asset", e)
            }
        }
    }

    override fun onDestroy() {
        if (this::webView.isInitialized) webView.apply {
            loadUrl("about:blank")
            clearHistory()
            (parent as? ViewGroup)?.removeView(this)
            destroy()
        }
        super.onDestroy()
    }

    companion object {
        private val DESKTOP_SCRIPT = """
            (function () {
                if (window.top !== window) return;
                var content = "width=1100, initial-scale=1, minimum-scale=0.25, maximum-scale=5, user-scalable=yes";
                function apply() {
                    var root = document.documentElement;
                    if (!root) return;
                    var tags = document.querySelectorAll('meta[name="viewport"]');
                    if (!tags.length) {
                        var meta = document.createElement("meta");
                        meta.name = "viewport"; meta.content = content;
                        (document.head || root).insertBefore(meta, (document.head || root).firstChild);
                    } else {
                        for (var i = 0; i < tags.length; i++) tags[i].content = content;
                    }
                    root.style.minWidth = "1100px";
                    if (document.body) document.body.style.minWidth = "1100px";
                }
                function start() {
                    apply();
                    if (window.MutationObserver && document.documentElement) {
                        new MutationObserver(apply).observe(document.documentElement, {
                            childList: true, subtree: true, attributes: true,
                            attributeFilter: ["name", "content"]
                        });
                    }
                    setTimeout(function () {
                        try {
                            if (innerWidth < 800 && sessionStorage.getItem("__orstedDesktopReload") !== "1") {
                                sessionStorage.setItem("__orstedDesktopReload", "1");
                                location.reload();
                            } else if (innerWidth >= 800) sessionStorage.removeItem("__orstedDesktopReload");
                        } catch (e) {}
                    }, 500);
                }
                if (document.documentElement) start();
                else document.addEventListener("DOMContentLoaded", start, { once: true });
            })();
        """.trimIndent()
    }
}
