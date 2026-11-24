package dev.egoist.music

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private val ioExecutor = Executors.newSingleThreadExecutor()
    private var pendingOpenedZip: String? = null
    private var pageReady = false

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = filePathCallback
        filePathCallback = null
        if (callback == null) return@registerForActivityResult

        if (result.resultCode != RESULT_OK || result.data == null) {
            callback.onReceiveValue(null)
            return@registerForActivityResult
        }
        val data = result.data!!
        val clip = data.clipData
        val uris = if (clip != null) {
            Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
        } else {
            data.data?.let { arrayOf(it) }
        }
        callback.onReceiveValue(uris)
    }

    private val notifPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(NativeJsBridge(), "MyGoNative")

            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    pageReady = true
                    pendingOpenedZip?.let { path ->
                        pendingOpenedZip = null
                        sendEventToWeb("pluginZipOpened", JSONObject().put("path", path))
                    }
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val u = request?.url ?: return false
                    if (u.host == "127.0.0.1" || u.host == "localhost") {
                        return false
                    }
                    startActivity(Intent(Intent.ACTION_VIEW, u))
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    callback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = callback
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        val accepts = fileChooserParams?.acceptTypes ?: emptyArray()
                        if (accepts.any { it.contains("zip") }) {
                            putExtra(
                                Intent.EXTRA_MIME_TYPES,
                                arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")
                            )
                        } else if (accepts.any { it.contains("audio") || it.contains(".mp3") || it.contains(".flac") }) {
                            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/*", "application/ogg"))
                        }
                        if (fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        }
                    }
                    try {
                        fileChooserLauncher.launch(intent)
                    } catch (_: Throwable) {
                        filePathCallback = null
                        return false
                    }
                    return true
                }
            }
        }

        setContentView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    moveTaskToBack(true)
                }
            }
        })

        PlaybackBridge.onEvent = { name, payload ->
            sendEventToWeb(name, payload)
        }

        // Start & connect to Media3 MediaSessionService so background playback and lockscreen controls stay active.
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        controllerFuture = MediaController.Builder(this, token).buildAsync()

        handleIncomingIntent(intent)

        // Start in-process Go core and load embedded Web UI.
        ioExecutor.execute {
            val lang = Locale.getDefault().toLanguageTag()
            val raw = CoreBridge.nativeStart(filesDir.absolutePath, cacheDir.absolutePath, lang)
            val json = JSONObject(raw)
            val err = json.optString("error", "")
            runOnUiThread {
                if (err.isNotBlank()) {
                    Toast.makeText(this, "Core start failed: $err", Toast.LENGTH_LONG).show()
                } else {
                    val port = json.getInt("port")
                    val authToken = json.getString("token")
                    webView.loadUrl("http://127.0.0.1:$port/?token=$authToken&platform=android")
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val uri = intent.data ?: return
        ioExecutor.execute {
            try {
                val dest = File(cacheDir, "opened-plugin-${System.currentTimeMillis()}.zip")
                contentResolver.openInputStream(uri)?.use { input ->
                    dest.outputStream().use { output -> input.copyTo(output) }
                }
                if (pageReady) {
                    sendEventToWeb("pluginZipOpened", JSONObject().put("path", dest.absolutePath))
                } else {
                    pendingOpenedZip = dest.absolutePath
                }
            } catch (_: Throwable) {
            }
        }
    }

    private fun sendEventToWeb(name: String, payload: JSONObject) {
        val js = "window.__mygoNativeEvent && window.__mygoNativeEvent(${JSONObject.quote(name)}, $payload);"
        runOnUiThread {
            if (::webView.isInitialized) {
                webView.evaluateJavascript(js, null)
            }
        }
    }

    private fun saveImageToGallery(imageUrl: String, filename: String) {
        ioExecutor.execute {
            try {
                val conn = URL(imageUrl).openConnection() as HttpURLConnection
                val bytes = conn.inputStream.use { it.readBytes() }
                conn.disconnect()

                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, filename)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/MyGoMusic")
                }
                val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                if (uri != null) {
                    contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                }
                runOnUiThread {
                    Toast.makeText(this, "已保存图片到相册", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Throwable) {
                runOnUiThread {
                    Toast.makeText(this, "保存失败: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private inner class NativeJsBridge {
        @JavascriptInterface
        fun postMessage(rawJson: String) {
            val msg = JSONObject(rawJson)
            val action = msg.optString("action")
            val payload = msg.optJSONObject("payload") ?: JSONObject()

            when (action) {
                "playerLoad" -> {
                    val svcIntent = Intent(this@MainActivity, PlaybackService::class.java)
                    startService(svcIntent)
                    PlaybackBridge.load(
                        PlaybackBridge.TrackLoadRequest(
                            url = payload.optString("url"),
                            title = payload.optString("title"),
                            artist = payload.optString("artist"),
                            album = payload.optString("album"),
                            artworkUrl = payload.optString("artworkUrl"),
                            durationMs = payload.optLong("durationMs", 0L),
                            autoplay = payload.optBoolean("autoplay", true)
                        )
                    )
                }

                "playerPlay" -> PlaybackBridge.play()
                "playerPause" -> PlaybackBridge.pause()
                "playerSeek" -> PlaybackBridge.seek(payload.optLong("positionMs", 0L))

                "openExternal" -> {
                    val url = payload.optString("url")
                    if (url.isNotBlank()) {
                        runOnUiThread {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        }
                    }
                }

                "saveImage" -> {
                    val url = payload.optString("url")
                    val filename = payload.optString("filename", "mygo-qr.png")
                    if (url.isNotBlank()) {
                        saveImageToGallery(url, filename)
                    }
                }

                "openWebSignIn" -> {
                    val id = payload.optString("id")
                    val name = payload.optString("name", "Sign In")
                    val url = payload.optString("url")
                    val cookiesOf = payload.optString("cookiesOf")
                    val userAgent = payload.optString("userAgent")
                    val untilArr = payload.optJSONArray("until")
                    val until = mutableListOf<String>()
                    if (untilArr != null) {
                        for (i in 0 until untilArr.length()) {
                            until.add(untilArr.optString(i))
                        }
                    }
                    runOnUiThread {
                        WebSignInDialog(
                            context = this@MainActivity,
                            requestId = id,
                            title = name,
                            signInUrl = url,
                            cookiesOf = cookiesOf,
                            untilCookies = until,
                            userAgent = userAgent
                        ) { cookie, err ->
                            ioExecutor.execute {
                                CoreBridge.nativeCompleteWebSignIn(id, cookie, err)
                            }
                        }.show()
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        PlaybackBridge.onEvent = null
        controllerFuture?.let { MediaController.releaseFuture(it) }
        super.onDestroy()
    }
}
