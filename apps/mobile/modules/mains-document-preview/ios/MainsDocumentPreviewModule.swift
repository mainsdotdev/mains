import ExpoModulesCore
import QuickLook
import UIKit

public final class MainsDocumentPreviewModule: Module {
  private var preview: DocumentPreviewController?

  public func definition() -> ModuleDefinition {
    Name("MainsDocumentPreview")

    AsyncFunction("openAsync") { (uri: String, title: String, promise: Promise) in
      guard self.preview == nil else {
        promise.reject("ERR_PREVIEW_BUSY", "A document preview is already open.")
        return
      }
      guard let url = URL(string: uri), url.isFileURL,
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
        url.resolvingSymlinksInPath().path.hasPrefix(cache.appendingPathComponent("mains-outputs", isDirectory: true).path + "/"),
        QLPreviewController.canPreview(url as NSURL) else {
        promise.reject("ERR_PREVIEW_UNSUPPORTED", "This file cannot be previewed. Use Share to open it in another app.")
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController(), presenter.view.window != nil else {
        promise.reject("ERR_PREVIEW_UNAVAILABLE", "Document preview is unavailable. Try again.")
        return
      }
      let controller = DocumentPreviewController(url: url, title: title) {
        self.preview = nil
        promise.resolve(nil)
      }
      self.preview = controller
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)
  }
}

final class DocumentPreviewController: QLPreviewController, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  private let item: DocumentPreviewItem
  private var didClose: (() -> Void)?

  init(url: URL, title: String, onClose: @escaping () -> Void) {
    item = DocumentPreviewItem(url: url, title: title)
    didClose = onClose
    super.init(nibName: nil, bundle: nil)
    dataSource = self
    delegate = self
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { item }
  func previewController(_ controller: QLPreviewController, editingModeFor previewItem: QLPreviewItem) -> QLPreviewItemEditingMode { .disabled }
  func previewControllerDidDismiss(_ controller: QLPreviewController) { finish() }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isBeingDismissed || presentingViewController == nil { finish() }
  }

  private func finish() {
    let callback = didClose
    didClose = nil
    callback?()
  }
}

private final class DocumentPreviewItem: NSObject, QLPreviewItem {
  let previewItemURL: URL?
  let previewItemTitle: String?
  init(url: URL, title: String) { previewItemURL = url; previewItemTitle = title }
}
