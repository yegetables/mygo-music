package dev.egoist.music

import android.annotation.SuppressLint
import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class WebSignInDialog(
    context: Context,
    private val requestId: String,
    private val title: String,
    private val signInUrl: String,
    private val cookiesOf: String,
    private val untilCookies: List<String>,
    private val userAgent: String,
    private val onDone: (cookie: String, error: String) -> Unit
) : Dialog(context, android.R.style.Theme_DeviceDefault_NoActionBar_Fullscreen) {

    private val handler = Handler(Looper.getMainLooper())
    private var completed = false
    private lateinit var webView: WebView

    private val pollRunnable = object : Runnable {
        override fun run() {
            if (!completed) {
                checkCookies()
                handler.postDelayed(this, 800L)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun show() {
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0F1014"))
        }

        val topBar = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(24, 36, 24, 20)
            setBackgroundColor(Color.parseColor("#181A20"))
        }

        val titleView = TextView(context).apply {
            text = title.ifBlank { "Sign In" }
            setTextColor(Color.WHITE)
            textSize = 16f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        val closeBtn = Button(context).apply {
            text = "关闭"
            setOnClickListener {
                finish("", "sign-in cancelled")
            }
        }

        topBar.addView(titleView)
        topBar.addView(closeBtn)

        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.removeAllCookies(null)
        cm.flush()

        webView = WebView(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            if (userAgent.isNotBlank()) {
                settings.userAgentString = userAgent
            }
            cm.setAcceptThirdPartyCookies(this, true)
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    checkCookies()
                }
            }
        }

        root.addView(topBar)
        root.addView(webView)
        setContentView(root)
        setCancelable(true)
        setOnCancelListener {
            finish("", "sign-in cancelled")
        }

        super.show()
        webView.loadUrl(signInUrl)
        handler.postDelayed(pollRunnable, 1000L)
    }

    private fun checkCookies() {
        if (completed || untilCookies.isEmpty()) return
        val cm = CookieManager.getInstance()
        cm.flush()
        val raw = cm.getCookie(cookiesOf) ?: return
        val names = raw.split(";")
            .mapNotNull { part ->
                val idx = part.indexOf('=')
                if (idx > 0) part.substring(0, idx).trim() else null
            }
            .toSet()

        if (untilCookies.all { names.contains(it) }) {
            finish(raw, "")
        }
    }

    private fun finish(cookie: String, error: String) {
        if (completed) return
        completed = true
        handler.removeCallbacks(pollRunnable)
        try {
            webView.stopLoading()
            webView.destroy()
        } catch (_: Throwable) {
        }
        dismiss()
        onDone(cookie, error)
    }
}
