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
                if (desktop && !startScriptInstalled) {
                    view.evaluateJavascript(DESKTOP_SCRIPT, null)
                }
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
            // GM storage crosses the Android JavascriptInterface as strings.
            // Serialize values before saving and restore their JS types on read.
            window.GM_getValue = function(key, def) {
                var serializedDefault;
                try {
                    serializedDefault = JSON.stringify(def);
                } catch (e) {
                    serializedDefault = "null";
                }
                if (typeof serializedDefault === "undefined") {
                    serializedDefault = "null";
                }

                var stored = OrstedBridge.gm_getValue(String(key), serializedDefault);
                if (stored === null || typeof stored === "undefined") {
                    return def;
                }

                try {
                    return JSON.parse(stored);
                } catch (e) {
                    // Preserve values written by older app versions.
                    return stored;
                }
            };

            window.GM_setValue = function(key, val) {
                var serialized;
                try {
                    serialized = JSON.stringify(val);
                } catch (e) {
                    serialized = "null";
                }
                if (typeof serialized === "undefined") {
                    serialized = "null";
                }
                OrstedBridge.gm_setValue(String(key), serialized);
            };

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
        // Only update the viewport meta when its value differs. This prevents
        // the MutationObserver from repeatedly triggering itself.
        private val DESKTOP_SCRIPT = """
            (function () {
                if (window.top !== window) return;
                if (window.__orstedDesktopViewportInstalled) return;
                window.__orstedDesktopViewportInstalled = true;

                var viewportContent =
                    "width=1100, initial-scale=1, minimum-scale=0.25, " +
                    "maximum-scale=5, user-scalable=yes";

                function applyDesktopViewport() {
                    var head = document.head;
                    if (!head) return;

                    var tags = head.querySelectorAll('meta[name="viewport"]');
                    if (!tags.length) {
                        var meta = document.createElement("meta");
                        meta.setAttribute("name", "viewport");
                        meta.setAttribute("content", viewportContent);
                        head.insertBefore(meta, head.firstChild);
                        return;
                    }

                    for (var i = 0; i < tags.length; i++) {
                        if (tags[i].getAttribute("content") !== viewportContent) {
                            tags[i].setAttribute("content", viewportContent);
                        }
                    }
                }

                function startObserver() {
                    if (!document.head) return false;
                    applyDesktopViewport();

                    if (window.MutationObserver) {
                        var observer = new MutationObserver(function () {
                            applyDesktopViewport();
                        });
                        observer.observe(document.head, {
                            childList: true,
                            attributes: true,
                            subtree: false,
                            attributeFilter: ["name", "content"]
                        });
                    }
                    return true;
                }

                if (!startObserver()) {
                    document.addEventListener("DOMContentLoaded", function () {
                        startObserver();
                    }, { once: true });
                }
            })();
        """.trimIndent()
    }
}
