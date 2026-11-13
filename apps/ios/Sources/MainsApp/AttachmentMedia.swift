import SwiftUI
import PhotosUI
import CoreTransferable
import ImageIO
import UniformTypeIdentifiers

/// The pickers return small, app-owned JPEGs; previews never decode a full camera original.
enum AttachmentImage {
    nonisolated static func thumbnail(_ data: Data, pixels: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let width = (properties?[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue ?? 1
        let height = (properties?[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue ?? 1
        let ratio = max(width, height) / max(1, min(width, height))
        guard let image = thumbnail(source, pixels: min(2048, Int(Double(pixels) * ratio))) else { return nil }
        // Crop the preview bitmap, so layout and accessibility both remain square.
        // The attached JPEG retains the complete image.
        let edge = min(image.width, image.height)
        return image.cropping(to: CGRect(x: (image.width - edge) / 2, y: (image.height - edge) / 2, width: edge, height: edge))
    }
    nonisolated private static func thumbnail(_ source: CGImageSource, pixels: Int) -> CGImage? {
        CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: pixels,
            kCGImageSourceShouldCacheImmediately: true,
        ] as CFDictionary)
    }
    nonisolated static func prepare(url: URL, maxBytes: Int) throws -> Data {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { throw MainsError.server("This photo couldn’t be opened.") }
        return try encode(source, maxBytes: maxBytes)
    }
    nonisolated static func prepare(data: Data, maxBytes: Int) throws -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { throw MainsError.server("This photo couldn’t be opened.") }
        return try encode(source, maxBytes: maxBytes)
    }
    nonisolated private static func encode(_ source: CGImageSource, maxBytes: Int) throws -> Data {
        for pixels in [2048, 1536, 1024] {
            guard let image = thumbnail(source, pixels: pixels) else { continue }
            for quality in [0.85, 0.7, 0.55] {
                let data = NSMutableData()
                guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { continue }
                CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
                if CGImageDestinationFinalize(destination), data.length <= maxBytes { return data as Data }
            }
        }
        throw MainsError.server("These photos exceed the 2 MB attachment limit. Choose fewer photos.")
    }
}

struct PickedPhoto: Transferable, Sendable {
    let data: Data
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            // Resolve the temporary picker URL before its access ends.
            PickedPhoto(data: try AttachmentImage.prepare(url: received.file, maxBytes: 2 * 1024 * 1024))
        }
    }
}

struct ComposerAttachmentStrip: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let attachments: [PromptAttachment]
    let remove: (UUID) -> Void
    private var images: [PromptAttachment] { attachments.filter { $0.type == "image" } }
    private var documents: [PromptAttachment] { attachments.filter { $0.type != "image" } }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !images.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(images) { attachment in
                            AttachmentThumbnail(attachment: attachment)
                                .frame(width: 104, height: 104)
                                .accessibilityHidden(true)
                                .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 16))
                                .clipShape(.rect(cornerRadius: 16))
                                .overlay(alignment: .topTrailing) {
                                    Button { remove(attachment.id) } label: {
                                        Image(systemName: "xmark").font(.system(size: 11, weight: .medium))
                                            .foregroundStyle(.white).frame(width: 28, height: 28)
                                            .background(.black.opacity(0.62), in: .circle)
                                            .frame(width: 44, height: 44).contentShape(.rect)
                                    }
                                    .buttonStyle(ChatPressStyle()).accessibilityLabel("Remove \(attachment.name)")
                                    .accessibilityIdentifier("removeAttachment-\(attachment.id)")
                                }
                                .accessibilityElement(children: .contain).accessibilityLabel(attachment.name)
                                .accessibilityIdentifier("attachment-photo-\(attachment.id)")
                        }
                    }
                }.frame(height: 104).scrollIndicators(.hidden).accessibilityIdentifier("attachmentPhotos")
            }
            if !documents.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(documents) { attachment in
                            HStack(spacing: 6) {
                                Image(systemName: "doc").foregroundStyle(.secondary)
                                    .frame(width: 28, height: 28).background(.primary.opacity(0.06), in: .rect(cornerRadius: 8))
                                Text(attachment.name).font(.caption).lineLimit(1)
                                Button { remove(attachment.id) } label: {
                                    Image(systemName: "xmark").font(.system(size: 11)).foregroundStyle(.secondary)
                                        .frame(width: 32, height: 36).contentShape(.rect)
                                }.accessibilityLabel("Remove \(attachment.name)")
                            }
                            .padding(.leading, 4).frame(maxWidth: 230).frame(height: 36)
                            .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
                        }
                    }
                }.frame(height: 36).scrollIndicators(.hidden).accessibilityIdentifier("attachmentDocuments")
            }
        }
        .buttonStyle(.plain)
    }
}

private struct AttachmentThumbnail: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let attachment: PromptAttachment
    @State private var image: CGImage?
    var body: some View {
        GeometryReader { geometry in
            Group {
                if let image { Image(decorative: image, scale: 1).resizable().scaledToFill() }
                else { Image(systemName: "photo").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity) }
            }
            .frame(width: geometry.size.width, height: geometry.size.height).clipped()
        }
        .accessibilityLabel(attachment.name)
        .task(id: attachment.id) {
            let encoded = attachment.data
            let thumbnail = await Task.detached(priority: .utility) {
                Data(base64Encoded: encoded).flatMap { AttachmentImage.thumbnail($0, pixels: 312) }
            }.value
            if !Task.isCancelled { image = thumbnail }
        }
    }
}
