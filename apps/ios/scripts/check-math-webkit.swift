// Nonvisual macOS WebKit smoke check. No window, screenshot or simulator.
// swift scripts/check-math-webkit.swift Resources/Math
import AppKit
import WebKit
import Foundation
import Darwin

@MainActor final class MathCheck: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let view: WKWebView
    let shell: URL
    var sawLink = false, sawHeight = false
    init(root: URL) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        view = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 800), configuration: configuration)
        shell = root.appendingPathComponent("shell.html")
        super.init()
        configuration.userContentController.add(self, name: "math")
        view.navigationDelegate = self
    }
    func start() { view.loadFileURL(shell, allowingReadAccessTo: shell.deletingLastPathComponent()) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["id"] as? String == "check" else { return }
        if body["href"] as? String == "report.pdf" { sawLink = true }
        if let value = body["height"] as? Double, value > 0 { sawHeight = true }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        print("Navigation: \(action.request.url?.absoluteString ?? "nil"), main: \(String(describing: action.targetFrame?.isMainFrame)), type: \(action.navigationType.rawValue)")
        return action.navigationType == .other && action.request.url == shell && action.targetFrame?.isMainFrame == true ? .allow : .cancel
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("Loaded math shell")
        Task {
            do {
                let html = #"<p>Inline <span data-math="inline">\frac{a_1}{\sqrt{b^2+1}}</span> <a href="report.pdf">PDF</a></p><span data-math="display">\begin{pmatrix}a&amp;b\\c&amp;d\end{pmatrix}</span><span data-math="display">\int_0^1 x^2\,dx</span><span data-math="inline">\href{javascript:alert(1)}{unsafe}</span><span data-math="inline">\includegraphics{https://example.invalid/image.png}</span>"#
                _ = try await view.callAsyncJavaScript("return await window.renderMessage(html, 'check', 20, true)", arguments: ["html": html], in: nil, contentWorld: .page)
                let report = try await view.callAsyncJavaScript(#"""
                    await new Promise(resolve => setTimeout(resolve, 150));
                    await Promise.all([...document.fonts].map(face => face.load()));
                    document.querySelector('a').click();
                    const blocked = await fetch('https://example.invalid/blocked').then(() => false, () => true);
                    return { formulas: document.querySelectorAll('.katex').length,
                      fractions: document.querySelectorAll('mfrac').length, matrices: document.querySelectorAll('mtable').length,
                      images: document.querySelectorAll('img').length, unsafeLinks: document.querySelectorAll('a[href^="javascript:"]').length,
                      fonts: document.fonts.status, fontFaces: document.fonts.size,
                      allFontsLoaded: [...document.fonts].every(face => face.status === 'loaded'), blocked, dark: document.body.className,
                      mathFont: getComputedStyle(document.querySelector('.katex')).fontFamily };
                    """#, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
                guard let report, report["formulas"] as? Int == 5,
                      (report["fractions"] as? Int ?? 0) > 0, (report["matrices"] as? Int ?? 0) > 0,
                      report["images"] as? Int == 0, report["unsafeLinks"] as? Int == 0,
                      report["blocked"] as? Bool == true, report["fonts"] as? String == "loaded", report["dark"] as? String == "dark",
                      report["fontFaces"] as? Int == 20, report["allFontsLoaded"] as? Bool == true,
                      (report["mathFont"] as? String)?.contains("KaTeX") == true else { throw NSError(domain: "MathCheck", code: 1, userInfo: [NSLocalizedDescriptionKey: String(describing: report)]) }
                try await Task.sleep(for: .milliseconds(100))
                guard sawLink, sawHeight else { throw NSError(domain: "MathCheck", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing height/link bridge"]) }
                print("PASS: offline KaTeX, fractions/matrices, fonts, height/link bridge, CSP and untrusted commands")
                exit(0)
            } catch { print("FAIL: \(error)"); exit(1) }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) { print("FAIL: \(error)"); exit(1) }
}

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Resources/Math", isDirectory: true).standardizedFileURL
let check = MainActor.assumeIsolated {
    NSApplication.shared.setActivationPolicy(.prohibited)
    let check = MathCheck(root: root)
    check.start()
    return check
}
_ = Task { try? await Task.sleep(for: .seconds(30)); print("FAIL: WebKit deadline"); exit(1) }
NSApplication.shared.run()
