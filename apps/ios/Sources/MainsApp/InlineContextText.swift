import SwiftUI
import UIKit
import ImageIO

private extension NSAttributedString.Key {
    static let composerLineBreak = Self("composerLineBreak")
}

extension EnvironmentValues {
    @Entry var mateMentionAvatars: [String: MateAvatar] = [:]
}

@MainActor
enum WorkspaceFileArtwork {
    static func image(for file: WorkspaceFileMatch, tint: UIColor) -> UIImage {
        if file.kind == .directory {
            return (UIImage(named: "registry-workspace-folder") ?? UIImage(systemName: "folder.fill")!)
                .withTintColor(.systemOrange, renderingMode: .alwaysOriginal)
        }
        if let asset = fileTypeAssetName(for: file.name), let image = UIImage(named: asset) {
            return image.renderingMode == .alwaysTemplate
                ? image.withTintColor(tint, renderingMode: .alwaysOriginal)
                : image.withRenderingMode(.alwaysOriginal)
        }
        return (UIImage(named: "registry-tool-file") ?? UIImage(systemName: "doc.fill")!)
            .withTintColor(tint, renderingMode: .alwaysOriginal)
    }

    static func fileTypeAssetName(for path: String) -> String? {
        let components = path.split(omittingEmptySubsequences: false) { $0 == "/" || $0 == "\\" }
        let name = components.last?.lowercased() ?? ""
        if name == ".env" || name.hasPrefix(".env.") { return "registry-tool-file-env" }
        let asset: String? = switch (name as NSString).pathExtension {
        case "swift": "tool-file-swift"
        case "ts", "mts", "cts": "tool-file-typescript"
        case "js", "mjs", "cjs": "tool-file-javascript"
        case "jsx", "tsx": "tool-file-react"
        case "css", "scss", "sass", "less": "tool-file-css"
        case "postcss": "tool-file-postcss"
        case "html", "htm": "tool-file-html"
        case "vue": "tool-file-vue"
        case "svelte": "tool-file-svelte"
        case "json", "jsonc", "json5": "tool-file-json"
        case "yaml", "yml": "tool-file-yaml"
        case "xml", "plist", "xsd", "xsl": "tool-file-xml"
        case "py", "pyi", "pyw": "tool-file-python"
        case "go": "tool-file-go"
        case "rs": "tool-file-rust"
        case "rb", "erb": "tool-file-ruby"
        case "java": "tool-file-java"
        case "c", "h", "cc", "cpp", "cxx", "hpp", "hh": "tool-file-cpp"
        case "sh", "bash", "zsh", "fish": "tool-file-shell"
        case "env": "tool-file-env"
        case "sql", "db", "sqlite", "sqlite3": "tool-file-database"
        case "csv", "tsv": "tool-file-csv"
        case "md", "mdx", "markdown": "atlas-document-md"
        case "txt", "text", "log", "rtf": "atlas-document-txt"
        case "doc", "docx": "atlas-document-docx"
        case "xls", "xlsx": "atlas-document-xlsx"
        case "ppt", "pptx": "atlas-document-pptx"
        case "pdf": "atlas-document-pdf"
        case "mp3", "wav", "flac", "m4a", "ogg", "aac", "aiff", "opus": "atlas-document-audio"
        case "mp4", "mov", "webm", "mkv", "avi", "m4v": "atlas-document-video"
        case "png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "bmp", "ico", "icns": "atlas-image"
        case "svg": "tool-file-svg"
        case "zip", "tar", "gz", "tgz", "bz2", "xz", "rar", "7z": "tool-file-archive"
        default: nil
        }
        return asset.map { "registry-" + $0 }
    }
}

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
    static func matePreset(_ skill: ContextSkill, avatars: [String: MateAvatar] = [:]) -> MateRobotCatalogue.Preset? {
        guard let id = skill.mateID, let avatar = skill.mateAvatar ?? avatars[id] else { return nil }
        return MateRobotAssets.catalogue?.preset(for: avatar, mateID: id)
    }
    static func icon(_ image: UIImage?, skill: ContextSkill, size: CGFloat, tint: UIColor, onPrompt: Bool = false) -> UIImage {
        let file = skill.workspaceFile
        let isSkill = skill.group == "Skills"
        let asset = skill.mateID != nil ? "registry-assistant-steps" : isSkill ? "registry-sparkles" : "registry-box"
        let usesBackdrop = onPrompt && file != nil
        let source = file.map { WorkspaceFileArtwork.image(for: $0, tint: usesBackdrop ? .darkGray : tint) }
            ?? image ?? UIImage(named: asset)?.withTintColor(tint, renderingMode: .alwaysOriginal)
            ?? UIImage(systemName: isSkill ? "sparkles" : "cube")!.withTintColor(tint, renderingMode: .alwaysOriginal)
        return UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { _ in
            if usesBackdrop {
                UIColor(white: 1, alpha: 0.9).setFill()
                UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: size, height: size), cornerRadius: size * 0.2).fill()
            }
            let artworkSize = usesBackdrop ? size * 0.8 : size
            let scale = min(artworkSize / max(1, source.size.width), artworkSize / max(1, source.size.height))
            let rect = CGRect(x: (size - source.size.width * scale) / 2, y: (size - source.size.height * scale) / 2, width: source.size.width * scale, height: source.size.height * scale)
            source.draw(in: rect)
        }
    }
}

/// Same metadata-based token positions as the composer, rendered inside sent prompts.
struct InlineContextText: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let text: String
    let skills: [ContextSkill]
    let ink: Color
    @State private var artwork = ContextArtwork()
    @Environment(\.mateMentionAvatars) private var mateAvatars
    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 17
    var body: some View {
        let projection = ContextText(text, skills: skills, canonical: true)
        rendered(projection).foregroundStyle(ink).accessibilityLabel(projection.readable)
            .task(id: skills) { await artwork.load(skills) }
    }
    private func rendered(_ projection: ContextText) -> Text {
        let display = projection.display as NSString
        var result = Text(""), cursor = 0
        for mention in projection.mentions {
            let prefix = Text(display.substring(with: NSRange(location: cursor, length: mention.displayRange.location - cursor)))
            let skill = mention.skill
            let avatar = ContextArtwork.matePreset(skill, avatars: mateAvatars).flatMap { MateRobotAssets.image(for: $0) }
            let size = skill.mateID == nil ? iconSize : iconSize * 1.18
            let icon = ContextArtwork.icon(avatar ?? artwork.images[skill.name], skill: skill, size: size, tint: UIColor(ink), onPrompt: true)
            let symbol = Text(Image(uiImage: icon).renderingMode(.original)).baselineOffset(-iconSize * 0.14 - (size - iconSize) / 2)
            let title = Text((skill.mateID == nil ? " " : "\u{00a0}") + skill.mentionTitle).fontWeight(.semibold)
            result = Text("\(result)\(prefix)\(symbol)\(title)")
            cursor = NSMaxRange(mention.displayRange)
        }
        let suffix = Text(ContextMentions.strippingMarkers(display.substring(from: cursor)))
        return Text("\(result)\(suffix)")
    }
}

private final class ContextAttachment: NSTextAttachment {
    let skill: ContextSkill
    let scope: ContextScope
    @MainActor init(skill: ContextSkill, scope: ContextScope, font: UIFont, image: UIImage?, maxWidth: CGFloat) {
        self.skill = skill; self.scope = scope
        super.init(data: nil, ofType: nil)
        let preset = ContextArtwork.matePreset(skill)
        let avatar = preset.flatMap { MateRobotAssets.image(for: $0) }
        let color = preset.map { UIColor(MateRobotAssets.chatTint(for: $0.avatar)) } ?? ContextArtwork.color(skill)
        let title = skill.mentionTitle as NSString
        let iconSize = skill.mateID == nil ? font.pointSize : font.pointSize * 1.18
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let width = min(maxWidth, max(iconSize + 12, title.size(withAttributes: attributes).width + iconSize + 6))
        let height = ceil(font.lineHeight)
        let textTop = (height - font.lineHeight) / 2
        let iconTop = skill.mateID == nil ? (height - iconSize) / 2 : textTop + font.ascender - (font.capHeight + iconSize) / 2
        self.image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height)).image { _ in
            ContextArtwork.icon(avatar ?? image, skill: skill, size: iconSize, tint: color).draw(at: CGPoint(x: 0, y: iconTop))
            let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail
            title.draw(in: CGRect(x: iconSize + 6, y: textTop, width: max(1, width - iconSize - 6), height: height), withAttributes: attributes.merging([.paragraphStyle: paragraph]) { _, new in new })
        }
        bounds = CGRect(x: 0, y: font.descender, width: width, height: height)
    }
    required init?(coder: NSCoder) { nil }
}

@MainActor final class ComposerEditorSelection {
    fileprivate weak var view: ComposerTextView?

    var language: String? {
        guard let language = view?.textInputMode?.primaryLanguage, language != "emoji" else { return nil }
        return language
    }

    func insertionRange(in text: ContextText) -> NSRange {
        guard let view, view.isFirstResponder, view.attributedText.string == text.display,
              view.selectedRange.location <= text.display.utf16.count,
              view.selectedRange.length <= text.display.utf16.count - view.selectedRange.location else {
            return NSRange(location: text.display.utf16.count, length: 0)
        }
        return view.selectedRange
    }
}

struct ContextTextEditor: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Binding var text: String
    @Binding var skills: [ContextSkill]
    let scope: ContextScope
    @Binding var focused: Bool
    let placeholder: String
    let identifier: String
    var fillsHeight = false
    var reservedTrailingWidth: CGFloat = 0
    var compactRowHeight: CGFloat? = nil
    var showsSingleLine = false
    var scrollsHorizontally = false
    var centersCompactPlaceholder = true
    var onOverflowChange: ((Bool) -> Void)? = nil
    var selection: ComposerEditorSelection? = nil
    var stagesDictation = false
    @State private var artwork = ContextArtwork()
    @State private var measuredWidth: CGFloat = 320
    var body: some View {
        let hasSkills = !skills.isEmpty
        ContextTextInput(text: $text, skills: $skills, scope: scope, focused: $focused, placeholder: placeholder, identifier: identifier,
                         images: artwork.images, artworkRevision: artwork.revision, measuredWidth: measuredWidth,
                         fillsHeight: fillsHeight, reservedTrailingWidth: reservedTrailingWidth,
                         compactRowHeight: compactRowHeight, showsSingleLine: showsSingleLine, scrollsHorizontally: scrollsHorizontally,
                         onOverflowChange: onOverflowChange,
                         selection: selection, stagesDictation: stagesDictation)
            .overlay {
                if compactRowHeight != nil && text.isEmpty {
                    ComposerPlaceholderLayout(centered: showsSingleLine && centersCompactPlaceholder, topAligned: fillsHeight) {
                        Text(placeholder).font(.body).foregroundStyle(Color(.placeholderText)).lineLimit(1)
                    }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
            .task(id: skills) { await artwork.load(skills) }
            .onGeometryChange(for: CGFloat?.self) { hasSkills ? $0.size.width : nil } action: { width in
                if let width { measuredWidth = width }
            }
            .padding(.trailing, reservedTrailingWidth)
    }
}

private struct ComposerPlaceholderLayout: Layout {
    let topAligned: Bool
    private var alignment: CGFloat

    init(centered: Bool, topAligned: Bool) {
        self.topAligned = topAligned
        alignment = centered ? 1 : 0
    }

    var animatableData: CGFloat {
        get { alignment }
        set { alignment = newValue }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let label = subviews[0].sizeThatFits(.unspecified)
        return CGSize(width: proposal.width ?? label.width, height: proposal.height ?? label.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let width = min(bounds.width, subviews[0].sizeThatFits(.unspecified).width)
        let x = bounds.minX + (bounds.width - width) * alignment / 2
        subviews[0].place(at: CGPoint(x: x, y: topAligned ? bounds.minY : bounds.midY),
                          anchor: topAligned ? .topLeading : .leading, proposal: ProposedViewSize(width: width, height: nil))
    }
}

private struct ContextTextInput: UIViewRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Binding var text: String
    @Binding var skills: [ContextSkill]
    let scope: ContextScope
    @Binding var focused: Bool
    let placeholder: String
    let identifier: String
    let images: [String: UIImage]
    let artworkRevision: Int
    let measuredWidth: CGFloat
    let fillsHeight: Bool
    let reservedTrailingWidth: CGFloat
    let compactRowHeight: CGFloat?
    let showsSingleLine: Bool
    let scrollsHorizontally: Bool
    let onOverflowChange: ((Bool) -> Void)?
    let selection: ComposerEditorSelection?
    let stagesDictation: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.mainPaneCovered) private var mainPaneCovered

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> ComposerTextView {
        let view = ComposerTextView()
        view.backgroundColor = .clear; view.delegate = context.coordinator
        view.textContainerInset = .zero; view.textContainer.lineFragmentPadding = 0
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.keyboardDismissMode = .interactive; view.adjustsFontForContentSizeCategory = true
        view.accessibilityIdentifier = identifier
        selection?.view = view
        return view
    }
    func updateUIView(_ view: ComposerTextView, context: Context) {
        let coordinator = context.coordinator; coordinator.parent = self
        view.onOverflowChange = onOverflowChange
        view.reservedTrailingWidth = reservedTrailingWidth
        view.isUserInteractionEnabled = !mainPaneCovered
        view.isAccessibilityElement = !mainPaneCovered
        view.accessibilityElementsHidden = mainPaneCovered
        if coordinator.scope != scope {
            view.undoManager?.removeAllActions(); coordinator.scope = scope
        }
        let font = UIFont.preferredFont(forTextStyle: .body)
        let drawsSingleLine = scrollsHorizontally || showsSingleLine && !text.isEmpty
        let verticalInset = drawsSingleLine ? max(5, ((compactRowHeight ?? 0) - ceil(font.lineHeight)) / 2) : 0
        let horizontalInset: CGFloat = drawsSingleLine ? 4 : 0
        let insets = UIEdgeInsets(top: verticalInset, left: horizontalInset, bottom: verticalInset, right: horizontalInset)
        let lineLimit = drawsSingleLine ? 1 : 0
        let scrollDirectionChanged = view.scrollsHorizontally != scrollsHorizontally
        if scrollDirectionChanged || view.textContainer.maximumNumberOfLines != lineLimit || view.textContainerInset != insets {
            view.scrollsHorizontally = scrollsHorizontally
            view.textContainer.widthTracksTextView = !scrollsHorizontally
            view.textContainer.maximumNumberOfLines = lineLimit
            view.textContainer.lineBreakMode = scrollsHorizontally ? .byClipping : drawsSingleLine ? .byTruncatingTail : .byWordWrapping
            view.textContainerInset = insets
            view.isDirectionalLockEnabled = scrollsHorizontally
            view.keyboardDismissMode = scrollsHorizontally ? .none : .interactive
            view.showsHorizontalScrollIndicator = !scrollsHorizontally
            if scrollDirectionChanged || !scrollsHorizontally && drawsSingleLine { view.setContentOffset(.zero, animated: false) }
            view.invalidateTextMeasurement()
        }
        if view.font != font { view.font = font }
        view.textColor = .label; view.tintColor = .link
        view.typingAttributes = [.font: font, .foregroundColor: UIColor.label]
        view.placeholder.text = placeholder; view.placeholder.font = font
        view.placeholder.isHidden = compactRowHeight != nil || !text.isEmpty
        view.accessibilityLabel = placeholder
        let signature = "\(font.pointSize):\(colorScheme):\(skills.isEmpty ? 0 : measuredWidth):\(artworkRevision)"
        let projection = ContextText(text, skills: skills)
        let source = coordinator.source(view.attributedText)
        let typedLineBreak = scrollsHorizontally && view.attributedText.string.rangeOfCharacter(from: .newlines) != nil
        let linePresentationChanged = coordinator.presentedHorizontally != scrollsHorizontally
        if view.markedTextRange == nil, source != text || coordinator.skills != skills || coordinator.signature != signature
            || linePresentationChanged || typedLineBreak {
            let selection = projection.selection(after: coordinator.projection, range: view.selectedRange)
            let value = NSMutableAttributedString(string: projection.display, attributes: [.font: font, .foregroundColor: UIColor.label])
            for mention in projection.mentions {
                let token = ContextAttachment(skill: mention.skill, scope: scope, font: font, image: images[mention.skill.name], maxWidth: max(80, measuredWidth - 4))
                value.addAttribute(.attachment, value: token, range: mention.displayRange)
            }
            if scrollsHorizontally { presentLineBreaksAsSpaces(in: value) }
            let onlyLinePresentationChanged = source == text && (linePresentationChanged || typedLineBreak)
                && view.attributedText.length == value.length
            if view.attributedText.string != value.string && !onlyLinePresentationChanged {
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
            coordinator.presentedHorizontally = scrollsHorizontally
            view.invalidateTextMeasurement()
        }
        view.accessibilityValue = projection.readable
        view.onCopy = { [weak view, weak coordinator] in
            guard let view, let coordinator else { return }
            let range = view.selectedRange
            let selected = view.attributedText.attributedSubstring(from: range)
            UIPasteboard.general.string = ContextMentions.strippingMarkers(coordinator.source(selected))
        }
        let wantsFocus = focused && !mainPaneCovered && !coordinator.isEndingEditing
        view.wantsFocus = wantsFocus
        if wantsFocus, !view.isFirstResponder { view.requestFocus() }
        else if !wantsFocus, view.isFirstResponder { view.resignFirstResponder() }
    }

    private func presentLineBreaksAsSpaces(in value: NSMutableAttributedString) {
        // Keep each break's UTF-16 position and restore it when reading the draft or selection.
        let text = value.string as NSString
        var start = 0
        while start < text.length {
            let searchRange = NSRange(location: start, length: text.length - start)
            let range = text.rangeOfCharacter(from: .newlines, options: [], range: searchRange)
            guard range.location != NSNotFound else { break }
            let lineBreak = text.substring(with: range)
            value.replaceCharacters(in: range, with: String(repeating: " ", count: range.length))
            value.addAttribute(.composerLineBreak, value: lineBreak, range: range)
            start = NSMaxRange(range)
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ComposerTextView, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        let font = uiView.font ?? .preferredFont(forTextStyle: .body)
        let minimum = ceil(font.lineHeight)
        if fillsHeight || compactRowHeight != nil, let height = proposal.height, height.isFinite {
            return CGSize(width: width, height: max(minimum, height))
        }
        if showsSingleLine || uiView.textContainer.maximumNumberOfLines == 1 {
            // SwiftUI can ask for the new size before UIKit adopts the new line mode.
            return CGSize(width: width, height: text.isEmpty ? minimum : context.coordinator.multilineHeight ?? minimum)
        }
        // Measure the empty line with TextKit too, so typing the first character keeps its height.
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let height = max(minimum, min(uiView.compactHeightLimit, fitted.height))
        if compactRowHeight != nil { context.coordinator.multilineHeight = height }
        return CGSize(width: width, height: height)
    }
    static func dismantleUIView(_ uiView: ComposerTextView, coordinator: Coordinator) {
        uiView.wantsFocus = false
        uiView.onOverflowChange = nil
        uiView.delegate = nil
    }

    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ContextTextInput
        var projection = ContextText("", skills: [])
        var skills: [ContextSkill] = []
        var scope: ContextScope?
        var signature = ""
        var presentedHorizontally = false
        var multilineHeight: CGFloat?
        private(set) var isEndingEditing = false
        init(_ parent: ContextTextInput) { self.parent = parent }
        func source(_ value: NSAttributedString) -> String {
            var result = ""
            value.enumerateAttributes(in: NSRange(location: 0, length: value.length)) { attributes, range, _ in
                let string = value.attributedSubstring(from: range).string
                if let token = attributes[.attachment] as? ContextAttachment {
                    result += string.replacingOccurrences(of: "\u{fffc}", with: token.scope == parent.scope ? ContextMentions.mention(token.skill) : token.skill.title)
                } else if let lineBreak = attributes[.composerLineBreak] as? String {
                    result += String(repeating: lineBreak, count: range.length / lineBreak.utf16.count)
                } else { result += string }
            }
            return result
        }
        func textViewDidChange(_ view: UITextView) {
            guard !parent.stagesDictation else { return }
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
            if let editor = view as? ComposerTextView {
                editor.placeholder.isHidden = parent.compactRowHeight != nil || !value.isEmpty
                editor.invalidateTextMeasurement()
            }
        }
        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            !parent.stagesDictation
        }
        func textViewDidChangeSelection(_ view: UITextView) {
            view.typingAttributes = [.font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.label]
        }
        func textViewDidBeginEditing(_ view: UITextView) {
            isEndingEditing = false
            if !parent.focused { parent.focused = true }
        }
        func textViewDidEndEditing(_ view: UITextView) {
            // Cancel queued focus before the keyboard resize can update this view.
            isEndingEditing = true
            (view as? ComposerTextView)?.wantsFocus = false
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, view.delegate === self, self.isEndingEditing else { return }
                if !view.isFirstResponder, self.parent.focused { self.parent.focused = false }
                self.isEndingEditing = false
            }
        }
    }
}

final class ComposerTextView: UITextView {
    let placeholder = UILabel()
    var wantsFocus = false
    var scrollsHorizontally = false
    var onCopy: (() -> Void)?
    var onOverflowChange: ((Bool) -> Void)?
    var reservedTrailingWidth: CGFloat = 0 {
        didSet {
            if reservedTrailingWidth != oldValue {
                needsTextMeasurement = true
                setNeedsLayout()
            }
        }
    }
    var compactHeightLimit: CGFloat { ceil((font ?? .preferredFont(forTextStyle: .body)).lineHeight * 6) }
    private var measuredViewport = CGSize.zero
    private var needsTextMeasurement = true
    private var overflows: Bool?
    init() {
        super.init(frame: .zero, textContainer: nil)
        placeholder.textColor = .placeholderText; placeholder.isUserInteractionEnabled = false
        addSubview(placeholder)
    }
    required init?(coder: NSCoder) { nil }
    func invalidateTextMeasurement() {
        needsTextMeasurement = true
        invalidateIntrinsicContentSize()
        setNeedsLayout()
    }

    override func layoutSubviews() {
        let insets = textContainerInset
        let resized = measuredViewport != bounds.size
        let measure = bounds.width > 0 && bounds.height > 0 && (resized || needsTextMeasurement)
        if scrollsHorizontally && measure {
            let width = max(bounds.width - insets.left - insets.right, ceil(attributedText.size().width) + 4)
            textContainer.size = CGSize(width: width, height: .greatestFiniteMagnitude)
            isScrollEnabled = true
        }
        super.layoutSubviews()
        placeholder.frame = CGRect(x: insets.left, y: insets.top, width: max(0, bounds.width - insets.left - insets.right),
                                   height: font?.lineHeight ?? 22)
        if scrollsHorizontally {
            // UITextView sizes its scroll area for the viewport even with a wider text container.
            let size = CGSize(width: textContainer.size.width + insets.left + insets.right, height: bounds.height)
            if bounds.width > 0, bounds.height > 0, contentSize != size { contentSize = size }
        }
        guard measure else { return }
        measuredViewport = bounds.size
        needsTextMeasurement = false
        if scrollsHorizontally {
            if isFirstResponder, let selection = selectedTextRange {
                scrollRectToVisible(caretRect(for: selection.end).insetBy(dx: -4, dy: 0), animated: false)
            }
            return
        }
        let empty = !hasText
        let fittedHeight = empty ? ceil((font ?? .preferredFont(forTextStyle: .body)).lineHeight)
            : sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height
        let isSingleLine = textContainer.maximumNumberOfLines == 1
        let needsScrolling = !isSingleLine && fittedHeight > bounds.height + 0.5
        if needsScrolling != isScrollEnabled { isScrollEnabled = needsScrolling }
        if resized, isFirstResponder, needsScrolling { scrollRangeToVisible(selectedRange) }
        guard !isSingleLine, onOverflowChange != nil else { return }
        // Check the original width so the space for the button cannot keep it visible.
        let fullHeight = !empty && reservedTrailingWidth > 0
            ? sizeThatFits(CGSize(width: bounds.width + reservedTrailingWidth, height: .greatestFiniteMagnitude)).height
            : fittedHeight
        let overflowsWithoutButton = fullHeight > compactHeightLimit + 0.5
        guard overflows != overflowsWithoutButton else { return }
        overflows = overflowsWithoutButton
        DispatchQueue.main.async { [weak self] in
            guard let self, self.overflows == overflowsWithoutButton else { return }
            self.onOverflowChange?(overflowsWithoutButton)
        }
    }
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
            insertText(ContextMentions.strippingMarkers(text.replacingOccurrences(of: "\u{fffc}", with: "")))
        }
    }
}
