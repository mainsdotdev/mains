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
