import AppKit
let directory = URL(fileURLWithPath: "/tmp/mains-attachment-fixtures", isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for index in 0..<6 {
    let width = index.isMultiple(of: 2) ? 640 : 240
    let height = index.isMultiple(of: 2) ? 240 : 640
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
                                  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSColor(calibratedHue: CGFloat(index) / 6, saturation: 0.7, brightness: 0.9, alpha: 1).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    NSColor.white.setFill()
    NSBezierPath(ovalIn: NSRect(x: 30, y: 30, width: 120, height: 120)).fill()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent("fixture-\(index).png"))
}
