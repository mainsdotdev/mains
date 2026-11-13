import Foundation

/// Bundled bytes and explicitly imported demo attachments, never host file paths.
struct DemoFile: Sendable {
    let name: String
    let mime: String
    let preview: String
    let bytes: Data
    let version: String

    func descriptor(runID: String, artifactID: Int? = nil, attachmentID: String? = nil) -> JSONValue {
        var row: [String: JSONValue] = [
            "runId": .string(runID), "name": .string(name), "mimeType": .string(mime),
            "previewType": .string(preview), "byteSize": .number(Double(bytes.count)),
            "modifiedAt": .number(1), "version": .string(version),
        ]
        if let artifactID { row["artifactId"] = .number(Double(artifactID)) }
        if let attachmentID { row["attachmentId"] = .string(attachmentID) }
        return .object(row)
    }

    func chunk(_ request: JSONValue) throws -> JSONValue {
        guard request["version"].string == version, let offset = request["offset"].number,
              offset.isFinite, offset.rounded() == offset, offset >= 0, offset <= Double(bytes.count) else {
            throw MainsError.server("The demo file reference is invalid.")
        }
        let start = Int(offset), end = min(bytes.count, start + 128 * 1024)
        return .object([
            "base64": .string(bytes.subdata(in: start..<end).base64EncodedString()),
            "offset": .number(offset), "nextOffset": end < bytes.count ? .number(Double(end)) : .null,
            "version": .string(version), "byteSize": .number(Double(bytes.count)),
        ])
    }

    static let pdf = DemoFile(name: "demo-report.pdf", mime: "application/pdf", preview: "pdf",
                             bytes: makePDF(), version: String(repeating: "1", count: 64))
    static let notes = DemoFile(name: "demo-notes.md", mime: "text/markdown", preview: "markdown",
                               bytes: Data("# Mains demo notes\n\nThese sample files stay on this iPhone.\n\n- Explore workspaces and conversations\n- Send a simulated message\n- Preview images and PDFs\n\nNo AI service or computer was contacted.\n".utf8),
                               version: String(repeating: "2", count: 64))

    // Prepared 128-pixel version of the checked-in demo image, never real media.
    static let atlasThumbnail: JSONValue = .object([
        "mime": .string("image/jpeg"), "width": .number(128), "height": .number(85),
        "base64": .string("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"),
    ])

    private static func makePDF() -> Data {
        let text = "BT /F1 20 Tf 50 740 Td (Mains Demo Report) Tj 0 -36 Td /F1 12 Tf (Bundled sample data. No external service was contacted.) Tj ET"
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            "<< /Length \(text.utf8.count) >>\nstream\n\(text)\nendstream",
        ]
        var pdf = "%PDF-1.4\n", offsets = [0]
        for (index, object) in objects.enumerated() {
            offsets.append(pdf.utf8.count); pdf += "\(index + 1) 0 obj\n\(object)\nendobj\n"
        }
        let xref = pdf.utf8.count
        pdf += "xref\n0 \(objects.count + 1)\n0000000000 65535 f \n"
        for offset in offsets.dropFirst() { pdf += String(format: "%010d 00000 n \n", offset) }
        pdf += "trailer\n<< /Size \(objects.count + 1) /Root 1 0 R >>\nstartxref\n\(xref)\n%%EOF\n"
        return Data(pdf.utf8)
    }
}
