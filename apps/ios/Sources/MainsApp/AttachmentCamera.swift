import SwiftUI
import AVFoundation
import Observation

@MainActor @Observable
final class AttachmentCamera {
    @ObservationIgnored lazy var engine = CameraEngine()
    var ready = false
    var flashAvailable = false
    var flash = false
    var front = false
    var error: String?
    var permissionDenied = false
    private var active = false

    func start() async {
        active = true; ready = false; error = nil; permissionDenied = false
        guard AVCaptureDevice.default(for: .video) != nil else {
            ready = false; error = "No camera is available on this device."; return
        }
        var authorized = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined { authorized = await AVCaptureDevice.requestAccess(for: .video) }
        guard !Task.isCancelled, active else { return }
        guard authorized else { permissionDenied = true; error = "Allow camera access in Settings to take a photo."; return }
        permissionDenied = false; error = nil
        engine.start(front: front) { [weak self] state in
            guard let self, self.active else { return }
            self.ready = state.ready; self.flashAvailable = state.flashAvailable; self.error = state.error; self.front = state.front
        }
    }
    func stop() { active = false; ready = false; engine.stop() }
    func flip() {
        ready = false; flash = false; front.toggle()
        engine.flip(front: front)
    }
    func capture(_ complete: @escaping @MainActor @Sendable (Result<Data, MainsError>) -> Void) {
        guard ready else { return }
        engine.capture(flash: flash) { [weak self] result in
            guard self?.active == true else { return }
            complete(result)
        }
    }
}

/// Capture configuration, switching, start/stop and shutter calls share one serial queue.
/// Only the preview layer reads `session` on the main thread.
final class CameraEngine: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    struct State: Sendable { var ready: Bool; var flashAvailable = false; var error: String?; var front = false }
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "dev.mains.ios.attachment-camera")
    private let output = AVCapturePhotoOutput()
    private var input: AVCaptureDeviceInput?
    private var active = false
    private var stateChanged: (@MainActor @Sendable (State) -> Void)?
    private var captured: (@MainActor @Sendable (Result<Data, MainsError>) -> Void)?
    private var observations: [NSObjectProtocol] = []

    override init() {
        super.init()
        for name in [AVCaptureSession.wasInterruptedNotification, AVCaptureSession.runtimeErrorNotification] {
            observations.append(NotificationCenter.default.addObserver(forName: name, object: session, queue: nil) { [weak self] _ in
                guard let self else { return }
                self.queue.async {
                    self.report(State(ready: false, error: "The camera was interrupted. Try again when it’s available."))
                    if let complete = self.captured {
                        self.captured = nil
                        Task { @MainActor in complete(.failure(.server("The photo was interrupted. Please try again."))) }
                    }
                }
            })
        }
    }
    deinit { for observation in observations { NotificationCenter.default.removeObserver(observation) } }

    func start(front: Bool, stateChanged: @escaping @MainActor @Sendable (State) -> Void) {
        queue.async {
            self.active = true; self.stateChanged = stateChanged
            do {
                if self.input == nil || !self.session.outputs.contains(self.output) {
                    self.session.beginConfiguration()
                    self.session.sessionPreset = .photo
                    defer { self.session.commitConfiguration() }
                    if self.input == nil { try self.setInput(front: front) }
                    if !self.session.outputs.contains(self.output) {
                        guard self.session.canAddOutput(self.output) else { throw MainsError.server("The camera is unavailable.") }
                        self.session.addOutput(self.output)
                    }
                }
                self.session.startRunning()
                self.report(State(ready: self.session.isRunning, flashAvailable: self.input?.device.hasFlash == true,
                                  error: self.session.isRunning ? nil : "The camera is unavailable. Try again."))
            } catch { self.report(State(ready: false, error: error.localizedDescription)) }
        }
    }
    func stop() {
        queue.async {
            self.active = false; self.stateChanged = nil; self.captured = nil
            if self.session.isRunning { self.session.stopRunning() }
        }
    }
    func flip(front: Bool) {
        queue.async {
            guard self.active, self.captured == nil else { return }
            do {
                self.session.beginConfiguration()
                defer { self.session.commitConfiguration() }
                try self.setInput(front: front)
                self.report(State(ready: true, flashAvailable: self.input?.device.hasFlash == true))
            } catch { self.report(State(ready: true, flashAvailable: self.input?.device.hasFlash == true, error: error.localizedDescription)) }
        }
    }
    private func setInput(front: Bool) throws {
        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: front ? .front : .back)
            ?? (front ? AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front) : nil)
        guard let device else {
            throw MainsError.server("No camera is available on this device.")
        }
        let next = try AVCaptureDeviceInput(device: device)
        let previous = input
        if let previous { session.removeInput(previous) }
        guard session.canAddInput(next) else {
            if let previous, session.canAddInput(previous) { session.addInput(previous) }
            throw MainsError.server("This camera couldn’t be opened.")
        }
        session.addInput(next); input = next
    }
    private func report(_ state: State) {
        guard active, let stateChanged else { return }
        let current = State(ready: state.ready, flashAvailable: state.flashAvailable, error: state.error, front: input?.device.position == .front)
        Task { @MainActor in stateChanged(current) }
    }
    func capture(flash: Bool, complete: @escaping @MainActor @Sendable (Result<Data, MainsError>) -> Void) {
        queue.async {
            guard self.active, self.session.isRunning, self.captured == nil else {
                Task { @MainActor in complete(.failure(.server("The camera is not ready."))) }; return
            }
            self.captured = complete
            let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            settings.flashMode = flash && self.output.supportedFlashModes.contains(.on) ? .on : .off
            if let connection = self.output.connection(with: .video) {
                if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
                if connection.isVideoMirroringSupported {
                    connection.automaticallyAdjustsVideoMirroring = false
                    connection.isVideoMirrored = self.input?.device.position == .front
                }
            }
            self.output.capturePhoto(with: settings, delegate: self)
        }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: (any Error)?) {
        let result: Result<Data, MainsError>
        if let error { result = .failure(.server(error.localizedDescription)) }
        else if let data = photo.fileDataRepresentation() { result = .success(data) }
        else { result = .failure(.server("The photo couldn’t be captured.")) }
        queue.async {
            guard self.active, let complete = self.captured else { return }
            self.captured = nil
            Task { @MainActor in complete(result) }
        }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: (any Error)?) {
        guard let error else { return }
        let message = error.localizedDescription
        queue.async {
            guard self.active, let complete = self.captured else { return }
            self.captured = nil
            Task { @MainActor in complete(.failure(.server(message))) }
        }
    }
}

struct CameraPreview: UIViewRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let camera: AttachmentCamera
    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.isAccessibilityElement = true
        view.accessibilityLabel = "Camera preview"
        view.accessibilityTraits = .image
        view.accessibilityIdentifier = "attachmentCameraPreview"
        view.layerView.session = camera.engine.session
        view.layerView.videoGravity = .resizeAspectFill
        return view
    }
    func updateUIView(_ view: PreviewView, context: Context) {
        if let connection = view.layerView.connection {
            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false; connection.isVideoMirrored = camera.front
            }
        }
    }
    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var layerView: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
