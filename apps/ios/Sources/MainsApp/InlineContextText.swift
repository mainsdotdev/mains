import SwiftUI
import UIKit
import ImageIO

/// Artwork stays scoped to visible mentions. Only bounded data/HTTPS images are
/// accepted; absolute catalogue paths always use the bundled fallback.
@MainActor @Observable
final class ContextArtwork {
    var images: [String: UIImage] = [:]
    var revision = 0
    func load(_ skills: [ContextSkill]) async {
        var loaded: [String: UIImage] = [:]
        for skill in skills {
            guard !Task.isCancelled else { return }
            let source = skill.iconSmall ?? skill.iconLarge ?? ""
            if source.hasPrefix("data:image/"), source.utf8.count <= 350_000,
               let comma = source.firstIndex(of: ","), let bytes = Data(base64Encoded: String(source[source.index(after: comma)...])),
               let image = Self.thumbnail(bytes) { loaded[skill.name] = image }
            else if let url = URL(string: source), url.scheme?.lowercased() == "https", url.host != nil, url.user == nil, url.password == nil {
                do {
                    var request = URLRequest(url: url); request.timeoutInterval = 10
                    let (stream, response) = try await URLSession.shared.bytes(for: request)
                    guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
                          response.expectedContentLength <= 350_000 else { continue }
                    var data = Data()
                    for try await byte in stream {
                        guard !Task.isCancelled else { return }
                        if data.count == 350_000 { break }
                        data.append(byte)
                    }
                    if let image = Self.thumbnail(data) { loaded[skill.name] = image }
                } catch { /* Missing optional artwork uses the bundled context icon. */ }
            }
        }
        guard !Task.isCancelled else { return }
        images = loaded; revision += 1
    }
    private static func thumbnail(_ data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 128, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
    static func color(_ skill: ContextSkill) -> UIColor {
        let hex = skill.brandColor?.trimmingCharacters(in: CharacterSet(charactersIn: "#")) ?? ""
        guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return .link }
        return UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
    }
    static func icon(_ image: UIImage?, skill: ContextSkill, size: CGFloat, tint: UIColor) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { _ in
            let isSkill = skill.group == "Skills"
            let source = image ?? UIImage(named: isSkill ? "registry-sparkles" : "registry-box")?.withTintColor(tint, renderingMode: .alwaysOriginal) ?? UIImage(systemName: isSkill ? "sparkles" : "cube")!.withTintColor(tint, renderingMode: .alwaysOriginal)
            let scale = min(size / max(1, source.size.width), size / max(1, source.size.height))
            let rect = CGRect(x: (size - source.size.width * scale) / 2, y: (size - source.size.height * scale) / 2, width: source.size.width * scale, height: source.size.height * scale)
            source.draw(in: rect)
        }
    }
}

/// Same metadata-based token positions as the composer, rendered inside sent prompts.
struct InlineContextText: View {
    let text: String
    let skills: [ContextSkill]
    @State private var artwork = ContextArtwork()
    var body: some View {
        let projection = ContextText(text, skills: skills, canonical: true)
        rendered(projection).accessibilityLabel(projection.readable)
            .task(id: skills) { await artwork.load(skills) }
    }
    private func rendered(_ projection: ContextText) -> Text {
        let display = projection.display as NSString
        var result = Text(""), cursor = 0
        for mention in projection.mentions {
            result = result + Text(display.substring(with: NSRange(location: cursor, length: mention.displayRange.location - cursor)))
            let icon = ContextArtwork.icon(artwork.images[mention.skill.name], skill: mention.skill, size: 17, tint: .white)
            result = result + Text(Image(uiImage: icon)).baselineOffset(-2) + Text(" " + mention.skill.title).fontWeight(.semibold)
            cursor = NSMaxRange(mention.displayRange)
        }
        return result + Text(display.substring(from: cursor).replacingOccurrences(of: ContextMentions.marker, with: ""))
    }
}

private final class ContextAttachment: NSTextAttachment {
    let skill: ContextSkill
    let scope: ContextScope
    @MainActor init(skill: ContextSkill, scope: ContextScope, font: UIFont, image: UIImage?, maxWidth: CGFloat) {
        self.skill = skill; self.scope = scope
        super.init(data: nil, ofType: nil)
        let color = ContextArtwork.color(skill), iconSize = font.pointSize
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let width = min(maxWidth, max(iconSize + 12, (skill.title as NSString).size(withAttributes: attributes).width + iconSize + 6))
        let height = ceil(font.lineHeight)
        self.image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height)).image { _ in
            ContextArtwork.icon(image, skill: skill, size: iconSize, tint: color).draw(at: CGPoint(x: 0, y: (height - iconSize) / 2))
            let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail
            (skill.title as NSString).draw(in: CGRect(x: iconSize + 6, y: (height - font.lineHeight) / 2, width: max(1, width - iconSize - 6), height: height), withAttributes: attributes.merging([.paragraphStyle: paragraph]) { _, new in new })
        }
        bounds = CGRect(x: 0, y: font.descender, width: width, height: height)
    }
    required init?(coder: NSCoder) { nil }
}

struct ContextTextEditor: View {
    @Binding var text: String
    @Binding var skills: [ContextSkill]
    let scope: ContextScope
    @Binding var focused: Bool
    let placeholder: String
    let identifier: String
    @State private var artwork = ContextArtwork()
    @State private var measuredWidth: CGFloat = 320
    var body: some View {
        ContextTextInput(text: $text, skills: $skills, scope: scope, focused: $focused, placeholder: placeholder, identifier: identifier,
                         images: artwork.images, artworkRevision: artwork.revision, measuredWidth: measuredWidth)
            .task(id: skills) { await artwork.load(skills) }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { measuredWidth = $0 }
    }
}

private struct ContextTextInput: UIViewRepresentable {
    @Binding var text: String
    @Binding var skills: [ContextSkill]
    let scope: ContextScope
    @Binding var focused: Bool
    let placeholder: String
    let identifier: String
    let images: [String: UIImage]
    let artworkRevision: Int
    let measuredWidth: CGFloat
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> ComposerTextView {
        let view = ComposerTextView()
        view.backgroundColor = .clear; view.delegate = context.coordinator
        view.textContainerInset = .zero; view.textContainer.lineFragmentPadding = 0
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.keyboardDismissMode = .interactive; view.adjustsFontForContentSizeCategory = true
        view.accessibilityIdentifier = identifier
        return view
    }
    func updateUIView(_ view: ComposerTextView, context: Context) {
        let coordinator = context.coordinator; coordinator.parent = self
        if coordinator.scope != scope {
            view.undoManager?.removeAllActions(); coordinator.scope = scope
        }
        let font = UIFont.preferredFont(forTextStyle: .body)
        view.font = font; view.textColor = .label; view.tintColor = .link
        view.typingAttributes = [.font: font, .foregroundColor: UIColor.label]
        view.placeholder.text = placeholder; view.placeholder.font = font
        view.placeholder.isHidden = !text.isEmpty
        let signature = "\(font.pointSize):\(colorScheme):\(measuredWidth):\(artworkRevision)"
        let projection = ContextText(text, skills: skills)
        if view.markedTextRange == nil, coordinator.source(view.attributedText) != text || coordinator.skills != skills || coordinator.signature != signature {
            let selection = projection.selection(after: coordinator.projection, range: view.selectedRange)
            let value = NSMutableAttributedString(string: projection.display, attributes: [.font: font, .foregroundColor: UIColor.label])
            for mention in projection.mentions {
                let token = ContextAttachment(skill: mention.skill, scope: scope, font: font, image: images[mention.skill.name], maxWidth: max(80, measuredWidth - 4))
                value.addAttribute(.attachment, value: token, range: mention.displayRange)
            }
            if view.attributedText.string != projection.display {
                // Picker/scope/send changes can replace many source characters
                // with one glyph. Old UIKit undo ranges belong to the old buffer.
                view.undoManager?.removeAllActions()
                view.attributedText = value
            } else {
                // Artwork and theme updates only change attributes. Preserve the
                // user's text undo history and the attachment carried by an undo.
                view.textStorage.setAttributedString(value)
            }
            view.selectedRange = selection
            coordinator.projection = projection; coordinator.skills = skills; coordinator.signature = signature
        }
        view.accessibilityValue = projection.readable
        view.onCopy = { [weak view, weak coordinator] in
            guard let view, let coordinator else { return }
            let range = view.selectedRange
            let selected = view.attributedText.attributedSubstring(from: range)
            UIPasteboard.general.string = coordinator.source(selected).replacingOccurrences(of: ContextMentions.marker, with: "")
        }
        view.wantsFocus = focused
        if focused, !view.isFirstResponder { view.requestFocus() }
        else if !focused, view.isFirstResponder { view.resignFirstResponder() }
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ComposerTextView, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        let font = uiView.font ?? .preferredFont(forTextStyle: .body)
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let limit = ceil(font.lineHeight * 6)
        uiView.isScrollEnabled = fitted.height > limit
        return CGSize(width: width, height: max(ceil(font.lineHeight), min(limit, fitted.height)))
    }
    static func dismantleUIView(_ uiView: ComposerTextView, coordinator: Coordinator) { uiView.wantsFocus = false; uiView.delegate = nil }

    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ContextTextInput
        var projection = ContextText("", skills: [])
        var skills: [ContextSkill] = []
        var scope: ContextScope?
        var signature = ""
        init(_ parent: ContextTextInput) { self.parent = parent }
        func source(_ value: NSAttributedString) -> String {
            var result = ""
            value.enumerateAttributes(in: NSRange(location: 0, length: value.length)) { attributes, range, _ in
                let string = value.attributedSubstring(from: range).string
                if let token = attributes[.attachment] as? ContextAttachment {
                    result += string.replacingOccurrences(of: "\u{fffc}", with: token.scope == parent.scope ? ContextMentions.mention(token.skill) : token.skill.title)
                } else { result += string }
            }
            return result
        }
        func textViewDidChange(_ view: UITextView) {
            let value = source(view.attributedText)
            var selected: [ContextSkill] = [], names: Set<String> = []
            view.attributedText.enumerateAttribute(.attachment, in: NSRange(location: 0, length: view.attributedText.length)) { attribute, range, _ in
                if let token = attribute as? ContextAttachment, token.scope == parent.scope,
                   (view.attributedText.string as NSString).substring(with: range).contains("\u{fffc}"), names.insert(token.skill.name).inserted { selected.append(token.skill) }
            }
            parent.skills = selected
            projection = ContextText(value, skills: selected)
            parent.text = value
            view.accessibilityValue = projection.readable
            (view as? ComposerTextView)?.placeholder.isHidden = !value.isEmpty
            view.invalidateIntrinsicContentSize()
        }
        func textViewDidChangeSelection(_ view: UITextView) {
            view.typingAttributes = [.font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.label]
        }
        func textViewDidBeginEditing(_ view: UITextView) { if !parent.focused { parent.focused = true } }
        func textViewDidEndEditing(_ view: UITextView) { if parent.focused { parent.focused = false } }
    }
}

final class ComposerTextView: UITextView {
    let placeholder = UILabel()
    var wantsFocus = false
    var onCopy: (() -> Void)?
    init() {
        super.init(frame: .zero, textContainer: nil)
        placeholder.textColor = .placeholderText; placeholder.isUserInteractionEnabled = false
        addSubview(placeholder)
    }
    required init?(coder: NSCoder) { nil }
    override func layoutSubviews() { super.layoutSubviews(); placeholder.frame = CGRect(x: 0, y: 0, width: bounds.width, height: font?.lineHeight ?? 22) }
    override func didMoveToWindow() { super.didMoveToWindow(); if wantsFocus { requestFocus() } }
    func requestFocus() {
        guard window != nil else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, self.wantsFocus, self.window != nil, !self.isFirstResponder else { return }
            self.becomeFirstResponder()
        }
    }
    override func copy(_ sender: Any?) { onCopy?() }
    override func cut(_ sender: Any?) { onCopy?(); insertText("") }
    override func paste(_ sender: Any?) {
        if let text = UIPasteboard.general.string {
            insertText(text.replacingOccurrences(of: "\u{fffc}", with: "").replacingOccurrences(of: ContextMentions.marker, with: ""))
        }
    }
}
