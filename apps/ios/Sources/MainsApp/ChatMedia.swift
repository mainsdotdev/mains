import SwiftUI
import ImageIO

/// Compute the preview's final size in the layout pass, before any image bytes
/// arrive. No measured-width state or decoded aspect ratio can move later rows.
private struct ChatImageFrame: Layout {
    let widthLimit: CGFloat
    let heightLimit: CGFloat
    let fixedHeight: Bool
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = max(1, min(widthLimit, proposal.width ?? 296))
        return CGSize(width: width, height: fixedHeight ? heightLimit : min(heightLimit, width * 0.75))
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for view in subviews { view.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size)) }
    }
}

struct PendingPromptAttachments: View {
    let attachments: [PromptAttachment]
    private var images: [PromptAttachment] { attachments.filter { $0.type == "image" } }
    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            if images.count == 1, let image = images.first { PendingImageTile(file: image, width: 296, height: 222) }
            else if !images.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 10) {
                        ForEach(images) { PendingImageTile(file: $0, width: 260, height: 170, fixedHeight: true) }
                    }
                }.scrollIndicators(.hidden)
            }
            ForEach(attachments.filter { $0.type != "image" }) { file in
                Label(file.name, systemImage: "doc.text").font(.subheadline).padding(14)
                    .frame(maxWidth: 296, minHeight: 64, alignment: .leading)
                    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
            }
        }.frame(maxWidth: .infinity, alignment: .trailing)
    }
}

private struct PendingImageTile: View {
    let file: PromptAttachment
    let width: CGFloat
    let height: CGFloat
    var fixedHeight = false
    @State private var image: UIImage?
    var body: some View {
        ChatImageFrame(widthLimit: width, heightLimit: height, fixedHeight: fixedHeight) {
            ZStack {
                Color(.secondarySystemBackground)
                if let image { Image(uiImage: image).resizable().scaledToFit() }
            }
        }.clipShape(.rect(cornerRadius: 18))
            .task(id: file.id) {
                guard let data = Data(base64Encoded: file.data), let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceThumbnailMaxPixelSize: 512, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else { return }
                image = UIImage(cgImage: thumbnail)
            }
    }
}

struct ChatMediaGallery: View {
    let session: BackendSession
    let media: [TranscriptMedia]
    var prompt = false
    @State private var selection: TranscriptMedia?
    private var images: [TranscriptMedia] { media.filter(\.image) }
    var body: some View {
        VStack(alignment: prompt ? .trailing : .leading, spacing: 10) {
            if images.count == 1, let image = images.first {
                ChatImageTile(session: session, media: image, maxWidth: prompt ? 296 : .infinity, maxHeight: 320, fixedHeight: false) { selection = image }
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
    @State private var visible = false
    @State private var error: String?
    @State private var retry = 0
    var body: some View {
        Button {
            if image != nil { open() } else { retry += 1 }
        } label: {
            ChatImageFrame(widthLimit: maxWidth, heightLimit: maxHeight, fixedHeight: fixedHeight) {
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
            }
            .clipShape(.rect(cornerRadius: 18))
        }
        .buttonStyle(ChatPressStyle()).disabled(!media.available || !session.isConnected)
        .accessibilityLabel(media.name).accessibilityIdentifier("transcriptImage-" + media.id)
        .onScrollVisibilityChange(threshold: 0.01) { visible = $0 }
        .task(id: "\(session.ownership):\(session.isConnected):\(media.runID):\(media.id):\(retry):\(visible)") {
            if visible { await load() } else { image = nil; error = nil }
        }
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
        } catch { if !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription } }
    }
}
