import SwiftUI

struct RunDecisionCards: View {
    let session: BackendSession
    let runID: String
    let providerID: String
    var body: some View {
        if session.viewingRunID == runID, let run = session.conversations.first(where: { $0.id == runID }), run.isReplica != true {
            TimelineView(.periodic(from: .now, by: 1)) { clock in
                let approvals = session.pendingApprovals.filter { $0.runId == runID && $0.expiresAt > clock.date }
                VStack(spacing: 16) {
                    ForEach(approvals) { approval in
                        PendingApprovalCard(session: session, approval: approval, providerID: providerID, now: clock.date)
                    }
                    if approvals.isEmpty, let questions = session.pendingQuestions {
                        AsyncQuestionCard(session: session, pending: questions, providerID: providerID)
                            .id(questions.id)
                    }
                }
            }
        }
    }
}

private struct PendingApprovalCard: View {
    let session: BackendSession
    let approval: PendingApproval
    let providerID: String
    let now: Date
    @Bindable private var delivery: DecisionDelivery
    @State private var selected: [String] = []
    @State private var answer = ""
    @State private var allowForRun = false
    @State private var showParameters = false
    @State private var error: String?
    @State private var demoLink = false
    @State private var openingLink = false
    private var accent: Color { Provider.accent(providerID) }
    private var display: ApprovalPresentation { ApprovalPresentation(approval) }
    private var isTool: Bool { approval.kind == "tool_approval" }
    private var busy: Bool { delivery.locked || !session.isConnected || openingLink }
    private var canAllowForRun: Bool { providerID == "codex" && approval.suppressAlwaysAllowRule != true }
    private var questionAnswer: String { selected.isEmpty ? answer.trimmingCharacters(in: .whitespacesAndNewlines) : selected.joined(separator: ", ") }

    init(session: BackendSession, approval: PendingApproval, providerID: String, now: Date) {
        self.session = session; self.approval = approval; self.providerID = providerID; self.now = now
        delivery = session.decisionState(for: approval.id)
    }

    var body: some View {
        if delivery.phase != .done {
            VStack(alignment: .leading, spacing: isTool ? 8 : 14) {
                HStack(spacing: 8) {
                    Label(isTool ? display.label : approval.kind == "ask_user" ? "Question" : "Input needed",
                          systemImage: isTool ? display.symbol : "questionmark.bubble")
                        .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading)
                    if delivery.phase == .sending { ProgressView().controlSize(.mini) }
                    if let risk = display.risk {
                        Text("\(risk.capitalized) risk").font(.caption2.weight(.medium)).foregroundStyle(risk == "high" ? .red : risk == "medium" ? .orange : .green)
                    }
                    if isTool {
                        Button { respond(approved: false) } label: {
                            Image(systemName: "xmark").font(.footnote.weight(.medium)).frame(width: 44, height: 44)
                        }.buttonStyle(.plain).foregroundStyle(.secondary).disabled(busy)
                            .accessibilityLabel("Cancel approval").accessibilityIdentifier("approvalClose")
                    } else {
                        Text(remaining).font(.caption.monospacedDigit()).foregroundStyle(.secondary).accessibilityLabel("Time remaining: \(remaining)")
                    }
                }
                Text(display.title).font(isTool ? .subheadline.weight(.medium) : .headline).accessibilityIdentifier("approvalTitle")
                if isTool {
                    ApprovalPreviewViewport {
                        VStack(alignment: .leading, spacing: 8) {
                            if let subtitle = display.subtitle { Text(subtitle).font(.footnote).foregroundStyle(.secondary) }
                            toolPreview
                        }
                    }
                } else if let subtitle = display.subtitle { Text(subtitle).font(.subheadline).foregroundStyle(.secondary) }
                if approval.kind != "tool_approval", approval.header != nil, let question = approval.question { Text(question).font(.subheadline) }
                if delivery.phase == .uncertain {
                    DecisionRecovery(delivery: delivery, enabled: session.isConnected) {
                        perform { try await session.respondToApproval(approval, approved: false, checkOnly: true) }
                    }
                } else if approval.supported {
                    answerSurface.disabled(busy)
                } else { Text("Complete this request in Mains on your computer.").font(.footnote).foregroundStyle(.secondary) }
                if let message = delivery.error ?? error { Text(message).font(.footnote).foregroundStyle(.red).textSelection(.enabled) }
                if !isTool {
                    Text(approval.isForm ? "Mains cancels this if unanswered." : "Mains denies this if unanswered.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(isTool ? 12 : 16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 20))
            .sheet(isPresented: $demoLink) {
                ComposerSheet(title: "Demo connection") {
                    VStack(spacing: 20) {
                        Image(systemName: "link").font(.largeTitle).foregroundStyle(accent)
                        Text("This is a sample connection request. No browser or external account is opened in Demo Mode.")
                            .font(.body).multilineTextAlignment(.center)
                        Button("Accept demo link") { demoLink = false; respond(approved: true) }
                            .buttonStyle(DecisionActionStyle(accent: accent, prominent: true)).accessibilityIdentifier("acceptDemoLink")
                    }.padding(24)
                }.presentationDetents([.medium])
            }
        }
    }

    private var remaining: String {
        let seconds = Int(max(0, min(300, ceil(approval.expiresAt.timeIntervalSince(now)))))
        return "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }
    @ViewBuilder private var toolPreview: some View {
        switch display.preview {
        case .command(let command):
            VStack(alignment: .leading, spacing: 0) {
                if command.shell != nil || !command.directory.isEmpty || command.timeout != nil {
                    HStack(alignment: .top, spacing: 8) {
                        if let shell = command.shell { Text(shell) }
                        if !command.directory.isEmpty { Text(command.directory).frame(maxWidth: .infinity, alignment: .leading) }
                        if let timeout = command.timeout { Text(timeout) }
                    }.font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary).padding(10)
                    Divider()
                }
                Text("$ " + command.command).font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(10)
            }.background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.primary.opacity(0.07)))
        case .files(let files):
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(files.enumerated()), id: \.offset) { _, file in
                    VStack(alignment: .leading, spacing: 6) {
                        Label(file.path.isEmpty ? "File" : file.path, systemImage: "doc.text")
                            .font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).textSelection(.enabled)
                        if !file.content.isEmpty {
                            Text(file.diff ? diffText(file.content) : AttributedString(file.content))
                                .font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(10)
                                .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 10))
                        }
                    }
                }
            }
        case .fields:
            if !display.parameters.isEmpty { parameters }
        }
    }
    private func diffText(_ text: String) -> AttributedString {
        var result = AttributedString()
        for (index, line) in text.components(separatedBy: "\n").enumerated() {
            if index > 0 { result.append(AttributedString("\n")) }
            var fragment = AttributedString(line)
            if line.hasPrefix("+") && !line.hasPrefix("+++") { fragment.foregroundColor = .green }
            if line.hasPrefix("-") && !line.hasPrefix("---") { fragment.foregroundColor = .red }
            result.append(fragment)
        }
        return result
    }
    private var parameters: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(showParameters ? display.parameters : Array(display.parameters.prefix(4))) { param in
                HStack(alignment: .top, spacing: 12) {
                    Text(param.label).font(.caption).foregroundStyle(.secondary).frame(width: 86, alignment: .leading)
                    Text(param.value).font(.footnote).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if display.parameters.count > 4 {
                Button(showParameters ? "Show fewer" : "Show \(display.parameters.count - 4) more") { showParameters.toggle() }.font(.footnote).tint(accent)
            }
        }.padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 10))
    }

    @ViewBuilder private var answerSurface: some View {
        if approval.kind == "tool_approval" {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    if canAllowForRun { runPermission }
                    Spacer(minLength: 0)
                    toolActions
                }
                VStack(alignment: .leading, spacing: 0) {
                    if canAllowForRun { runPermission }
                    HStack { Spacer(minLength: 0); toolActions }
                }
            }
        } else if approval.kind == "ask_user" {
            VStack(spacing: 10) {
                ForEach(Array((approval.options ?? []).enumerated()), id: \.offset) { _, option in
                    DecisionOption(title: option.label, detail: option.description, selected: selected.contains(option.label), accent: accent) {
                        answer = ""
                        if selected.contains(option.label) { selected.removeAll { $0 == option.label } }
                        else if approval.multiSelect == true { selected.append(option.label) }
                        else { selected = [option.label] }
                    }
                }
                if approval.options?.isEmpty != false || approval.isOther == true {
                    DecisionTextInput(label: "Your answer", secret: approval.isSecret == true, text: $answer)
                        .onChange(of: answer) { _, text in if !text.isEmpty { selected = [] } }
                }
                HStack {
                    Button("Dismiss") { respond(approved: false) }.buttonStyle(DecisionActionStyle(accent: accent)).accessibilityIdentifier("questionDismiss")
                    Button("Send answer") { respond(approved: true, answer: questionAnswer) }
                        .buttonStyle(DecisionActionStyle(accent: accent, prominent: true)).disabled(questionAnswer.isEmpty).accessibilityIdentifier("questionSend")
                }
            }
        } else if approval.isForm {
            ElicitationFormView(form: ElicitationForm(schema: approval.requestedSchema), accent: accent) { approved, answer in respond(approved: approved, answer: answer) }
        } else {
            HStack {
                Button("Decline") { respond(approved: false) }.buttonStyle(DecisionActionStyle(accent: accent)).accessibilityIdentifier("linkDecline")
                if let url = approval.safeURL {
                    Button("Open & accept") {
                        if session.isDemo { demoLink = true }
                        else { openLink(url) }
                    }.buttonStyle(DecisionActionStyle(accent: accent, prominent: true)).accessibilityIdentifier("linkAccept")
                } else { Text("Open this request on your computer.").font(.footnote).foregroundStyle(.secondary) }
            }
        }
    }
    private var runPermission: some View {
        Button { allowForRun.toggle() } label: {
            Label("This run", systemImage: allowForRun ? "checkmark.square.fill" : "square")
                .font(.footnote).foregroundStyle(allowForRun ? accent : .secondary).frame(minHeight: 44)
        }.buttonStyle(.plain).accessibilityLabel("Allow for this run")
            .accessibilityAddTraits(allowForRun ? .isSelected : []).accessibilityIdentifier("allowForRun")
    }
    private var toolActions: some View {
        HStack(spacing: 8) {
            Button("Cancel") { respond(approved: false) }.buttonStyle(CompactApprovalActionStyle(accent: accent))
                .accessibilityIdentifier("approvalDeny")
            Button("Allow") { respond(approved: true, answer: canAllowForRun && allowForRun ? "acceptForSession" : nil) }
                .buttonStyle(CompactApprovalActionStyle(accent: accent, prominent: true)).accessibilityIdentifier("approvalAllow")
        }
    }
    @Environment(\.openURL) private var openURL
    private func openLink(_ url: URL) {
        let owner = session.ownership; openingLink = true
        openURL(url) { opened in
            openingLink = false
            guard owner == session.ownership, session.viewingRunID == approval.runId else { return }
            if opened { respond(approved: true) } else { error = "The link couldn’t open. Try again or complete it on your computer." }
        }
    }
    private func respond(approved: Bool, answer: String? = nil) {
        perform { try await session.respondToApproval(approval, approved: approved, answer: answer) }
    }
    private func perform(_ action: @escaping @MainActor () async throws -> Void) {
        error = nil
        Task { do { try await action() } catch { self.error = error.localizedDescription } }
    }
}

/// Keep the footer reachable without truncating the proposed command or connector parameters.
private struct ApprovalPreviewViewport<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        ViewThatFits(in: .vertical) {
            content.fixedSize(horizontal: false, vertical: true)
            ScrollView { content }.frame(height: 180)
        }.frame(maxHeight: 180)
    }
}

private struct CompactApprovalActionStyle: ButtonStyle {
    let accent: Color
    var prominent = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.medium)).padding(.horizontal, 14).frame(minHeight: 44)
            .foregroundStyle(prominent ? .white : .primary)
            .background(prominent ? accent : Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
            .opacity(!enabled ? 0.45 : configuration.isPressed ? 0.6 : 1)
    }
}

private struct AsyncQuestionCard: View {
    let session: BackendSession
    let pending: PendingAsyncQuestions
    let providerID: String
    @Bindable private var delivery: DecisionDelivery
    @State private var answers: [String]
    @State private var index = 0
    @State private var error: String?
    @State private var consent: ConsentContext?
    private var accent: Color { Provider.accent(providerID) }
    private var question: AsyncQuestion { pending.questions[index] }
    private var busy: Bool { delivery.locked || !session.isConnected }

    init(session: BackendSession, pending: PendingAsyncQuestions, providerID: String) {
        self.session = session; self.pending = pending; self.providerID = providerID
        delivery = session.decisionState(for: pending.id)
        _answers = State(initialValue: pending.questions.map { _ in "" })
    }

    var body: some View {
        if delivery.phase != .done {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Question", systemImage: "questionmark.bubble").foregroundStyle(accent)
                    Spacer()
                    if delivery.phase == .sending { ProgressView().controlSize(.mini) }
                    Text("\(index + 1) of \(pending.questions.count)").foregroundStyle(.secondary)
                }.font(.subheadline.weight(.semibold))
                Text(question.title).font(.headline).accessibilityIdentifier("asyncQuestionTitle")
                VStack(spacing: 10) {
                    ForEach(Array(question.options.enumerated()), id: \.offset) { _, option in
                        DecisionOption(title: option, selected: answers[index] == option, accent: accent) { answers[index] = option }
                    }
                    DecisionTextInput(label: question.options.isEmpty ? "Your answer" : "Or type a custom answer", text: $answers[index])
                }.disabled(busy)
                if delivery.phase == .uncertain {
                    DecisionRecovery(delivery: delivery, enabled: session.isConnected) { perform { try await session.checkQuestionDelivery(pending) } }
                } else {
                    HStack {
                        Button("Dismiss") { perform { try await session.dismissQuestions(pending) } }
                            .buttonStyle(DecisionActionStyle(accent: accent)).accessibilityIdentifier("asyncDismiss")
                        if index > 0 {
                            Button("Back") { index -= 1 }.buttonStyle(DecisionActionStyle(accent: accent)).accessibilityIdentifier("asyncBack")
                        }
                        Button(index == pending.questions.count - 1 ? "Send answers" : "Next") {
                            if index < pending.questions.count - 1 { index += 1 } else { prepareAnswer() }
                        }
                        .buttonStyle(DecisionActionStyle(accent: accent, prominent: true))
                        .disabled(answers[index].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("asyncNext")
                    }.disabled(busy)
                }
                if let message = delivery.error ?? error { Text(message).font(.footnote).foregroundStyle(.red) }
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 20))
            .sheet(item: $consent) { context in
                ConsentView(context: context) {
                    guard session.pendingQuestions?.id == pending.id else { return }
                    session.grantConsent(providerID: context.providerID, backendID: context.backendID)
                    perform { try await session.answerQuestions(pending, answers: answers) }
                }
            }
        }
    }
    private func prepareAnswer() {
        if !session.hasConsent(providerID: providerID), let backendID = session.pairing?.descriptor.backendId {
            consent = ConsentContext(backendID: backendID, providerID: providerID, isDemo: session.isDemo)
        } else { perform { try await session.answerQuestions(pending, answers: answers) } }
    }
    private func perform(_ action: @escaping @MainActor () async throws -> Void) {
        error = nil
        Task { do { try await action() } catch { self.error = error.localizedDescription } }
    }
}

private struct ElicitationFormView: View {
    let form: ElicitationForm
    let accent: Color
    let respond: (Bool, String?) -> Void
    @State private var values: [String: JSONValue]
    @State private var errors: [String: String] = [:]
    init(form: ElicitationForm, accent: Color, respond: @escaping (Bool, String?) -> Void) {
        self.form = form; self.accent = accent; self.respond = respond
        _values = State(initialValue: form.defaults)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(form.fields) { field in
                VStack(alignment: .leading, spacing: 8) {
                    Text(field.label + (field.required ? " *" : "")).font(.subheadline.weight(.medium))
                    if let description = field.description { Text(description).font(.footnote).foregroundStyle(.secondary) }
                    fieldInput(field)
                    if let error = errors[field.name] { Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("formError-" + field.name) }
                }
            }
            if !form.unsupported.isEmpty {
                Text("Unsupported fields: \(form.unsupported.joined(separator: ", ")). Complete this form on your computer.").font(.footnote).foregroundStyle(.red)
            }
            if let error = errors["form"] { Text(error).font(.footnote).foregroundStyle(.red) }
            HStack {
                Button("Cancel") { respond(false, "cancel") }.buttonStyle(DecisionActionStyle(accent: accent)).accessibilityIdentifier("formCancel")
                Button("Decline") { respond(false, nil) }.buttonStyle(DecisionActionStyle(accent: accent)).accessibilityIdentifier("formDecline")
                Button("Submit") {
                    let result = form.build(values); errors = result.errors
                    if let content = result.content { respond(true, decisionJSONText(content)) }
                }.buttonStyle(DecisionActionStyle(accent: accent, prominent: true)).disabled(!form.unsupported.isEmpty).accessibilityIdentifier("formSubmit")
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                }.accessibilityIdentifier("dismissDecisionKeyboard")
            }
        }
    }
    @ViewBuilder private func fieldInput(_ field: ElicitationField) -> some View {
        if field.kind == .boolean {
            Toggle(field.label, isOn: Binding(get: { values[field.name]?.bool ?? false }, set: { values[field.name] = .bool($0); errors[field.name] = nil }))
                .labelsHidden().tint(accent).accessibilityLabel(field.label).accessibilityIdentifier("form-" + field.name)
        } else if field.kind == .enumeration || field.kind == .multiEnum {
            VStack(spacing: 8) {
                ForEach(Array(field.choices.enumerated()), id: \.offset) { index, choice in
                    let selected = field.kind == .multiEnum ? values[field.name]?.array.contains(.string(choice)) == true : values[field.name]?.string == choice
                    DecisionOption(title: field.choiceLabels[index], selected: selected, accent: accent) {
                        errors[field.name] = nil
                        if field.kind == .multiEnum {
                            var choices = values[field.name]?.array ?? []
                            if selected { choices.removeAll { $0 == .string(choice) } } else { choices.append(.string(choice)) }
                            values[field.name] = .array(choices)
                        } else { values[field.name] = .string(selected ? "" : choice) }
                    }
                }
            }
        } else {
            DecisionTextInput(label: field.label, secret: field.secret, text: Binding(get: { values[field.name]?.string ?? "" }, set: { values[field.name] = .string($0); errors[field.name] = nil }))
                .keyboardType(field.secret ? .default : field.kind == .number ? .numbersAndPunctuation : field.schema["format"].string == "email" ? .emailAddress : field.schema["format"].string == "uri" ? .URL : .default)
                .accessibilityIdentifier("form-" + field.name)
        }
    }
}

private struct DecisionRecovery: View {
    let delivery: DecisionDelivery
    let enabled: Bool
    let check: () -> Void
    var body: some View {
        Button(action: check) {
            HStack { if delivery.phase == .sending { ProgressView().controlSize(.small) }; Text(delivery.phase == .sending ? "Checking delivery…" : "Check delivery") }
        }.buttonStyle(DecisionActionStyle(accent: .blue, prominent: true)).disabled(!enabled || delivery.phase == .sending).accessibilityIdentifier("decisionCheckDelivery")
    }
}

private struct DecisionOption: View {
    let title: String
    var detail: String? = nil
    let selected: Bool
    let accent: Color
    let choose: () -> Void
    var body: some View {
        Button(action: choose) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.subheadline.weight(.medium))
                    if let detail { Text(detail).font(.footnote).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity, alignment: .leading)
                if selected { Image(systemName: "checkmark").font(.footnote.weight(.semibold)) }
            }.padding(12).frame(minHeight: 44).foregroundStyle(selected ? accent : .primary)
                .background(selected ? accent.opacity(0.14) : Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
        }.buttonStyle(ChatPressStyle()).accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityIdentifier("decisionOption-" + title)
    }
}

private struct DecisionTextInput: View {
    let label: String
    var secret = false
    @Binding var text: String
    var body: some View {
        Group {
            if secret { SecureField(label, text: $text) }
            else { TextField(label, text: $text, axis: .vertical).lineLimit(1...4) }
        }.font(.subheadline).textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(12).frame(minHeight: 44).background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
            .accessibilityLabel(label)
    }
}

private struct DecisionActionStyle: ButtonStyle {
    let accent: Color
    var prominent = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(prominent ? .white : .primary)
            .background(prominent ? accent : Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
            .opacity(!enabled ? 0.45 : configuration.isPressed ? 0.6 : 1)
    }
}
