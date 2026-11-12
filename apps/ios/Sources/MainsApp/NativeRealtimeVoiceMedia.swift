import AVFAudio
@preconcurrency import WebRTC

/// Native audio tracks go directly to OpenAI; the Mains socket carries signaling only.
@MainActor
final class NativeRealtimeVoiceMedia: NSObject, RealtimeVoiceMedia {
    private static let initializeSSL: Void = { RTCInitializeSSL() }()
    var onConnected: (() -> Void)?
    var onFailure: ((String) -> Void)?
    var onChannelOpen: (() -> Void)?
    var onLevels: ((Double, Double) -> Void)?
    private var peer: RTCPeerConnection?
    private var channel: RTCDataChannel?
    private var track: RTCAudioTrack?
    private var factory: RTCPeerConnectionFactory?
    private var stats: Task<Void, Never>?
    private var interruption: NSObjectProtocol?
    private var closed = false
    private var ownsAudio = false
    private var hasAnswer = false

    func offer() async throws -> String {
        _ = Self.initializeSSL
        let granted = await AVAudioApplication.requestRecordPermission()
        guard !closed else { throw CancellationError() }
        guard granted else { throw MainsError.server("Allow microphone access in iPhone Settings to start voice chat.") }
        let audio = RTCAudioSession.sharedInstance()
        audio.lockForConfiguration()
        do {
            let configuration = RTCAudioSessionConfiguration.webRTC()
            configuration.category = AVAudioSession.Category.playAndRecord.rawValue
            configuration.mode = AVAudioSession.Mode.voiceChat.rawValue
            configuration.categoryOptions = [.defaultToSpeaker, .allowBluetoothHFP]
            try audio.setConfiguration(configuration, active: true)
            ownsAudio = true
            audio.unlockForConfiguration()
        } catch { audio.unlockForConfiguration(); throw error }
        interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let began = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
            if began { Task { @MainActor [weak self] in self?.onFailure?("Voice chat was interrupted. Start voice again when you’re ready.") } }
        }
        let factory = RTCPeerConnectionFactory(); self.factory = factory
        let configuration = RTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let peer = factory.peerConnection(with: configuration, constraints: constraints, delegate: self) else {
            throw MainsError.server("The voice connection could not be created.")
        }
        self.peer = peer
        let source = factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: [
            "googEchoCancellation": "true", "googNoiseSuppression": "true", "googAutoGainControl": "true",
        ]))
        let track = factory.audioTrack(with: source, trackId: "mains-microphone"); self.track = track
        peer.add(track, streamIds: ["mains-voice"])
        guard let channel = peer.dataChannel(forLabel: "oai-events", configuration: RTCDataChannelConfiguration()) else {
            throw MainsError.server("The voice event channel could not be created.")
        }
        self.channel = channel; channel.delegate = self
        let offer: RTCSessionDescription = try await withCheckedThrowingContinuation { continuation in
            peer.offer(for: RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true"], optionalConstraints: nil)) { description, error in
                if let error { continuation.resume(throwing: error) }
                else if let description { continuation.resume(returning: description) }
                else { continuation.resume(throwing: MainsError.invalidReply) }
            }
        }
        guard !closed else { throw CancellationError() }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            peer.setLocalDescription(offer) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
        guard !closed else { throw CancellationError() }
        return offer.sdp
    }

    func answer(_ sdp: String) async throws {
        guard !closed, let peer, !hasAnswer else { return }
        hasAnswer = true
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            peer.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }
    func send(_ event: JSONValue) throws -> Bool {
        guard !closed, let channel, channel.readyState == .open, channel.bufferedAmount < 64 * 1024 else { return false }
        let data = try JSONEncoder().encode(event)
        return channel.sendData(RTCDataBuffer(data: data, isBinary: false))
    }
    func setMuted(_ muted: Bool) { track?.isEnabled = !muted }
    func close() {
        guard !closed else { return }; closed = true
        onConnected = nil; onFailure = nil; onChannelOpen = nil; onLevels = nil
        stats?.cancel(); stats = nil
        track?.isEnabled = false; track = nil
        channel?.delegate = nil; channel?.close(); channel = nil
        peer?.delegate = nil; peer?.close(); peer = nil; factory = nil
        if let interruption { NotificationCenter.default.removeObserver(interruption) }; interruption = nil
        if ownsAudio {
            ownsAudio = false
            let audio = RTCAudioSession.sharedInstance()
            audio.lockForConfiguration()
            try? audio.setActive(false)
            audio.unlockForConfiguration()
        }
    }
    private func sampleLevels() {
        guard stats == nil else { return }
        stats = Task { [weak self] in
            var previousEnergy: [String: (energy: Double, duration: Double)] = [:]
            while !Task.isCancelled {
                guard let self, !self.closed, let peer = self.peer else { return }
                let report: RTCStatisticsReport = await withCheckedContinuation { continuation in
                    peer.statistics { continuation.resume(returning: $0) }
                }
                guard !self.closed else { return }
                var input = 0.0, output = 0.0
                var nextEnergy: [String: (energy: Double, duration: Double)] = [:]
                for (id, stat) in report.statistics {
                    guard stat.type == "media-source" || stat.type == "inbound-rtp" else { continue }
                    guard stat.values["kind"] as? String == "audio" || stat.values["mediaType"] as? String == "audio" else { continue }
                    var level = (stat.values["audioLevel"] as? NSNumber)?.doubleValue ?? 0
                    // Some native WebRTC reports omit audioLevel. Derive RMS
                    // from interval energy for either existing audio track.
                    if let energy = (stat.values["totalAudioEnergy"] as? NSNumber)?.doubleValue,
                       let duration = (stat.values["totalSamplesDuration"] as? NSNumber)?.doubleValue,
                       energy.isFinite, duration.isFinite {
                        nextEnergy[id] = (energy, duration)
                        if let previous = previousEnergy[id], duration > previous.duration, energy >= previous.energy {
                            level = sqrt((energy - previous.energy) / (duration - previous.duration))
                        }
                    }
                    if stat.type == "media-source" { input = max(input, level) }
                    if stat.type == "inbound-rtp" { output = max(output, level) }
                }
                previousEnergy = nextEnergy
                self.onLevels?(Self.speechLevel(input), Self.speechLevel(output))
                do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
            }
        }
    }

    private static func speechLevel(_ rms: Double) -> Double {
        guard rms.isFinite else { return 0 }
        // Same perceptual curve as the React meter: quiet syllables stay
        // expressive while near silence does not keep the orb agitated.
        return sqrt(min(1, max(0, (rms - 0.0015) / 0.08)))
    }
}

extension NativeRealtimeVoiceMedia: RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCPeerConnectionState) {
        Task { @MainActor [weak self] in
            guard let self, !self.closed, self.peer === peerConnection else { return }
            switch stateChanged {
            case .connected: self.onConnected?(); self.sampleLevels()
            case .failed, .disconnected, .closed: self.onFailure?("Voice connection was lost. Start voice chat again.")
            default: break
            }
        }
    }
    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        Task { @MainActor [weak self] in
            guard let self, !self.closed, self.channel === dataChannel else { return }
            if dataChannel.readyState == .open { self.onChannelOpen?() }
            if dataChannel.readyState == .closed { self.onFailure?("Voice connection was lost. Start voice chat again.") }
        }
    }
    nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
