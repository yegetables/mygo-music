import AVFoundation
import MediaPlayer
import UIKit

final class AudioEngine {
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

    private init() {
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

    func load(
        urlString: String,
        title: String,
        artist: String,
        album: String,
        artworkUrl: String,
        durationMs: Double,
        autoplay: Bool
    ) {
        guard let url = URL(string: urlString) else {
            emitState(error: "Invalid stream URL")
            return
        }

        configureAudioSession()
        cleanupCurrentItem()

        currentTitle = title
        currentArtist = artist
        currentAlbum = album
        currentDurationSec = durationMs / 1000.0
        currentArtwork = nil

        let item = AVPlayerItem(url: url)
        if player == nil {
            let p = AVPlayer(playerItem: item)
            p.automaticallyWaitsToMinimizeStalling = true
            player = p
            attachPlayerObservers(p)
        } else {
            player?.replaceCurrentItem(with: item)
        }

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
        emitState()
    }

    private func attachPlayerObservers(_ p: AVPlayer) {
        timeControlObservation = p.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            self?.updateNowPlaying()
            self?.emitState()
        }
        timeObserver = p.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
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
        let elapsed = p.currentTime().seconds
        let dur = p.currentItem?.duration.seconds ?? currentDurationSec
        let effectiveDur = (dur.isFinite && dur > 0) ? dur : currentDurationSec

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: currentTitle,
            MPMediaItemPropertyArtist: currentArtist,
            MPMediaItemPropertyAlbumTitle: currentAlbum,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed.isFinite ? max(0, elapsed) : 0,
            MPNowPlayingInfoPropertyPlaybackRate: p.timeControlStatus == .playing ? 1.0 : 0.0,
        ]
        if effectiveDur > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = effectiveDur
        }
        if let currentArtwork {
            info[MPMediaItemPropertyArtwork] = currentArtwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func emitState(ended: Bool = false, error: String? = nil) {
        let p = player
        let elapsed = p?.currentTime().seconds ?? 0
        let dur = p?.currentItem?.duration.seconds ?? currentDurationSec
        let effectiveDur = (dur.isFinite && dur > 0) ? dur : currentDurationSec

        var payload: [String: Any] = [
            "playing": p?.timeControlStatus == .playing,
            "buffering": p?.timeControlStatus == .waitingToPlayAtSpecifiedRate,
            "positionMs": Int64((elapsed.isFinite ? max(0, elapsed) : 0) * 1000.0),
            "durationMs": Int64(max(0, effectiveDur) * 1000.0),
            "ended": ended,
        ]
        if let error, !error.isEmpty {
            payload["error"] = error
        }
        onEvent?("playbackState", payload)
    }
}
