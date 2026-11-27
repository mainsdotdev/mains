import SwiftUI
import AVFoundation
import VisionKit

struct PairingView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private enum EntryMode { case camera, manual }
    let session: BackendSession
    let initialLink: String
    let showsCompletion: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var entryMode: EntryMode
    @State private var text: String
    @State private var error: String?
    @State private var review: PairingLink?
    @State private var cameraReady = false
    @State private var cameraIssue: String?
    @State private var demoError: String?
    @State private var pairingTask: Task<Void, Never>?
    @State private var pairedComputerName: String?
    @FocusState private var editingLink: Bool
    private var wantsCamera: Bool { entryMode == .camera && scenePhase == .active && pairedComputerName == nil }

    init(session: BackendSession, initialLink: String = "", showsCompletion: Bool = false) {
        self.session = session; self.initialLink = initialLink
        self.showsCompletion = showsCompletion
        _text = State(initialValue: initialLink)
        _entryMode = State(initialValue: initialLink.isEmpty && DataScannerViewController.isSupported ? .camera : .manual)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Color.clear.frame(width: 46, height: 46).accessibilityHidden(true)
                Text("Pair a Computer")
                    .font(.title3.weight(.semibold).width(.expanded))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                RoundControl(symbol: "xmark", label: "Close pairing") {
                    pairingTask?.cancel(); dismiss()
                }.accessibilityIdentifier("closePairing")
            }
            .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 24)

            if let pairedComputerName { completion(for: pairedComputerName) }
            else { pairingEntry }
        }
        .background(Color(.secondarySystemBackground))
        .toolbar(.hidden, for: .navigationBar)
        .tint(AppBrand.accent)
        .presentationDetents([.large])
        .presentationDragIndicator(.hidden)
        .presentationCornerRadius(36)
        .presentationBackground(Color(.secondarySystemBackground))
        .interactiveDismissDisabled(session.pairingInProgress)
        .onAppear { if !initialLink.isEmpty { reviewLink(initialLink) } }
        .onChange(of: initialLink) { _, value in
            guard !session.pairingInProgress, pairedComputerName == nil else { return }
            switchTo(.manual); text = value; reviewLink(value)
        }
        .task(id: wantsCamera) {
            if wantsCamera { await prepareCamera() }
            else { cameraReady = false }
        }
        .onDisappear { pairingTask?.cancel() }
    }

    private var pairingEntry: some View {
        ScrollView {
            VStack(spacing: 16) {
                if entryMode == .camera { camera }
                else { manualEntry }
                status
                if !session.pairingInProgress && (review == nil || entryMode == .manual) {
                    Button(entryMode == .camera ? "No camera? Paste a link" : "Use the camera instead") {
                        switchTo(entryMode == .camera ? .manual : .camera)
                    }
                    .font(.body.weight(.semibold)).foregroundStyle(AppBrand.accent)
                    .frame(minHeight: 44).padding(.top, 8)
                    .accessibilityIdentifier("switchPairingEntry")
                }
                if session.pairing == nil {
                    VStack(spacing: 12) {
                        Text("No computer to pair? Explore Mains with sample data.")
                            .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button("Try Demo Mode") {
                            do { try session.startDemo(); dismiss() }
                            catch { demoError = error.localizedDescription }
                        }
                        .font(.body.weight(.semibold)).foregroundStyle(AppBrand.accent).frame(minHeight: 44)
                        .disabled(session.pairingInProgress).accessibilityIdentifier("startDemoFromPairing")
                        if let demoError { Text(demoError).font(.footnote).foregroundStyle(.red) }
                    }.padding(.top, 28)
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 32)
            .frame(maxWidth: 600).frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func completion(for name: String) -> some View {
        VStack(spacing: 20) {
            ZStack {
                RoundedRectangle(cornerRadius: 24).fill(.green.opacity(0.1))
                PairingReticle().stroke(.green, style: .init(lineWidth: 2.5, lineCap: .round)).padding(12)
                Image(systemName: "checkmark").font(.system(size: 36, weight: .medium)).foregroundStyle(.green)
            }
            .frame(width: 144, height: 144)
            .accessibilityHidden(true)
            Text("\(name) paired")
                .font(.title2.weight(.semibold).width(.expanded))
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .transition(.opacity)
        .task {
            AccessibilityNotification.Announcement(String(localized: "\(name) paired")).post()
            try? await Task.sleep(for: .seconds(1.2))
            if !Task.isCancelled { dismiss() }
        }
    }

    private var camera: some View {
        ZStack {
            if cameraReady {
                QRScanner(scanning: review == nil && error == nil) { value in
                    text = value; reviewLink(value)
                } onError: { message in cameraIssue = message; cameraReady = false }
            } else {
                VStack(spacing: 14) {
                    if let cameraIssue {
                        Image(systemName: "camera").font(.largeTitle).foregroundStyle(.secondary)
                        Text(cameraIssue).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        if AVCaptureDevice.authorizationStatus(for: .video) == .denied {
                            Button("Open Settings") {
                                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                            }.font(.subheadline.weight(.semibold))
                        }
                    } else {
                        MediaSkeleton(symbol: "qrcode.viewfinder").accessibilityLabel("Opening camera")
                    }
                }.padding(28)
            }
        }
        .frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
        .background(Color(.tertiarySystemBackground))
        .clipShape(.rect(cornerRadius: 24))
        .overlay {
            if cameraIssue == nil {
                GeometryReader { geometry in
                    PairingReticle().stroke(cameraReady ? Color.white : AppBrand.accent,
                                            style: .init(lineWidth: 3, lineCap: .round))
                        .frame(width: geometry.size.width * 0.72, height: geometry.size.height * 0.72)
                        .shadow(color: .black.opacity(0.75), radius: 2)
                        .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
                }.allowsHitTesting(false).accessibilityHidden(true)
            }
        }
        .accessibilityIdentifier("pairingCamera")
    }

    private var manualEntry: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("On your computer, show a pairing link in Mains or run “mains pair”, then paste it here.")
                .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            TextField("mains://pair#code=…", text: Binding(get: { text }, set: { value in
                guard value != text else { return }
                text = value; review = nil; error = nil
            }), axis: .vertical)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .lineLimit(4...6).font(.callout.monospaced()).focused($editingLink)
                .padding(12).frame(minHeight: 96, alignment: .topLeading)
                .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
                .disabled(session.pairingInProgress)
                .accessibilityLabel("Pairing link").accessibilityIdentifier("pairingLink")
            if review == nil && error == nil {
                Button(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Paste link" : "Use this link") {
                    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        guard let value = UIPasteboard.general.string, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                            error = "Copy a Mains pairing link on your computer, then paste it here."; return
                        }
                        text = value
                    }
                    reviewLink(text)
                }
                .buttonStyle(PairingActionStyle()).accessibilityIdentifier("reviewConnection")
            }
        }
    }

    @ViewBuilder private var status: some View {
        if let review {
            VStack(alignment: .leading, spacing: 10) {
                Text(session.pairingInProgress ? "PAIRING" : "CODE DETECTED")
                    .font(.caption.weight(.semibold)).tracking(0.6).foregroundStyle(.secondary)
                Text(review.name).font(.title3.weight(.semibold).width(.expanded))
                ForEach(review.endpoints, id: \.self) { endpoint in
                    Text(Self.address(endpoint)).font(.footnote.monospaced()).foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                if let error { Text(error).font(.subheadline).foregroundStyle(.red).accessibilityIdentifier("pairingError") }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        retryButton.fixedSize(horizontal: true, vertical: false)
                        pairButton
                    }
                    VStack(spacing: 8) { retryButton; pairButton }
                }.padding(.top, 4)
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.tertiarySystemBackground), in: .rect(cornerRadius: 18))
        } else if let error {
            VStack(alignment: .leading, spacing: 12) {
                Text("Not a Mains pairing link").font(.headline.width(.expanded))
                Text(error).font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("pairingError")
                retryButton
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.tertiarySystemBackground), in: .rect(cornerRadius: 18))
        } else if entryMode == .camera && cameraReady {
            Text("Align the QR code inside the frame.").font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var retryButton: some View {
        Button(entryMode == .camera ? "Scan again" : "Try another link") {
            review = nil; error = nil
            if entryMode == .manual { editingLink = true }
        }
        .buttonStyle(PairingActionStyle(prominent: false, compact: true)).disabled(session.pairingInProgress)
        .accessibilityIdentifier("retryPairing")
    }
    private var pairButton: some View {
        Button(action: pair) {
            Text(session.pairingInProgress ? "Pairing…" : "Pair with this computer")
                .fixedSize(horizontal: true, vertical: false)
        }
        .buttonStyle(PairingActionStyle(compact: true)).disabled(session.pairingInProgress)
        .accessibilityIdentifier("confirmPairing")
    }
    private func reviewLink(_ value: String) {
        guard !session.pairingInProgress else { return }
        editingLink = false
        do { review = try PairingLink(value); error = nil }
        catch { review = nil; self.error = error.localizedDescription }
    }
    private func switchTo(_ mode: EntryMode) {
        guard !session.pairingInProgress else { return }
        editingLink = false; review = nil; error = nil; entryMode = mode
    }
    private func pair() {
        guard let review, pairingTask == nil, !session.pairingInProgress else { return }
        error = nil; editingLink = false
        pairingTask = Task {
            defer { pairingTask = nil }
            do {
                try await session.pair(review, deviceName: UIDevice.current.name)
                if showsCompletion {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                        pairedComputerName = session.pairing?.descriptor.name ?? review.name
                    }
                } else {
                    dismiss()
                }
            } catch is CancellationError { }
            catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
    private func prepareCamera() async {
        cameraReady = false; cameraIssue = nil
        guard DataScannerViewController.isSupported else {
            cameraIssue = "Camera scanning is unavailable here. Paste the pairing link instead."; return
        }
        let allowed = await AVCaptureDevice.requestAccess(for: .video)
        guard !Task.isCancelled, entryMode == .camera else { return }
        guard allowed else { cameraIssue = "Allow camera access in iPhone Settings to scan a pairing code."; return }
        guard DataScannerViewController.isAvailable else { cameraIssue = "The camera is unavailable. Paste the pairing link instead."; return }
        cameraReady = true
    }
    private static func address(_ endpoint: URL) -> String {
        guard let host = endpoint.host() else { return "Computer" }
        return host + (endpoint.port.map { ":\($0)" } ?? "")
    }
}

struct PairingReticle: Shape {
    func path(in rect: CGRect) -> Path {
        let length = min(rect.width, rect.height) * 0.22
        let radius = length * 0.5
        let corners: [(x: CGFloat, y: CGFloat, dx: CGFloat, dy: CGFloat)] = [
            (rect.minX, rect.minY, 1, 1), (rect.maxX, rect.minY, -1, 1),
            (rect.minX, rect.maxY, 1, -1), (rect.maxX, rect.maxY, -1, -1),
        ]
        var path = Path()
        for (x, y, dx, dy) in corners {
            path.move(to: CGPoint(x: x, y: y + dy * length))
            path.addLine(to: CGPoint(x: x, y: y + dy * radius))
            path.addQuadCurve(to: CGPoint(x: x + dx * radius, y: y), control: CGPoint(x: x, y: y))
            path.addLine(to: CGPoint(x: x + dx * length, y: y))
        }
        return path
    }
}

struct PairingActionStyle: ButtonStyle {
    var prominent = true
    var compact = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(compact ? .subheadline.weight(.semibold) : .body.weight(.semibold))
            .padding(.horizontal, 12).padding(.vertical, compact ? 10 : 12)
            .frame(maxWidth: .infinity, minHeight: compact ? 40 : 48)
            .foregroundStyle(prominent ? Color.white : .primary)
            .background(prominent ? AppBrand.accent : Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
            .opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct QRScanner: UIViewControllerRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let scanning: Bool
    let onScan: (String) -> Void
    let onError: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan, onError: onError) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])],
                                               qualityLevel: .balanced, recognizesMultipleItems: false,
                                               isHighFrameRateTrackingEnabled: false, isPinchToZoomEnabled: true,
                                               isGuidanceEnabled: false, isHighlightingEnabled: false)
        scanner.delegate = context.coordinator
        return scanner
    }
    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.onScan = onScan; context.coordinator.onError = onError
        if scanning && !context.coordinator.active {
            context.coordinator.active = true; context.coordinator.found = false
            do { try scanner.startScanning() }
            catch {
                context.coordinator.active = false
                Task { @MainActor in onError(error.localizedDescription) }
            }
        } else if !scanning {
            context.coordinator.active = false
            scanner.stopScanning()
        }
    }
    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        coordinator.active = false; scanner.stopScanning()
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onScan: (String) -> Void
        var onError: (String) -> Void
        var active = false
        var found = false
        init(onScan: @escaping (String) -> Void, onError: @escaping (String) -> Void) { self.onScan = onScan; self.onError = onError }
        func dataScanner(_ scanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard active, !found else { return }
            for item in addedItems {
                if case .barcode(let barcode) = item, let value = barcode.payloadStringValue {
                    found = true; scanner.stopScanning(); onScan(value); return
                }
            }
        }
        func dataScanner(_ scanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
            guard active else { return }
            active = false; onError("Camera scanning stopped. Paste the pairing link or try again.")
        }
    }
}
