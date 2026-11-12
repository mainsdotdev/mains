import SwiftUI

struct ConsentContext: Identifiable {
    let backendID: String
    let providerID: String
    var isDemo = false
    var isVoice = false
    var id: String { backendID + ":" + providerID }
}

struct ConsentView: View {
    let context: ConsentContext
    let allow: () -> Void
    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .body) private var sheetHeight: CGFloat = 620
    @ScaledMetric(relativeTo: .body) private var buttonHeight: CGFloat = 50
    private var recipient: String {
        switch context.providerID {
        case "copilot_cli": "GitHub Copilot"
        case "cursor": "Cursor"
        case "opencode": "the model provider selected in OpenCode"
        default: Provider.recipient(context.providerID)
        }
    }
    private var recipientDetail: String {
        switch context.providerID {
        case "codex": "OpenAI processes the data through Codex."
        case "claude_code": "Anthropic processes the data through Claude Code."
        case "copilot_cli": "GitHub processes the data through Copilot and may route it to the model provider selected by Copilot."
        case "cursor": "Anysphere processes the data through Cursor and may route it to the model provider selected by Cursor."
        case "opencode": "OpenCode runs locally and sends prompts to the model provider you signed in with, such as Anthropic, OpenAI, or OpenCode Zen."
        default: "Your computer uses \(Provider.name(context.providerID)) to complete your request."
        }
    }
    var body: some View {
        VStack(spacing: 0) {
            Text(context.isDemo ? "Demo data sharing" : "AI data sharing").font(.headline)
                .frame(maxWidth: .infinity, minHeight: 44)
                .overlay(alignment: .leading) {
                    RoundControl(symbol: "xmark", label: "Close", size: 40) { dismiss() }
                        .accessibilityIdentifier("closeDataSharing")
                }
                .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(spacing: 6) {
                        Text(context.isDemo ? "Continue the demo with \(Provider.name(context.providerID))?" : "Share data with \(recipient)?").font(.title3.bold())
                            .accessibilityAddTraits(.isHeader)
                        Text(context.isDemo ? "This run uses bundled sample data. Your message and attachments stay on this iPhone; no computer or AI service is contacted." : context.isVoice ? "During GPT Live, your microphone audio goes to OpenAI. Mains on your computer supplies the conversation context and runs delegated work." : "Mains on your computer will share the following with this third-party AI service to complete your request.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }.multilineTextAlignment(.center).frame(maxWidth: .infinity)

                    VStack(spacing: 0) {
                        if context.isVoice { category("Your microphone audio during the call"); Divider().padding(.horizontal, 16) }
                        category("Your message and chat history")
                        Divider().padding(.horizontal, 16)
                        category("Skills and instructions you attach")
                        Divider().padding(.horizontal, 16)
                        category("Files and tool results the agent uses")
                    }
                    .background(Color(.tertiarySystemBackground), in: .rect(cornerRadius: 20))
                    .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(.primary.opacity(0.08)) }

                    Text(context.isDemo ? "This choice applies only to Demo Mode. Mains asks separately before sharing data with a provider on a paired computer." : "\(recipientDetail) Mains sends nothing until you choose \(context.isVoice ? "Allow & Start" : "Allow & Send").")
                        .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 8)

                    VStack(alignment: .leading, spacing: 0) {
                        if let url = Provider.privacyURL(context.providerID) {
                            Link(destination: url) {
                                Text("\(Provider.name(context.providerID)) Privacy")
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(.rect)
                            }.accessibilityIdentifier("providerPrivacy")
                        }
                        Link(destination: URL(string: "https://mains.dev/privacy")!) {
                            Text("Mains Privacy").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(.rect)
                        }.accessibilityIdentifier("mainsPrivacy")
                    }
                    .font(.subheadline.weight(.semibold)).tint(.blue).foregroundStyle(.blue)
                    .buttonStyle(.plain)
                    .padding(.horizontal, 8)
                }.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 12)
            }
            .scrollBounceBehavior(.basedOnSize)
            actions.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 16)
        }
        .presentationDetents([.height(sheetHeight), .large])
        .presentationDragIndicator(.visible).presentationCornerRadius(40)
        .presentationBackground(.regularMaterial)
    }
    private func category(_ title: String) -> some View {
        Text(title).font(.subheadline)
            .frame(maxWidth: .infinity, minHeight: 22, alignment: .leading)
            .padding(.horizontal, 16).padding(.vertical, 10)
    }
    private var actions: some View {
        GeometryReader { geometry in
            HStack(spacing: 10) {
                Button { dismiss() } label: {
                    Text("Not Now").foregroundStyle(.primary).frame(maxWidth: .infinity, minHeight: buttonHeight)
                        .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 14))
                }
                .frame(width: max(0, geometry.size.width - 10) * 0.43)
                .accessibilityIdentifier("declineDataSharing")
                Button { allow(); dismiss() } label: {
                    Text(context.isDemo ? "Continue Demo" : context.isVoice ? "Allow & Start" : "Allow & Send").foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: buttonHeight)
                        .background(Provider.accent(context.providerID), in: .rect(cornerRadius: 14))
                }
                .accessibilityHint(context.isDemo ? "Continues the on-device demo without granting real provider permission." : "Allows sharing for this computer and provider.")
                .accessibilityIdentifier("allowDataSharing")
            }.font(.headline).buttonStyle(ChatPressStyle())
        }.frame(height: buttonHeight)
    }
}
