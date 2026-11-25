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
    private var desktopMode = false
    private var documentStartViewportInstalled = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences(SitePickerActivity.PREFS_NAME, MODE_PRIVATE)
        webView = findViewById(R.id.webView)

        // The picker passes the selected mode directly. Preferences cover
        // Activity recreation and launches which do not include the extra.
        desktopMode = intent.getBooleanExtra(
            SitePickerActivity.KEY_DESKTOP,
            prefs.getBoolean(SitePickerActivity.KEY_DESKTOP, false)
        )

        val startUrl = intent.getStringExtra(SitePickerActivity.KEY_START_URL)
            ?: prefs.getString(SitePickerActivity.KEY_START_URL, "https://www.chess.com")
            ?: "https://www.chess.com"

        val settings = webView.settings
        val defaultUserAgent = settings.userAgentString
        val chromeVersion = extractChromeVersion(defaultUserAgent)

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false

            // Desktop websites need a wide CSS viewport as well as a desktop UA.
            useWideViewPort = desktopMode
            loadWithOverviewMode = desktopMode
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            textZoom = 100

            // Use the installed WebView's actual Chromium version. This avoids
            // sending an old hard-coded Chrome version to modern chess sites.
            userAgentString = if (desktopMode) {
                buildDesktopUserAgent(chromeVersion)
            } else {
                defaultUserAgent
            }

            cacheMode = if (desktopMode) {
                WebSettings.LOAD_NO_CACHE
            } else {
                WebSettings.LOAD_DEFAULT
            }
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        if (desktopMode) {
            webView.clearCache(true)
            configureDesktopUserAgentHints(settings, chromeVersion)
            installDesktopViewportOverride()
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                // Older WebView releases lack document-start injection. Apply
                // the same viewport override after load as a compatibility path.
                if (desktopMode && !documentStartViewportInstalled) {
                    view.evaluateJavascript(DESKTOP_VIEWPORT_SCRIPT, null)
                }

                // Keep the existing GM_ shim and userscript load order unchanged.
                injectShim()
                injectAssetScripts()
            }
        }

        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(JsBridge(this), "OrstedBridge")

        // All WebView settings and desktop overrides are in place before this.
        webView.loadUrl(startUrl)
    }

    private fun extractChromeVersion(userAgent: String): String {
        val match = Regex("Chrome/([0-9.]+)").find(userAgent)
        return match?.groupValues?.getOrNull(1)?.takeIf { it.isNotBlank() }
            ?: "120.0.0.0"
    }

    private fun buildDesktopUserAgent(chromeVersion: String): String {
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/$chromeVersion Safari/537.36"
    }

    private fun configureDesktopUserAgentHints(
        settings: WebSettings,
        chromeVersion: String
    ) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) {
            Log.w(TAG, "This WebView does not support custom User-Agent Client Hints")
            return
        }

        try {
            val majorVersion = chromeVersion.substringBefore(".")
            val brands = listOf(
                UserAgentMetadata.BrandVersion.Builder()
                    .setBrand("Chromium")
                    .setMajorVersion(majorVersion)
                    .setFullVersion(chromeVersion)
                    .build(),
                UserAgentMetadata.BrandVersion.Builder()
                    .setBrand("Google Chrome")
                    .setMajorVersion(majorVersion)
                    .setFullVersion(chromeVersion)
                    .build(),
                UserAgentMetadata.BrandVersion.Builder()
                    .setBrand("Not_A Brand")
                    .setMajorVersion("99")
                    .setFullVersion("99.0.0.0")
                    .build()
            )

            val metadata = UserAgentMetadata.Builder()
                .setBrandVersionList(brands)
                .setMobile(false)
                .setPlatform("Windows")
                .setPlatformVersion("10.0.0")
                .setArchitecture("x86")
                .setBitness(64)
                .setModel("")
                .build()

            WebSettingsCompat.setUserAgentMetadata(settings, metadata)
        } catch (error: Exception) {
            Log.w(TAG, "Unable to set desktop User-Agent Client Hints", error)
        }
    }

    private fun installDesktopViewportOverride() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.w(TAG, "Document-start script unavailable. Using page-finish fallback.")
            return
        }

        try {
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                DESKTOP_VIEWPORT_SCRIPT,
                setOf(
                    "https://chess.com",
                    "https://*.chess.com",
                    "https://lichess.org",
                    "https://*.lichess.org"
                )
            )
            documentStartViewportInstalled = true
        } catch (error: Exception) {
            documentStartViewportInstalled = false
            Log.w(TAG, "Unable to install desktop viewport script", error)
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
        val scripts = listOf("chess.min.js", "userscript.js")
        for (asset in scripts) {
            try {
                val code = assets.open(asset).bufferedReader().use { it.readText() }
                webView.evaluateJavascript(code, null)
            } catch (error: Exception) {
                Log.e(TAG, "Failed to inject $asset", error)
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
        private const val TAG = "OrstedWebView"

        // Run before site JavaScript so responsive frameworks see a desktop
        // layout viewport from their first render. Keep watching because some
        // single-page apps rewrite their viewport tag after navigation.
        private val DESKTOP_VIEWPORT_SCRIPT = """
            (function () {
                if (window.top !== window) return;

                var desktopWidth = "1100";
                var viewportContent =
                    "width=1100, initial-scale=1, minimum-scale=0.25, " +
                    "maximum-scale=5, user-scalable=yes";

                function forceDesktopViewport() {
                    var root = document.documentElement;
                    if (!root) return;

                    var metas = document.getElementsByTagName("meta");
                    var found = false;

                    for (var i = 0; i < metas.length; i++) {
                        var name = metas[i].getAttribute("name");
                        if (name && name.toLowerCase() === "viewport") {
                            found = true;
                            if (metas[i].getAttribute("content") !== viewportContent) {
                                metas[i].setAttribute("content", viewportContent);
                            }
                        }
                    }

                    if (!found) {
                        var meta = document.createElement("meta");
                        meta.setAttribute("name", "viewport");
                        meta.setAttribute("content", viewportContent);
                        var parent = document.head || root;
                        parent.insertBefore(meta, parent.firstChild);
                    }

                    if (root.style.minWidth !== desktopWidth + "px") {
                        root.style.minWidth = desktopWidth + "px";
                    }
                    if (document.body &&
                        document.body.style.minWidth !== desktopWidth + "px") {
                        document.body.style.minWidth = desktopWidth + "px";
                    }
                }

                function install() {
                    forceDesktopViewport();

                    if (window.MutationObserver && document.documentElement) {
                        var observer = new MutationObserver(function () {
                            forceDesktopViewport();
                        });
                        observer.observe(document.documentElement, {
                            childList: true,
                            subtree: true,
                            attributes: true,
                            attributeFilter: ["name", "content"]
                        });
                    }

                    // If this WebView ignores a late viewport change, allow one
                    // reload after the viewport has been rewritten.
                    window.setTimeout(function () {
                        var width = window.innerWidth || 0;
                        try {
                            if (width < 800) {
                                if (window.sessionStorage.getItem("__orstedDesktopReload") !== "1") {
                                    window.sessionStorage.setItem("__orstedDesktopReload", "1");
                                    window.location.reload();
                                }
                            } else {
                                window.sessionStorage.removeItem("__orstedDesktopReload");
                            }
                        } catch (ignored) {
                        }
                    }, 500);
                }

                if (document.documentElement) {
                    install();
                } else {
                    document.addEventListener("DOMContentLoaded", install, { once: true });
                }
            })();
        """.trimIndent()
    }
}
