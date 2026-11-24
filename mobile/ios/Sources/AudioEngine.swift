import AVFoundation
import MediaPlayer
import UIKit

/// Lock-free shared audio state passed to MTAudioProcessingTap callbacks.
private final class AudioTapState {
    var gain: Float = 1.0
    var meteringActive: Bool = false
    var isFloat32: Bool = true
    var bassLevel: Float = 0.0
    var lpState: Float = 0.0
    var sampleRate: Float = 44100.0
}

private let tapInitCallback: MTAudioProcessingTapInitCallback = { tap, clientInfo, tapStorageOut in
    tapStorageOut.pointee = clientInfo
}

private let tapFinalizeCallback: MTAudioProcessingTapFinalizeCallback = { tap in
    let storage = MTAudioProcessingTapGetStorage(tap)
    Unmanaged<AudioTapState>.fromOpaque(storage).release()
}

private let tapPrepareCallback: MTAudioProcessingTapPrepareCallback = { tap, _, processingFormat in
    let state = Unmanaged<AudioTapState>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
    let fmt = processingFormat.pointee
    let sr = Float(fmt.mSampleRate)
    if sr > 0 {
        state.sampleRate = sr
    }
    state.isFloat32 = (fmt.mFormatFlags & kAudioFormatFlagIsFloat) != 0 && fmt.mBitsPerChannel == 32
    state.lpState = 0
}

private let tapUnprepareCallback: MTAudioProcessingTapUnprepareCallback = { tap in
    let state = Unmanaged<AudioTapState>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
    state.lpState = 0
    state.bassLevel = 0
}

private let tapProcessCallback: MTAudioProcessingTapProcessCallback = {
    tap, numberFrames, _, bufferListInOut, numberFramesOut, flagsOut in
    var timeRange = CMTimeRange.zero
    let status = MTAudioProcessingTapGetSourceAudio(
        tap,
        numberFrames,
        bufferListInOut,
        flagsOut,
        &timeRange,
        numberFramesOut
    )
    guard status == noErr else { return }

    let frames = Int(numberFramesOut.pointee)
    guard frames > 0 else { return }

    let state = Unmanaged<AudioTapState>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
    guard state.isFloat32 else { return }
    let gain = state.gain
    let meter = state.meteringActive
    let needGain = abs(gain - 1.0) > 0.001
    if !needGain && !meter {
        return
    }

    let abl = UnsafeMutableAudioBufferListPointer(bufferListInOut)
    guard abl.count > 0 else { return }

    // Apply gain with soft clipping across all Float32 buffers.
    if needGain {
        for i in 0..<abl.count {
            let buf = abl[i]
            guard let raw = buf.mData else { continue }
            let count = Int(buf.mDataByteSize) / MemoryLayout<Float>.size
            let samples = raw.assumingMemoryBound(to: Float.self)
            for j in 0..<count {
                var v = samples[j] * gain
                if v > 1.0 {
                    v = 1.0
                } else if v < -1.0 {
                    v = -1.0
                }
                samples[j] = v
            }
        }
    }

    // Lightweight 1-pole low-pass (~200 Hz) RMS energy estimator on channel 0.
    if meter, let raw = abl[0].mData {
        let channels = max(1, Int(abl[0].mNumberChannels))
        let count = Int(abl[0].mDataByteSize) / MemoryLayout<Float>.size
        let samples = raw.assumingMemoryBound(to: Float.self)
        let dt = 1.0 / max(state.sampleRate, 8000.0)
        let rc: Float = 1.0 / (2.0 * Float.pi * 200.0)
        let alpha = dt / (rc + dt)
        var lp = state.lpState
        var sumSq: Float = 0.0
        var n = 0
        var idx = 0
        while idx < count {
            let s = samples[idx]
            lp += alpha * (s - lp)
            sumSq += lp * lp
            n += 1
            idx += channels
        }
        state.lpState = lp
        if n > 0 {
            let rms = sqrtf(sumSq / Float(n))
            let db: Float = rms > 1e-6 ? 20.0 * log10f(rms) : -96.0
            let norm = max(0.0, min(1.0, (db + 52.0) / 44.0))
            let prev = state.bassLevel
            let smooth = norm > prev ? prev + (norm - prev) * 0.45 : prev + (norm - prev) * 0.16
            state.bassLevel = smooth
        }
    }
}

final class AudioEngine: NSObject {
    static let shared = AudioEngine()

    var onEvent: ((String, [String: Any]) -> Void)?

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var itemStatusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var currentArtwork: MPMediaItemArtwork?
    private var currentTitle: String = ""
    private var currentArtist: String = ""
    private var currentAlbum: String = ""
    private var currentDurationSec: Double = 0
    private var artworkTask: URLSessionDataTask?

    private var currentGain: Float = 1.0
    private var activeTapState: AudioTapState?
    private var tapAttached: Bool = false
    private var meteringEnabled: Bool = false
    private var foregroundActive: Bool = true
    private var meterTimer: Timer?
    private var lastEmittedBass: Double = 0.0
    private var loadGeneration: Int = 0

    private override init() {
        super.init()
        configureAudioSession()
        configureRemoteCommands()
        observeAudioNotifications()
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            NSLog("MyGo AudioSession error: %@", error.localizedDescription)
        }
    }

    private func observeAudioNotifications() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChange(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleWillResignActive),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
    }

    @objc private func handleDidBecomeActive() {
        foregroundActive = true
        syncMeteringState()
    }

    @objc private func handleWillResignActive() {
        foregroundActive = false
        syncMeteringState()
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let typeVal = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeVal) else { return }
        switch type {
        case .began:
            player?.pause()
            emitState()
        case .ended:
            if let optVal = info[AVAudioSessionInterruptionOptionKey] as? UInt {
                let options = AVAudioSession.InterruptionOptions(rawValue: optVal)
                if options.contains(.shouldResume) {
                    try? AVAudioSession.sharedInstance().setActive(true)
                    player?.play()
                    emitState()
                }
            }
        @unknown default:
            break
        }
    }

    @objc private func handleRouteChange(_ note: Notification) {
        guard let info = note.userInfo,
              let reasonVal = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonVal) else { return }
        if reason == .oldDeviceUnavailable {
            player?.pause()
            emitState()
        }
    }

    private func configureRemoteCommands() {
        let cc = MPRemoteCommandCenter.shared()

        cc.playCommand.isEnabled = true
        cc.playCommand.addTarget { [weak self] _ in
            self?.play()
            self?.onEvent?("remoteCommand", ["command": "play"])
            return .success
        }

        cc.pauseCommand.isEnabled = true
        cc.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            self?.onEvent?("remoteCommand", ["command": "pause"])
            return .success
        }

        cc.togglePlayPauseCommand.isEnabled = true
        cc.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.onEvent?("remoteCommand", ["command": "toggle"])
            return .success
        }

        cc.nextTrackCommand.isEnabled = true
        cc.nextTrackCommand.addTarget { [weak self] _ in
            self?.onEvent?("remoteCommand", ["command": "next"])
            return .success
        }

        cc.previousTrackCommand.isEnabled = true
        cc.previousTrackCommand.addTarget { [weak self] _ in
            self?.onEvent?("remoteCommand", ["command": "previous"])
            return .success
        }

        cc.changePlaybackPositionCommand.isEnabled = true
        cc.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let posEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            let ms = Int64(posEvent.positionTime * 1000.0)
            self?.seek(positionMs: ms)
            self?.onEvent?("remoteCommand", ["command": "seek", "positionMs": ms])
            return .success
        }
    }

    func setGain(_ gain: Double) {
        let clamped = Float(max(0.0, min(gain.isFinite ? gain : 1.0, 4.0)))
        currentGain = clamped
        if tapAttached, let st = activeTapState {
            st.gain = clamped
            player?.volume = 1.0
        } else {
            player?.volume = min(clamped, 1.0)
        }
    }

    func setMetering(enabled: Bool) {
        meteringEnabled = enabled
        syncMeteringState()
    }

    private func syncMeteringState() {
        let active = meteringEnabled && foregroundActive
        activeTapState?.meteringActive = active
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if active {
                if self.meterTimer == nil {
                    self.meterTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                        self?.emitAudioLevelTick()
                    }
                }
            } else {
                let wasRunning = self.meterTimer != nil
                self.meterTimer?.invalidate()
                self.meterTimer = nil
                self.lastEmittedBass = 0.0
                if wasRunning {
                    self.onEvent?("audioLevel", ["bass": 0.0, "live": false])
                }
            }
        }
    }

    private func emitAudioLevelTick() {
        guard meteringEnabled && foregroundActive else { return }
        let playing = player?.timeControlStatus == .playing
        if !playing {
            lastEmittedBass *= 0.8
            if lastEmittedBass < 0.001 { lastEmittedBass = 0.0 }
            onEvent?("audioLevel", ["bass": lastEmittedBass, "live": tapAttached])
            return
        }
        if tapAttached, let st = activeTapState {
            let raw = Double(st.bassLevel)
            let safe = raw.isFinite ? max(0.0, min(1.0, raw)) : 0.0
            lastEmittedBass = safe
            onEvent?("audioLevel", ["bass": safe, "live": true])
        } else {
            lastEmittedBass = 0.0
            onEvent?("audioLevel", ["bass": 0.0, "live": false])
        }
    }

    func load(
        urlString: String,
        title: String,
        artist: String,
        album: String,
        artworkUrl: String,
        durationMs: Double,
        autoplay: Bool,
        normGain: Double = 1.0
    ) {
        guard let url = URL(string: urlString) else {
            emitState(error: "Invalid stream URL")
            return
        }

        configureAudioSession()
        cleanupCurrentItem()

        loadGeneration += 1
        let gen = loadGeneration

        currentTitle = title
        currentArtist = artist
        currentAlbum = album
        currentDurationSec = durationMs / 1000.0
        currentArtwork = nil
        currentGain = Float(max(0.0, min(normGain.isFinite ? normGain : 1.0, 4.0)))
        tapAttached = false
        activeTapState = nil

        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        if player == nil {
            let p = AVPlayer(playerItem: item)
            p.automaticallyWaitsToMinimizeStalling = true
            player = p
            attachPlayerObservers(p)
        } else {
            player?.replaceCurrentItem(with: item)
        }
        // Start with fallback volume until the audio tap attaches cleanly.
        player?.volume = min(currentGain, 1.0)

        itemStatusObservation = item.observe(\.status, options: [.new]) { [weak self] observed, _ in
            guard let self else { return }
            switch observed.status {
            case .failed:
                let msg = observed.error?.localizedDescription ?? "Playback failed"
                self.emitState(error: msg)
            case .readyToPlay:
                let d = observed.duration.seconds
                if d.isFinite && d > 0 {
                    self.currentDurationSec = d
                }
                self.attachAudioProcessingTap(to: observed, generation: gen)
                self.updateNowPlaying()
                self.emitState()
            default:
                break
            }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.emitState(ended: true)
        }

        if autoplay {
            player?.play()
        }
        updateNowPlaying()
        fetchArtwork(artworkUrl)
        syncMeteringState()
        emitState()
    }

    private func attachAudioProcessingTap(to item: AVPlayerItem, generation: Int) {
        Task { [weak self] in
            guard let self else { return }
            guard let tracks = try? await item.asset.loadTracks(withMediaType: .audio),
                  let track = tracks.first else {
                return
            }

            let state = AudioTapState()
            state.gain = self.currentGain
            state.meteringActive = self.meteringEnabled && self.foregroundActive

            var callbacks = MTAudioProcessingTapCallbacks(
                version: kMTAudioProcessingTapCallbacksVersion_0,
                clientInfo: Unmanaged.passRetained(state).toOpaque(),
                init: tapInitCallback,
                finalize: tapFinalizeCallback,
                prepare: tapPrepareCallback,
                unprepare: tapUnprepareCallback,
                process: tapProcessCallback
            )
            var tapOut: MTAudioProcessingTap?
            let err = MTAudioProcessingTapCreate(
                kCFAllocatorDefault,
                &callbacks,
                kMTAudioProcessingTapCreationFlag_PostEffects,
                &tapOut
            )
            guard err == noErr, let tap = tapOut else {
                Unmanaged.passUnretained(state).release()
                return
            }

            let params = AVMutableAudioMixInputParameters(track: track)
            params.audioTapProcessor = tap
            let mix = AVMutableAudioMix()
            mix.inputParameters = [params]

            DispatchQueue.main.async { [weak self] in
                guard let self, self.loadGeneration == generation, self.player?.currentItem === item else {
                    return
                }
                item.audioMix = mix
                self.activeTapState = state
                self.tapAttached = true
                self.player?.volume = 1.0
                state.gain = self.currentGain
                state.meteringActive = self.meteringEnabled && self.foregroundActive
            }
        }
    }

    private func attachPlayerObservers(_ p: AVPlayer) {
        timeControlObservation = p.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            self?.updateNowPlaying()
            self?.emitState()
        }
        timeObserver = p.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
            queue: .main
        ) { [weak self] _ in
            self?.updateNowPlaying()
            self?.emitState()
        }
    }

    private func cleanupCurrentItem() {
        itemStatusObservation?.invalidate()
        itemStatusObservation = nil
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
        artworkTask?.cancel()
        artworkTask = nil
    }

    func play() {
        configureAudioSession()
        player?.play()
        updateNowPlaying()
        emitState()
    }

    func pause() {
        player?.pause()
        updateNowPlaying()
        emitState()
    }

    func seek(positionMs: Int64) {
        let sec = max(0.0, Double(positionMs) / 1000.0)
        let target = CMTime(seconds: sec, preferredTimescale: 600)
        player?.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            self?.updateNowPlaying()
            self?.emitState()
        }
    }

    private func fetchArtwork(_ rawUrl: String) {
        artworkTask?.cancel()
        guard !rawUrl.isEmpty, let url = URL(string: rawUrl) else { return }
        artworkTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data, let image = UIImage(data: data) else { return }
            let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                self.currentArtwork = art
                self.updateNowPlaying()
            }
        }
        artworkTask?.resume()
    }

    private func updateNowPlaying() {
        guard let p = player else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: currentTitle,
            MPMediaItemPropertyArtist: currentArtist,
            MPMediaItemPropertyAlbumTitle: currentAlbum,
            MPNowPlayingInfoPropertyPlaybackRate: p.timeControlStatus == .playing ? 1.0 : 0.0,
        ]
        let pos = p.currentTime().seconds
        if pos.isFinite && pos >= 0 {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = pos
        }
        if currentDurationSec.isFinite && currentDurationSec > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = currentDurationSec
        }
        if let art = currentArtwork {
            info[MPMediaItemPropertyArtwork] = art
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func emitState(ended: Bool = false, error: String? = nil) {
        let playing = player?.timeControlStatus == .playing
        let buffering = player?.timeControlStatus == .waitingToPlayAtSpecifiedRate
        let posSec = player?.currentTime().seconds ?? 0
        let posMs = (posSec.isFinite && posSec >= 0) ? Int64(posSec * 1000.0) : 0
        let durMs = (currentDurationSec.isFinite && currentDurationSec > 0) ? Int64(currentDurationSec * 1000.0) : 0

        var payload: [String: Any] = [
            "playing": playing,
            "buffering": buffering,
            "positionMs": posMs,
            "durationMs": durMs,
            "ended": ended,
        ]
        if let error {
            payload["error"] = error
        }
        onEvent?("playbackState", payload)
    }
}
