import SwiftUI
import WebKit

struct MathMarkdownView: View {
    let document: MathMarkdown
    let source: String
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    @ScaledMetric private var fontSize = 17.0
    @State private var height = 40.0
    @State private var failed = false
    var body: some View {
        if failed { Text(source).textSelection(.enabled) }
        else {
            MathWebView(html: document.html, fontSize: fontSize, dark: colorScheme == .dark, height: $height, failed: $failed, open: { openURL($0) })
                .frame(height: height).accessibilityIdentifier("mathMarkdown")
        }
    }
}

private struct MathWebView: UIViewRepresentable {
    let html: String
    let fontSize: Double
    let dark: Bool
    @Binding var height: Double
    @Binding var failed: Bool
    let open: (URL) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "math")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false; view.backgroundColor = .clear; view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.navigationDelegate = context.coordinator
        context.coordinator.webView = view
        if let shell = Bundle.main.url(forResource: "shell", withExtension: "html", subdirectory: "Math") {
            context.coordinator.shell = shell
            view.loadFileURL(shell, allowingReadAccessTo: shell.deletingLastPathComponent())
        } else { DispatchQueue.main.async { context.coordinator.parent.failed = true } }
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.parent = self; context.coordinator.render() }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.retired = true; view.stopLoading(); view.navigationDelegate = nil
        view.configuration.userContentController.removeScriptMessageHandler(forName: "math")
    }
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: MathWebView
        weak var webView: WKWebView?
        var shell: URL?
        var retired = false, ready = false
        var id = UUID().uuidString
        private var rendered: String?
        init(_ parent: MathWebView) { self.parent = parent }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { ready = true; render() }
        func render() {
            guard ready, !retired, let webView else { return }
            let fingerprint = parent.html + "\(parent.fontSize):\(parent.dark)"
            guard rendered != fingerprint else { return }
            rendered = fingerprint; id = UUID().uuidString
            let ticket = id
            webView.callAsyncJavaScript("return await window.renderMessage(html, id, fontSize, dark)",
                arguments: ["html": parent.html, "id": id, "fontSize": parent.fontSize, "dark": parent.dark], in: nil, in: .page) { [weak self] result in
                    if case .failure = result, let self, !self.retired, self.id == ticket { self.parent.failed = true }
                }
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard !retired, message.webView === webView, message.frameInfo.isMainFrame,
                  let body = message.body as? [String: Any], body["id"] as? String == id else { return }
            if let height = body["height"] as? Double, height.isFinite, height >= 0, height <= 32768 {
                let next = max(24, height)
                if abs(parent.height - next) > 0.5 { parent.height = next }
            } else if body["height"] != nil { parent.failed = true }
            if let href = body["href"] as? String, href.utf8.count <= 4096, let url = URL(string: href),
               ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") || RunFileReference(href) != nil { parent.open(url) }
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) { if !retired { parent.failed = true } }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) { if !retired { parent.failed = true } }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if !retired { parent.failed = true } }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            navigationAction.navigationType == .other && navigationAction.request.url == shell && navigationAction.targetFrame?.isMainFrame == true ? .allow : .cancel
        }
    }
}
