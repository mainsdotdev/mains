import SwiftUI
import PhotosUI
import Photos

/// The attachment menu and media panels share one reversible, source-anchored surface.
struct AttachmentPanel: View {
    enum Mode: String, Identifiable { case menu, camera, photos; var id: String { rawValue } }
    let sourceFrame: CGRect
    let accent: Color
    let maxCount: Int
    let maxBytes: Int
    let add: ([PromptAttachment]) throws -> Void
    let close: (Bool) -> Void
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var mode = Mode.menu
    @State private var revealed = false
    @State private var appeared = false
    @State private var closing = false
    @State private var camera = AttachmentCamera()
    @State private var library = AttachmentPhotoLibrary()
    @State private var selected: [String] = []
    @State private var picked: [PhotosPickerItem] = []
    @State private var systemPicker = false
    @State private var importing = false
    @State private var importTask: Task<Void, Never>?
    @State private var error: String?
    @State private var importGeneration = 0
    @State private var visible = false

    var body: some View {
        GeometryReader { geometry in
            let frame = geometry.frame(in: .global)
            let origin = sourceFrame.isEmpty
                ? CGRect(x: 24, y: geometry.size.height - 52, width: 44, height: 44)
                : sourceFrame.offsetBy(dx: -frame.minX, dy: -frame.minY)
            let menuWidth = max(1, min(248.0, geometry.size.width - 24))
            let menuFrame = CGRect(x: min(max(12, origin.minX - 12), geometry.size.width - menuWidth - 12),
                                   y: max(12, min(geometry.size.height, origin.maxY) - 192), width: menuWidth, height: 192)
            let mediaWidth = max(1, geometry.size.width - 24)
            let mediaHeight = min(mediaWidth * 1.32, max(1, geometry.size.height - 20))
            let mediaFrame = CGRect(x: 12, y: geometry.size.height - mediaHeight, width: mediaWidth, height: mediaHeight)
            let expanded = mode == .menu ? menuFrame : mediaFrame
            let collapsed = closing && mode != .menu ? menuFrame : origin
            let displayed = reduceMotion || revealed ? expanded : collapsed
            ZStack(alignment: .topLeading) {
                Color.clear.contentShape(.rect).ignoresSafeArea(.container)
                    .onTapGesture { requestClose() }.accessibilityHidden(true)
                surface
                    .frame(width: displayed.width, height: displayed.height)
                    .clipShape(.rect(cornerRadius: mode == .menu ? 28 : 34))
                    .shadow(color: .black.opacity(0.24), radius: 20, y: 8)
                    .opacity(revealed ? 1 : 0)
                    .offset(x: displayed.minX, y: displayed.minY)
                    .allowsHitTesting(revealed && !closing)
                    .accessibilityHidden(!revealed || closing)
            }
            .animation(reduceMotion ? nil : transition, value: sourceFrame)
        }
        .ignoresSafeArea(.keyboard)
        .accessibilityAction(.escape) { requestClose() }
        .photosPicker(isPresented: $systemPicker, selection: $picked, maxSelectionCount: max(1, maxCount), selectionBehavior: .ordered, matching: .images, preferredItemEncoding: .compatible)
        .onChange(of: picked) { _, items in if !items.isEmpty { importPicker(items) } }
        .task(id: "\(mode.rawValue):\(scenePhase == .active)") {
            if mode == .camera && scenePhase == .active { await camera.start() }
            else { camera.stop() }
            if mode == .photos && scenePhase == .active { await library.load() }
        }
        .onAppear {
            visible = true
            guard !appeared else { return }
            appeared = true
            DispatchQueue.main.async {
                guard !closing else { return }
                withAnimation(transition) { revealed = true }
            }
        }
        .onDisappear { visible = false; importGeneration += 1; camera.stop(); importTask?.cancel() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { importGeneration += 1; importTask?.cancel(); importing = false }
        }
        .alert("Couldn’t attach photo", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) { error = nil }
        } message: { Text(error ?? "") }
    }
    private var transition: Animation {
        reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.34, dampingFraction: 1)
    }
    private var surface: some View {
        Group {
            switch mode {
            case .menu: sourceMenu
            case .camera: cameraPanel.background(Color(.systemBackground))
            case .photos: photosPanel.background(Color(.systemBackground))
            }
        }
        .transition(.opacity)
    }
    private var sourceMenu: some View {
        VStack(spacing: 0) {
            ForEach([Mode.camera, .photos], id: \.self) { source in
                Button { selectMode(source) } label: {
                    menuRow(source == .camera ? "Camera" : "Photos", symbol: source == .camera ? "camera" : "photo")
                }
                .accessibilityLabel(source == .camera ? "Camera" : "Photos")
            }
            Button { requestClose(showFiles: true) } label: { menuRow("Files", symbol: "paperclip") }
                .accessibilityLabel("Files")
        }
        .padding(12).buttonStyle(ChatPressStyle()).modifier(GlassSurface(radius: 28, interactive: false))
        .accessibilityElement(children: .contain).accessibilityLabel("Attachments").accessibilityIdentifier("attachmentMenu")
    }
    private func menuRow(_ title: String, symbol: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol).font(.system(size: 20)).frame(width: 44, height: 44)
                .background(Color(.tertiarySystemFill), in: .circle)
                .accessibilityHidden(true)
            Text(title).font(.body)
            Spacer(minLength: 0)
        }.frame(maxWidth: .infinity, minHeight: 56).contentShape(.rect)
    }
    private func requestClose(showFiles: Bool = false) {
        guard !closing else { return }
        closing = true; importGeneration += 1; importTask?.cancel(); camera.stop()
        withAnimation(transition, completionCriteria: .logicallyComplete) {
            revealed = false
        } completion: { close(showFiles) }
    }
    private func selectMode(_ next: Mode) {
        withAnimation(reduceMotion ? nil : transition) { mode = next }
    }
    private var cameraPanel: some View {
        ZStack(alignment: .bottom) {
            CameraPreview(camera: camera).background(.black)
            if !camera.ready && camera.error == nil && !closing { ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity) }
            if let message = camera.error {
                VStack(spacing: 12) {
                    Image(systemName: "camera").font(.largeTitle)
                    Text(message).font(.subheadline).multilineTextAlignment(.center)
                    if camera.permissionDenied {
                        Button("Open Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
                    } else {
                        Button("Try again") { Task { await camera.start() } }
                    }
                }.foregroundStyle(.white).padding(32).frame(maxWidth: .infinity, maxHeight: .infinity).background(.black.opacity(0.5))
            }
            LinearGradient(colors: [.clear, .black.opacity(0.28)], startPoint: .top, endPoint: .bottom).frame(height: 190).allowsHitTesting(false)
            HStack(alignment: .bottom) {
                panelControl("chevron.left", label: "Back to attachments", id: "attachmentPanelBack") { back() }
                Spacer()
                Button(action: capture) {
                    ZStack {
                        Circle().fill(.black.opacity(0.25)).overlay(Circle().strokeBorder(.white.opacity(0.4), lineWidth: 1))
                        if importing { ProgressView().tint(.white) }
                        else { Circle().fill(.white).padding(8) }
                    }.frame(width: 76, height: 76)
                }
                .buttonStyle(ChatPressStyle()).disabled(!camera.ready || importing)
                .accessibilityLabel("Take photo").accessibilityIdentifier("captureAttachmentPhoto")
                Spacer()
                VStack(spacing: 20) {
                    panelControl(camera.flash ? "bolt.fill" : "bolt.slash.fill", label: camera.flash ? "Turn flash off" : "Turn flash on", id: "cameraFlash") { camera.flash.toggle() }
                        .disabled(!camera.flashAvailable || importing)
                    panelControl("arrow.triangle.2.circlepath", label: "Flip camera", id: "cameraFlip") { camera.flip() }.disabled(!camera.ready || importing)
                    panelControl("xmark", label: "Close camera", id: "closeAttachmentPanel") { requestClose() }
                }
            }.padding(16).padding(.bottom, 8)
        }.accessibilityElement(children: .contain).accessibilityIdentifier("attachmentCameraPanel")
    }
    private var photosPanel: some View {
        GeometryReader { geometry in
            let side = (geometry.size.width - 4) / 3
            ZStack {
                if library.loading { ProgressView() }
                else if let message = library.message {
                    Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(32)
                } else {
                    ScrollView {
                        LazyVGrid(columns: Array(repeating: GridItem(.fixed(side), spacing: 2), count: 3), spacing: 2) {
                            ForEach(library.assets, id: \.localIdentifier) { asset in
                                let order = selected.firstIndex(of: asset.localIdentifier)
                                Button { toggle(asset.localIdentifier) } label: {
                                    LibraryPhotoThumbnail(asset: asset, pixels: side * 3)
                                        .frame(width: side, height: side).clipped().allowsHitTesting(false)
                                        .overlay(alignment: .bottomTrailing) {
                                            if let order {
                                                Text(String(order + 1)).font(.caption.weight(.semibold)).foregroundStyle(.white)
                                                    .frame(width: 26, height: 26).background(accent, in: .circle)
                                                    .overlay(Circle().strokeBorder(.white, lineWidth: 2)).padding(8)
                                            }
                                        }.contentShape(.rect)
                                }
                                .buttonStyle(.plain).disabled(importing || order == nil && selected.count >= maxCount)
                                .accessibilityLabel("Photo \(asset.creationDate?.formatted(date: .abbreviated, time: .shortened) ?? "")")
                                .accessibilityValue(order.map { "Selected \($0 + 1)" } ?? "Not selected")
                                .accessibilityAddTraits(order == nil ? [] : .isSelected)
                                .accessibilityIdentifier("library-photo-\(asset.localIdentifier)")
                                .onAppear { if asset.localIdentifier == library.assets.last?.localIdentifier { library.loadMore() } }
                            }
                        }.padding(.bottom, 100)
                    }.scrollIndicators(.hidden).accessibilityIdentifier("attachmentPhotoGrid")
                }
            }
            .overlay(alignment: .topTrailing) {
                Button { systemPicker = true } label: {
                    Label("All Photos", systemImage: "photo.on.rectangle").font(.footnote)
                        .foregroundStyle(.white).padding(.horizontal, 16).frame(height: 44)
                        .background(.black.opacity(0.6), in: .capsule).modifier(GlassSurface(radius: 22))
                }.buttonStyle(ChatPressStyle()).disabled(importing).padding(16).accessibilityIdentifier("allPhotos")
            }
            .overlay(alignment: .bottom) {
                HStack {
                    panelControl("chevron.left", label: "Back to attachments", id: "attachmentPanelBack") { back() }
                    Spacer()
                    if !selected.isEmpty {
                        Button { importLibrarySelection() } label: {
                            Group {
                                if importing { ProgressView().tint(.white) }
                                else { Text("Add \(selected.count) photo\(selected.count == 1 ? "" : "s")").font(.headline) }
                            }.foregroundStyle(.white).padding(.horizontal, 24).frame(height: 56).background(accent, in: .capsule)
                        }.buttonStyle(ChatPressStyle()).disabled(importing).accessibilityIdentifier("addSelectedPhotos")
                    } else {
                        panelControl("xmark", label: "Close photos", id: "closeAttachmentPanel") { requestClose() }
                    }
                }.padding(16).padding(.bottom, 8)
            }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("attachmentPhotosPanel")
    }
    private func panelControl(_ symbol: String, label: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 22)).foregroundStyle(.white)
                .frame(width: 56, height: 56).background(.black.opacity(0.35), in: .circle)
        }
        .buttonStyle(ChatPressStyle()).modifier(GlassSurface(radius: 28))
        .accessibilityLabel(label).accessibilityIdentifier(id)
    }
    private func back() {
        importGeneration += 1; importTask?.cancel(); importing = false; camera.stop()
        selectMode(.menu)
    }
    private func toggle(_ id: String) {
        if let index = selected.firstIndex(of: id) { selected.remove(at: index) }
        else if selected.count < maxCount { selected.append(id) }
        UISelectionFeedbackGenerator().selectionChanged()
    }
    private func capture() {
        guard !importing, !closing else { return }
        importing = true
        let generation = importGeneration
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        camera.capture { result in
            guard visible, generation == importGeneration, mode == .camera else { return }
            importTask = Task {
                do {
                    let raw = try result.get()
                    let limit = maxBytes
                    let data = try await Task.detached(priority: .userInitiated) { try AttachmentImage.prepare(data: raw, maxBytes: limit) }.value
                    try Task.checkCancellation()
                    try finish([PromptAttachment(name: "Camera.jpg", type: "image", mimeType: "image/jpeg", bytes: data)])
                } catch { failed(error) }
            }
        }
    }
    private func importLibrarySelection() {
        guard !importing, !closing else { return }
        importing = true
        let ids = selected
        importTask = Task {
            do {
                var attachments: [PromptAttachment] = []
                for id in ids {
                    try Task.checkCancellation()
                    guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { throw MainsError.server("This photo is no longer available.") }
                    let image = try await SelectedPhotoRequest().image(for: asset)
                    guard let raw = image.jpegData(compressionQuality: 0.95) else { throw MainsError.invalidReply }
                    let limit = maxBytes / ids.count
                    let data = try await Task.detached(priority: .userInitiated) { try AttachmentImage.prepare(data: raw, maxBytes: limit) }.value
                    attachments.append(PromptAttachment(name: "Photo-\(attachments.count + 1).jpg", type: "image", mimeType: "image/jpeg", bytes: data))
                }
                try Task.checkCancellation(); try finish(attachments)
            } catch { failed(error) }
        }
    }
    private func importPicker(_ items: [PhotosPickerItem]) {
        guard !importing, !closing else { return }
        importing = true
        importTask = Task {
            do {
                var attachments: [PromptAttachment] = []
                for item in items.prefix(maxCount) {
                    try Task.checkCancellation()
                    guard let photo = try await item.loadTransferable(type: PickedPhoto.self) else { throw MainsError.server("This photo couldn’t be opened.") }
                    let limit = maxBytes / items.count
                    let data = try await Task.detached(priority: .userInitiated) { try AttachmentImage.prepare(data: photo.data, maxBytes: limit) }.value
                    attachments.append(PromptAttachment(name: "Photo-\(attachments.count + 1).jpg", type: "image", mimeType: "image/jpeg", bytes: data))
                }
                try Task.checkCancellation(); try finish(attachments)
            } catch { failed(error) }
        }
    }
    private func finish(_ attachments: [PromptAttachment]) throws {
        guard !closing else { throw CancellationError() }
        try add(attachments); importing = false; requestClose()
    }
    private func failed(_ caught: any Error) {
        importing = false
        if !(caught is CancellationError) { error = caught.localizedDescription }
        picked = []
    }
}
