import SwiftUI
import ImageIO

struct PendingPromptAttachments: View {
    let attachments: [PromptAttachment]
    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(attachments) { file in
                    if file.type == "image", let data = Data(base64Encoded: file.data),
                       let source = CGImageSourceCreateWithData(data as CFData, nil),
                       let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 512, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) {
                        Image(uiImage: UIImage(cgImage: thumbnail)).resizable().scaledToFit().frame(height: 150).clipShape(.rect(cornerRadius: 16))
                    } else {
                        Label(file.name, systemImage: "doc.text").font(.footnote).padding(14).background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 14))
                    }
                }
            }
        }.scrollIndicators(.hidden).frame(maxWidth: .infinity, alignment: .trailing)
    }
}

struct ChatMediaGallery: View {
    let session: BackendSession
    let media: [TranscriptMedia]
    var prompt = false
    @State private var width: CGFloat = 296
    @State private var selection: TranscriptMedia?
    private var images: [TranscriptMedia] { media.filter(\.image) }
    var body: some View {
        VStack(alignment: prompt ? .trailing : .leading, spacing: 10) {
            if images.count == 1, let image = images.first {
                ChatImageTile(session: session, media: image, maxWidth: prompt ? min(296, width) : width, maxHeight: 320, fixedHeight: false) { selection = image }
                    .frame(maxWidth: .infinity, alignment: prompt ? .trailing : .leading)
            } else if !images.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 10) {
                        ForEach(images) { image in
                            ChatImageTile(session: session, media: image, maxWidth: 260, maxHeight: 170, fixedHeight: true) { selection = image }
                        }
                    }
                }.scrollIndicators(.hidden)
            }
            ForEach(media.filter { !$0.image }) { file in
                Button { selection = file } label: {
                    HStack(spacing: 12) {
                        Image(systemName: file.name.lowercased().hasSuffix(".pdf") ? "doc.richtext" : "doc.text")
                            .font(.title3).foregroundStyle(.secondary).frame(width: 28)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(file.name).font(.subheadline.weight(.medium)).foregroundStyle(.primary).lineLimit(2)
                            Text(file.available ? file.byteSize.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) } ?? "Open document" : "Preview unavailable")
                                .font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        if file.available { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
                    }.padding(14).frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
                }.buttonStyle(ChatPressStyle()).disabled(!file.available || !session.isConnected)
                    .frame(maxWidth: prompt ? 296 : .infinity, alignment: .trailing)
                    .accessibilityIdentifier("transcriptMedia-" + file.id)
            }
        }
        .frame(maxWidth: .infinity, alignment: prompt ? .trailing : .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = max(1, $0) }
        .sheet(item: $selection) { OutputPreviewView(session: session, media: $0) }
        .onChange(of: session.ownership) { _, _ in selection = nil }
    }
}

private struct ChatImageTile: View {
    let session: BackendSession
    let media: TranscriptMedia
    let maxWidth: CGFloat
    let maxHeight: CGFloat
    let fixedHeight: Bool
    let open: () -> Void
    @State private var image: UIImage?
    @State private var imageAspect: CGFloat = 4 / 3
    @State private var error: String?
    @State private var retry = 0
    private var aspect: CGFloat { imageAspect }
    private var height: CGFloat { fixedHeight ? maxHeight : min(maxHeight, maxWidth / aspect) }
    var body: some View {
        Button {
            if image != nil { open() } else { retry += 1 }
        } label: {
            ZStack {
                Color(.secondarySystemBackground)
                if let image { Image(uiImage: image).resizable().scaledToFit() }
                else if error != nil || !media.available {
                    VStack(spacing: 7) {
                        Image(systemName: "photo").font(.title2)
                        Text(media.name).lineLimit(1)
                        Text(media.available ? "Tap to retry" : "Preview unavailable").font(.caption2)
                    }.font(.caption).foregroundStyle(.secondary).padding(12)
                } else { ProgressView() }
            }
            .frame(width: min(maxWidth, height * aspect), height: height)
            .clipShape(.rect(cornerRadius: 18))
        }
        .buttonStyle(ChatPressStyle()).disabled(!media.available || !session.isConnected)
        .accessibilityLabel(media.name).accessibilityIdentifier("transcriptImage-" + media.id)
        .task(id: "\(session.ownership):\(session.isConnected):\(media.runID):\(media.id):\(retry)") { await load() }
        .onDisappear { image = nil }
    }
    private func load() async {
        image = nil; error = nil
        guard media.available, session.isConnected else { return }
        let owner = session.ownership
        do {
            let result = try await session.readImage(media, maxSide: 512)
            try Task.checkCancellation()
            guard owner == session.ownership, let bytes = result.data,
                  let source = CGImageSourceCreateWithData(bytes as CFData, nil),
                  let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceThumbnailMaxPixelSize: 768,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                  ] as CFDictionary) else { throw MainsError.invalidReply }
            image = UIImage(cgImage: thumbnail)
            imageAspect = CGFloat(thumbnail.width) / CGFloat(max(1, thumbnail.height))
        } catch { if !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription } }
    }
}
