import AVFoundation
import OSLog
import Speech
import SwiftUI

@MainActor @Observable
final class ComposerDictation {
    // AVAudioSession is shared by every composer, including retained readers.
    static let shared = ComposerDictation()
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "dev.mains", category: "Dictation")

    enum Phase { case preparing, listening, finishing }

    private(set) var owner: UUID?
    private(set) var phase: Phase = .preparing
    private(set) var transcript = ""
    private(set) var levels: [CGFloat] = []
    private(set) var error: String?

    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var capture: DictationAudioCapture?
    @ObservationIgnored private var analyzer: SpeechAnalyzer?
    @ObservationIgnored private var finish: ((String) -> Void)?
    @ObservationIgnored private var attempt: UUID?
    @ObservationIgnored private var interruption: (any NSObjectProtocol)?

    private init() {}

    func start(owner: UUID, language: String?, preview: Bool) {
        guard self.owner == nil else { return }
        self.owner = owner
        let attempt = UUID()
        self.attempt = attempt
        phase = .preparing
        transcript = ""
        levels = []
        error = nil

        #if DEBUG && targetEnvironment(simulator)
        if preview {
            phase = .listening
            operation = Task {
                do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
                guard self.attempt == attempt else { return }
                transcript = "This is a dictated message."
                levels = [0.04, 0.12, 0.45, 0.66, 0.35, 0.24, 0.12, 0.03]
            }
            return
        }
        #endif

        operation = Task { await record(attempt: attempt, locale: language.map(Locale.init(identifier:)) ?? .current) }
    }

    func stop(owner: UUID, completion: @escaping (String) -> Void) {
        guard self.owner == owner, phase != .finishing else { return }
        guard phase == .listening, let capture, let analyzer else {
            let text = transcript
            reset()
            completion(text)
            return
        }
        phase = .finishing
        finish = completion
        capture.stop()
        self.capture = nil
        let attempt = self.attempt
        Task {
            do { try await analyzer.finalizeAndFinishThroughEndOfInput() }
            catch {
                if self.attempt == attempt { report(error, stage: "finalizing", fallback: .recognitionUnavailable) }
            }
        }
    }

    func cancel(owner: UUID) {
        if self.owner == owner { reset() }
    }

    private func record(attempt: UUID, locale: Locale) async {
        var stage = "language model"
        var fallback = Failure.modelUnavailable
        do {
            let allowed = await AVAudioApplication.requestRecordPermission()
            try check(attempt)
            guard allowed else { throw Failure.microphoneDenied }
            let supported = await DictationTranscriber.supportedLocale(equivalentTo: locale)
            try check(attempt)
            guard let supported else { throw Failure.languageUnavailable }
            let transcriber = DictationTranscriber(locale: supported, preset: .progressiveShortDictation)
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try check(attempt)
                try await request.downloadAndInstall()
            }
            try check(attempt)

            let input = AsyncStream.makeStream(of: AnalyzerInput.self, bufferingPolicy: .bufferingOldest(64))
            let capture = DictationAudioCapture(input: input.continuation)
            self.capture = capture
            stage = "microphone route"
            fallback = .audioUnavailable
            let nativeFormat = try await capture.prepare()
            try check(attempt)

            stage = "model audio format"
            fallback = .modelUnavailable
            guard let preferred = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber], considering: nativeFormat) else {
                throw Failure.modelUnavailable
            }
            let alternatives = await transcriber.availableCompatibleAudioFormats
            try check(attempt)
            stage = "audio conversion"
            fallback = .audioUnavailable
            guard let converter = ([preferred] + alternatives).lazy.compactMap({
                AVAudioConverter(from: nativeFormat, to: $0)
            }).first else {
                Self.logger.error("No dictation converter from \(nativeFormat.description, privacy: .public) to \(preferred.description, privacy: .public)")
                throw Failure.audioUnavailable
            }
            let analyzer = SpeechAnalyzer(modules: [transcriber])
            self.analyzer = analyzer
            stage = "analyzer startup"
            fallback = .modelUnavailable
            try await analyzer.prepareToAnalyze(in: converter.outputFormat)
            try check(attempt)

            try await analyzer.start(inputSequence: input.stream)
            try check(attempt)

            interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
                guard note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt == AVAudioSession.InterruptionType.began.rawValue else { return }
                Task { @MainActor [weak self] in
                    if self?.attempt == attempt, self?.phase == .listening { self?.fail(String(localized: "Dictation was interrupted.")) }
                }
            }
            stage = "microphone startup"
            fallback = .audioUnavailable
            try capture.start(converter: converter) { [weak self] level in
                guard let self, self.attempt == attempt, self.phase == .listening else { return }
                self.levels.append(level)
                if self.levels.count > 64 { self.levels.removeFirst() }
            } onFailure: { [weak self] in
                if self?.attempt == attempt, self?.phase == .listening { self?.fail(Failure.audioUnavailable.localizedDescription) }
            }
            phase = .listening

            stage = "transcription"
            fallback = .recognitionUnavailable
            var finalized = ""
            for try await result in transcriber.results {
                try check(attempt)
                let text = String(result.text.characters)
                if result.isFinal { finalized += text }
                transcript = result.isFinal ? finalized : finalized + text
            }
            try check(attempt)
            let completion = finish
            reset()
            completion?(finalized)
        } catch {
            if self.attempt == attempt { report(error, stage: stage, fallback: fallback) }
        }
    }

    private func check(_ attempt: UUID) throws {
        guard self.attempt == attempt, !Task.isCancelled else { throw CancellationError() }
    }

    private func report(_ error: any Error, stage: String, fallback: Failure) {
        let information = error as NSError
        Self.logger.error("Dictation failed at \(stage, privacy: .public): \(information.domain, privacy: .public) (\(information.code))")
        fail(((error as? Failure) ?? fallback).localizedDescription)
    }

    private func fail(_ message: String) {
        let failedOwner = owner
        let completion = finish
        let text = transcript
        reset()
        owner = failedOwner
        error = message
        completion?(text)
    }

    func dismissError(owner: UUID) {
        if self.owner == owner, error != nil { reset() }
    }

    private func reset() {
        attempt = nil
        capture?.stop()
        capture = nil
        operation?.cancel()
        operation = nil
        if let analyzer { Task { await analyzer.cancelAndFinishNow() } }
        analyzer = nil
        if let interruption { NotificationCenter.default.removeObserver(interruption) }
        interruption = nil
        finish = nil
        owner = nil
        transcript = ""
        levels = []
        error = nil
    }

    fileprivate enum Failure: LocalizedError {
        case microphoneDenied, languageUnavailable, modelUnavailable, audioUnavailable, recognitionUnavailable

        var errorDescription: String? {
            switch self {
            case .microphoneDenied: String(localized: "Allow microphone access in iPhone Settings to use dictation.")
            case .languageUnavailable: String(localized: "Apple Dictation doesn’t support this keyboard language on this iPhone.")
            case .modelUnavailable: String(localized: "The dictation language model couldn’t start. Try again, or use the microphone on the iPhone keyboard.")
            case .audioUnavailable: String(localized: "Dictation couldn’t open the current microphone. Try again or switch audio devices.")
            case .recognitionUnavailable: String(localized: "Dictation stopped before it could finish. Try again.")
            }
        }
    }
}

@MainActor
private final class DictationAudioCapture {
    private var engine: AVAudioEngine?
    private let input: AsyncStream<AnalyzerInput>.Continuation
    private var hasTap = false
    private var sessionConfiguration: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
    private var configurationChange: (any NSObjectProtocol)?

    init(input: AsyncStream<AnalyzerInput>.Continuation) { self.input = input }

    func prepare() async throws -> AVAudioFormat {
        let session = AVAudioSession.sharedInstance()
        sessionConfiguration = (session.category, session.mode, session.categoryOptions)
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.allowBluetoothHFP])
        try session.setActive(true)
        // The permission prompt and Bluetooth handoff can leave the route briefly unavailable.
        for delay in [0, 100, 250] {
            if delay != 0 { try await Task.sleep(for: .milliseconds(delay)) }
            try Task.checkCancellation()
            let engine = AVAudioEngine()
            let node = engine.inputNode
            let hardware = node.inputFormat(forBus: 0)
            let format = node.outputFormat(forBus: 0)
            if hardware.channelCount > 0, hardware.sampleRate > 0, format.channelCount > 0, format.sampleRate > 0 {
                self.engine = engine
                return format
            }
        }
        throw ComposerDictation.Failure.audioUnavailable
    }

    func start(converter: AVAudioConverter, onLevel: @escaping @MainActor @Sendable (CGFloat) -> Void,
               onFailure: @escaping @MainActor @Sendable () -> Void) throws {
        guard let engine else { throw ComposerDictation.Failure.audioUnavailable }
        let node = engine.inputNode
        guard node.outputFormat(forBus: 0) == converter.inputFormat else { throw ComposerDictation.Failure.audioUnavailable }
        let tap = Self.makeTap(converter: converter, input: input, onLevel: onLevel, onFailure: onFailure)
        node.installTap(onBus: 0, bufferSize: 2048, format: nil, block: tap)
        hasTap = true
        try engine.start()
        configurationChange = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
        ) { _ in
            Task { await onFailure() }
        }
    }

    func stop() {
        if let configurationChange { NotificationCenter.default.removeObserver(configurationChange) }
        configurationChange = nil
        engine?.stop()
        if hasTap { engine?.inputNode.removeTap(onBus: 0); hasTap = false }
        engine = nil
        input.finish()
        if let (category, mode, options) = sessionConfiguration {
            let session = AVAudioSession.sharedInstance()
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            try? session.setCategory(category, mode: mode, options: options)
            sessionConfiguration = nil
        }
    }

    // Construct the callback outside MainActor. The converter is used only by the audio tap.
    private nonisolated static func makeTap(
        converter: AVAudioConverter, input: AsyncStream<AnalyzerInput>.Continuation,
        onLevel: @escaping @MainActor @Sendable (CGFloat) -> Void,
        onFailure: @escaping @MainActor @Sendable () -> Void
    ) -> AVAudioNodeTapBlock {
        let format = converter.outputFormat
        var lastMeterTime: TimeInterval = 0
        var failed = false
        return { buffer, _ in
            guard !failed, buffer.frameLength > 0 else { return }
            let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate)) + 32
            guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
            var consumed = false
            let status = converter.convert(to: converted, error: nil) { _, status in
                status.pointee = consumed ? .noDataNow : .haveData
                if consumed { return nil }
                consumed = true
                return buffer
            }
            if status == .error {
                failed = true
                Task { await onFailure() }
                return
            }
            if converted.frameLength > 0, case .dropped = input.yield(AnalyzerInput(buffer: converted)) {
                failed = true
                Task { await onFailure() }
                return
            }

            let now = ProcessInfo.processInfo.systemUptime
            if now - lastMeterTime >= 0.055, let samples = buffer.floatChannelData?[0] {
                lastMeterTime = now
                var squares: Float = 0
                let count = Int(buffer.frameLength)
                for index in 0..<count {
                    let sample = samples[index * buffer.stride]
                    squares += sample * sample
                }
                let rms = sqrt(squares / Float(count))
                let level = CGFloat(max(0, min(1, (20 * log10(max(rms, 0.0001)) + 54) / 42)))
                Task { await onLevel(level) }
            }
        }
    }
}

struct ComposerDictationMeter: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let dictation: ComposerDictation
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let levels = dictation.levels
        Canvas { context, size in
            let step: CGFloat = 5
            let count = Int(size.width / step)
            guard count > 0 else { return }
            let left = (size.width - CGFloat(count - 1) * step) / 2
            for index in 0..<count {
                let input = levels.count - count + index
                let level = !reduceMotion && input >= 0 ? levels[input] : 0
                let height = 4 + level * 20
                let rect = CGRect(x: left + CGFloat(index) * step - 1, y: (size.height - height) / 2, width: 2, height: height)
                let opacity = min(0.85, CGFloat(min(index, count - 1 - index) + 1) / 4)
                context.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(.secondary.opacity(opacity)))
            }
        }
        .frame(height: MessageComposer.controlHeight)
        .accessibilityHidden(true)
    }
}
