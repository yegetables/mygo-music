package dev.egoist.music

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Lightweight ExoPlayer AudioProcessor that:
 * 1. Applies track loudness normalization gain (supporting > 1.0x boost with clipping protection).
 * 2. Computes a 1-pole low-pass (~200 Hz) bass RMS level ONLY when meteringActive is true.
 */
@OptIn(UnstableApi::class)
class GainAndMeterAudioProcessor : BaseAudioProcessor() {

    @Volatile
    var gain: Float = 1.0f

    @Volatile
    var meteringActive: Boolean = false

    @Volatile
    var bassLevel: Float = 0.0f
        private set

    private var lpState: Float = 0.0f

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT ||
            inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
        ) {
            return inputAudioFormat
        }
        return AudioProcessor.AudioFormat.NOT_SET
    }

    override fun onFlush() {
        lpState = 0.0f
        bassLevel = 0.0f
    }

    override fun onReset() {
        lpState = 0.0f
        bassLevel = 0.0f
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val remaining = inputBuffer.remaining()
        if (remaining <= 0) return

        val g = gain
        val meter = meteringActive
        val needGain = abs(g - 1.0f) > 0.001f

        val out = replaceOutputBuffer(remaining)
        if (!needGain && !meter) {
            out.put(inputBuffer)
            out.flip()
            return
        }

        val sr = max(inputAudioFormat.sampleRate, 8000).toFloat()
        val ch = max(inputAudioFormat.channelCount, 1)
        val dt = 1.0f / sr
        val rc = 1.0f / (2.0f * PI.toFloat() * 200.0f)
        val alpha = dt / (rc + dt)

        var lp = lpState
        var sumSq = 0.0f
        var frameCount = 0

        if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT) {
            var chIdx = 0
            while (inputBuffer.remaining() >= 2) {
                val raw = inputBuffer.short.toInt()
                var norm = raw / 32768.0f
                if (needGain) {
                    norm *= g
                    if (norm > 1.0f) norm = 1.0f else if (norm < -1.0f) norm = -1.0f
                    val scaled = (norm * 32767.0f).roundToInt().coerceIn(-32768, 32767)
                    out.putShort(scaled.toShort())
                } else {
                    out.putShort(raw.toShort())
                }
                if (meter && chIdx == 0) {
                    lp += alpha * (norm - lp)
                    sumSq += lp * lp
                    frameCount++
                }
                chIdx++
                if (chIdx >= ch) chIdx = 0
            }
            while (inputBuffer.hasRemaining()) {
                out.put(inputBuffer.get())
            }
        } else if (inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) {
            var chIdx = 0
            while (inputBuffer.remaining() >= 4) {
                var v = inputBuffer.float
                if (needGain) {
                    v *= g
                    if (v > 1.0f) v = 1.0f else if (v < -1.0f) v = -1.0f
                }
                out.putFloat(v)
                if (meter && chIdx == 0) {
                    lp += alpha * (v - lp)
                    sumSq += lp * lp
                    frameCount++
                }
                chIdx++
                if (chIdx >= ch) chIdx = 0
            }
            while (inputBuffer.hasRemaining()) {
                out.put(inputBuffer.get())
            }
        }

        lpState = lp
        if (meter && frameCount > 0) {
            val rms = sqrt(sumSq / frameCount.toFloat())
            val db = if (rms > 1e-6f) 20.0f * log10(rms) else -96.0f
            val level = max(0.0f, min(1.0f, (db + 52.0f) / 44.0f))
            val prev = bassLevel
            bassLevel = if (level > prev) prev + (level - prev) * 0.45f else prev + (level - prev) * 0.16f
        } else if (!meter) {
            bassLevel = 0.0f
        }

        out.flip()
    }
}
