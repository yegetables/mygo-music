package dev.egoist.music

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import org.json.JSONObject

object PlaybackBridge {
    @Volatile
    var service: PlaybackService? = null

    @Volatile
    var onEvent: ((name: String, payload: JSONObject) -> Unit)? = null

    @Volatile
    var pendingGain: Float = 1.0f

    @Volatile
    var pendingMetering: Boolean = false

    @Volatile
    var isForeground: Boolean = true
        private set

    private var pendingLoad: TrackLoadRequest? = null

    data class TrackLoadRequest(
        val url: String,
        val title: String,
        val artist: String,
        val album: String,
        val artworkUrl: String,
        val durationMs: Long,
        val autoplay: Boolean,
        val normGain: Float = 1.0f
    )

    fun load(req: TrackLoadRequest) {
        pendingGain = req.normGain.coerceIn(0.0f, 4.0f)
        val svc = service
        if (svc != null) {
            svc.loadTrack(req)
        } else {
            pendingLoad = req
        }
    }

    fun consumePending(): TrackLoadRequest? {
        val p = pendingLoad
        pendingLoad = null
        return p
    }

    fun play() {
        service?.play()
    }

    fun pause() {
        service?.pause()
    }

    fun seek(positionMs: Long) {
        service?.seekTo(positionMs)
    }

    fun setGain(gain: Float) {
        val clamped = gain.coerceIn(0.0f, 4.0f)
        pendingGain = clamped
        service?.setGain(clamped)
    }

    fun setMetering(enabled: Boolean) {
        pendingMetering = enabled
        service?.updateMetering()
    }

    fun setForeground(foreground: Boolean) {
        isForeground = foreground
        service?.updateMetering()
    }

    fun emit(name: String, payload: JSONObject) {
        onEvent?.invoke(name, payload)
    }
}

@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private lateinit var exoPlayer: ExoPlayer
    private val audioProcessor = GainAndMeterAudioProcessor()
    private var mediaSession: MediaSession? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastEndedSent = false
    private var meterTickerRunning = false

    private val progressTicker = object : Runnable {
        override fun run() {
            if (::exoPlayer.isInitialized && exoPlayer.isPlaying) {
                emitState(ended = false, error = null)
            }
            mainHandler.postDelayed(this, 250L)
        }
    }

    private val meterTicker = object : Runnable {
        override fun run() {
            val active = PlaybackBridge.pendingMetering && PlaybackBridge.isForeground
            if (!active || !::exoPlayer.isInitialized) {
                meterTickerRunning = false
                audioProcessor.meteringActive = false
                PlaybackBridge.emit("audioLevel", JSONObject().put("bass", 0.0).put("live", false))
                return
            }
            val playing = exoPlayer.isPlaying
            val bass = if (playing) audioProcessor.bassLevel.toDouble() else 0.0
            PlaybackBridge.emit("audioLevel", JSONObject().put("bass", bass).put("live", true))
            mainHandler.postDelayed(this, 33L)
        }
    }

    override fun onCreate() {
        super.onCreate()

        audioProcessor.gain = PlaybackBridge.pendingGain
        audioProcessor.meteringActive = PlaybackBridge.pendingMetering && PlaybackBridge.isForeground

        val renderersFactory = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean
            ): AudioSink {
                return DefaultAudioSink.Builder(context)
                    .setEnableFloatOutput(enableFloatOutput)
                    .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                    .setAudioProcessors(arrayOf(audioProcessor))
                    .build()
            }
        }

        val attrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        exoPlayer = ExoPlayer.Builder(this, renderersFactory)
            .setAudioAttributes(attrs, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()

        exoPlayer.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) {
                    if (!lastEndedSent) {
                        lastEndedSent = true
                        emitState(ended = true, error = null)
                    }
                } else {
                    lastEndedSent = false
                    emitState(ended = false, error = null)
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                emitState(ended = false, error = null)
            }

            override fun onPlayerError(error: PlaybackException) {
                emitState(ended = false, error = error.localizedMessage ?: "Playback error")
            }
        })

        // Wrap ExoPlayer so lockscreen / notification / Bluetooth Next & Previous route to our queue.
        val forwarding = object : ForwardingPlayer(exoPlayer) {
            override fun getAvailableCommands(): Player.Commands {
                return super.getAvailableCommands().buildUpon()
                    .add(Player.COMMAND_SEEK_TO_NEXT)
                    .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .build()
            }

            override fun isCommandAvailable(command: Int): Boolean {
                return when (command) {
                    Player.COMMAND_SEEK_TO_NEXT,
                    Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                    Player.COMMAND_SEEK_TO_PREVIOUS,
                    Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> true
                    else -> super.isCommandAvailable(command)
                }
            }

            override fun seekToNext() {
                PlaybackBridge.emit("remoteCommand", JSONObject().put("command", "next"))
            }

            override fun seekToNextMediaItem() {
                PlaybackBridge.emit("remoteCommand", JSONObject().put("command", "next"))
            }

            override fun seekToPrevious() {
                PlaybackBridge.emit("remoteCommand", JSONObject().put("command", "previous"))
            }

            override fun seekToPreviousMediaItem() {
                PlaybackBridge.emit("remoteCommand", JSONObject().put("command", "previous"))
            }
        }

        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val sessionActivity = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        mediaSession = MediaSession.Builder(this, forwarding)
            .setSessionActivity(sessionActivity)
            .build()

        PlaybackBridge.service = this
        mainHandler.post(progressTicker)
        updateMetering()

        PlaybackBridge.consumePending()?.let { loadTrack(it) }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return mediaSession
    }

    fun setGain(gain: Float) {
        audioProcessor.gain = gain.coerceIn(0.0f, 4.0f)
    }

    fun updateMetering() {
        mainHandler.post {
            val active = PlaybackBridge.pendingMetering && PlaybackBridge.isForeground
            audioProcessor.meteringActive = active
            if (active && !meterTickerRunning) {
                meterTickerRunning = true
                mainHandler.post(meterTicker)
            } else if (!active && meterTickerRunning) {
                meterTickerRunning = false
                mainHandler.removeCallbacks(meterTicker)
                PlaybackBridge.emit("audioLevel", JSONObject().put("bass", 0.0).put("live", false))
            }
        }
    }

    fun loadTrack(req: PlaybackBridge.TrackLoadRequest) {
        mainHandler.post {
            lastEndedSent = false
            audioProcessor.gain = req.normGain.coerceIn(0.0f, 4.0f)
            val metaBuilder = MediaMetadata.Builder()
                .setTitle(req.title)
                .setArtist(req.artist)
                .setAlbumTitle(req.album)
            if (req.artworkUrl.isNotBlank()) {
                metaBuilder.setArtworkUri(Uri.parse(req.artworkUrl))
            }
            val item = MediaItem.Builder()
                .setUri(Uri.parse(req.url))
                .setMediaMetadata(metaBuilder.build())
                .build()
            exoPlayer.setMediaItem(item)
            exoPlayer.prepare()
            exoPlayer.playWhenReady = req.autoplay
            emitState(ended = false, error = null)
        }
    }

    fun play() {
        mainHandler.post { exoPlayer.play() }
    }

    fun pause() {
        mainHandler.post { exoPlayer.pause() }
    }

    fun seekTo(positionMs: Long) {
        mainHandler.post {
            exoPlayer.seekTo(positionMs.coerceAtLeast(0L))
            emitState(ended = false, error = null)
        }
    }

    private fun emitState(ended: Boolean, error: String?) {
        val dur = exoPlayer.duration
        val payload = JSONObject()
            .put("playing", exoPlayer.isPlaying)
            .put("buffering", exoPlayer.playbackState == Player.STATE_BUFFERING)
            .put("positionMs", exoPlayer.currentPosition.coerceAtLeast(0L))
            .put("durationMs", if (dur > 0 && dur != C.TIME_UNSET) dur else 0L)
            .put("ended", ended)
        if (!error.isNullOrBlank()) {
            payload.put("error", error)
        }
        PlaybackBridge.emit("playbackState", payload)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!::exoPlayer.isInitialized || !exoPlayer.playWhenReady) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(progressTicker)
        mainHandler.removeCallbacks(meterTicker)
        meterTickerRunning = false
        PlaybackBridge.service = null
        mediaSession?.release()
        mediaSession = null
        if (::exoPlayer.isInitialized) {
            exoPlayer.release()
        }
        super.onDestroy()
    }
}
