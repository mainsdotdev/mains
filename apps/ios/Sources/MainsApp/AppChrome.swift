import SwiftUI

enum AppBrand {
    static var accent: Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 59 / 255, green: 130 / 255, blue: 246 / 255, alpha: 1)
                : UIColor(red: 37 / 255, green: 99 / 255, blue: 235 / 255, alpha: 1)
        })
    }
}

extension Provider {
    static func accent(_ id: String?) -> Color {
        switch id {
        case "claude_code": Color(red: 0.85, green: 0.47, blue: 0.34)
        case "codex": Color(red: 0.004, green: 0.412, blue: 0.80)
        case "copilot_cli": Color(red: 0.52, green: 0.20, blue: 0.95)
        case "cursor": Color(white: 0.45)
        case "opencode": Color(red: 0.36, green: 0.42, blue: 1)
        default: .blue
        }
    }
}

struct GlassSurface: ViewModifier {
    var radius: CGFloat = 28
    var tint: Color = .clear
    var interactive = true
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(Color(.secondarySystemBackground), in: .rect(cornerRadius: radius))
                .overlay { RoundedRectangle(cornerRadius: radius).strokeBorder(.primary.opacity(0.12)) }
        } else if #available(iOS 26.0, *) {
            content.glassEffect(.regular.tint(tint).interactive(interactive), in: .rect(cornerRadius: radius))
        } else {
            content.background(.regularMaterial, in: .rect(cornerRadius: radius))
                .background(tint, in: .rect(cornerRadius: radius))
                .overlay { RoundedRectangle(cornerRadius: radius).strokeBorder(.primary.opacity(0.10)) }
        }
    }
}

struct RoundControl: View {
    let symbol: String
    let label: String
    var size: CGFloat = 46
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 21, weight: .regular))
                .frame(width: size, height: size).contentShape(.circle)
        }
        .buttonStyle(ChatPressStyle()).modifier(GlassSurface(radius: size / 2))
        .accessibilityLabel(label)
    }
}

/// Matches mobile's SidebarIcon: two leading-aligned strokes on a 24-unit grid.
struct SidebarIcon: View {
    var body: some View {
        Path { path in
            let scale = 22.0 / 24.0
            path.move(to: CGPoint(x: 4 * scale, y: 9 * scale))
            path.addLine(to: CGPoint(x: 20 * scale, y: 9 * scale))
            path.move(to: CGPoint(x: 4 * scale, y: 15 * scale))
            path.addLine(to: CGPoint(x: 14 * scale, y: 15 * scale))
        }
        .stroke(style: StrokeStyle(lineWidth: 2.2 * 22 / 24, lineCap: .round))
        .frame(width: 22, height: 22)
        .accessibilityHidden(true)
    }
}

struct SidebarControl: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            SidebarIcon().frame(width: 46, height: 46).contentShape(.circle)
        }
        .buttonStyle(ChatPressStyle()).modifier(GlassSurface(radius: 23))
        .accessibilityLabel("Open sidebar").accessibilityIdentifier("openSidebar")
    }
}

/// Uses the same vector registry and stored icon tokens as desktop and Expo.
struct RegistryIcon: View {
    let token: String?
    var fallback = "folder"
    var size: CGFloat = 20
    var tint: Color = .secondary
    var useStoredColor = true
    @Environment(\.colorScheme) private var scheme
    private var parts: [String] {
        let stored = token ?? ""
        let value = stored.hasPrefix("icon:") ? String(stored.dropFirst(5)) : stored
        return value.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    }
    private var resolvedTint: Color { useStoredColor ? (Self.color(token, dark: scheme == .dark) ?? tint) : tint }
    var body: some View {
        Group {
            if let token, token.hasPrefix("emoji:") {
                Text(String(token.dropFirst(6))).font(.system(size: size))
            } else if let name = parts.first, UIImage(named: "registry-" + name.lowercased()) != nil {
                Image("registry-" + name.lowercased()).renderingMode(.template).resizable().scaledToFit()
                    .foregroundStyle(resolvedTint)
            } else if let token, !token.hasPrefix("icon:"), token.unicodeScalars.contains(where: { $0.properties.isEmoji && $0.value > 127 }) {
                Text(token).font(.system(size: size))
            } else { Image(systemName: fallback).resizable().scaledToFit().foregroundStyle(resolvedTint) }
        }.frame(width: size, height: size).accessibilityHidden(true)
    }
    static func color(_ token: String?, dark: Bool) -> Color? {
        guard token?.hasPrefix("emoji:") != true,
              let value = token?.components(separatedBy: "|").dropFirst().first?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !value.isEmpty, value != "default",
              let color = UIColor(named: "registry-color-" + value) else { return nil }
        return Color(uiColor: color.resolvedColor(with: UITraitCollection(userInterfaceStyle: dark ? .dark : .light)))
    }
}

struct BridgeIcon: View {
    var size: CGFloat = 16
    var body: some View {
        RegistryIcon(token: "icon:bridge", size: size, tint: .secondary)
    }
}

struct BridgeReadOnlyNotice: View {
    let text: String
    var body: some View {
        HStack(spacing: 10) {
            BridgeIcon(size: 20)
            Text(text).font(.footnote).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(.primary.opacity(0.06)) }
        .accessibilityElement(children: .combine).accessibilityIdentifier("readOnlyNotice")
    }
}

struct SpaceDisc: View {
    let space: Space
    let selected: Bool
    let action: () -> Void
    var body: some View {
        let accent = Provider.accent(space.providerId)
        Button(action: action) {
            Group {
                if space.icon != nil { RegistryIcon(token: space.icon, size: 25, tint: selected ? accent : .primary) }
                else { Text(String(space.name.prefix(1)).uppercased()).font(.title3.weight(.semibold)) }
            }.frame(width: 44, height: 44).contentShape(.circle)
        }
        .buttonStyle(ChatPressStyle())
        .modifier(GlassSurface(radius: 22, tint: selected ? accent.opacity(0.18) : .clear))
        .overlay { Circle().strokeBorder(selected ? accent : .clear, lineWidth: 1) }
        .accessibilityLabel("\(space.name) space")
        .accessibilityIdentifier("space-\(space.id)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
