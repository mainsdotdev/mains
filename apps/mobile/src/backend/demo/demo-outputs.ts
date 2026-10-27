import { OUTPUT_CHUNK_BYTES, outputFileType, type RunAttachmentFile, type ReadRunAttachmentPayload, type RunOutput, type RunOutputChunk, type ReadRunOutputPayload } from "@mains/contracts/run-outputs";
import type { StoredAttachment } from "@mains/contracts/runs";

/** Small bundled documents exercise preview, chunk downloads and offline copies without a backend. */
function samplePdf(): string {
  const text = "BT /F1 20 Tf 50 740 Td (Mains Demo Report) Tj 0 -36 Td /F1 12 Tf (This PDF is bundled sample data. No external service was contacted.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
const files = [
  { id: -9001, name: "demo-report.pdf", content: samplePdf() },
  { id: -9002, name: "demo-notes.md", content: "# Mains demo notes\n\nThese sample files stay on this phone.\n\n- Preview documents\n- Share or save an original\n- Reopen downloaded files offline\n" },
];

export function demoOutputs(runId: string): RunOutput[] {
  return files.map((file, index) => ({ runId, artifactId: file.id, name: file.name, byteSize: file.content.length, modifiedAt: 1, version: String(index + 1).repeat(64), ...outputFileType(file.name) }));
}

export const DEMO_ATTACHMENT_ID = "d".repeat(64);
export function demoPromptAttachment(): StoredAttachment {
  return { attachmentId: DEMO_ATTACHMENT_ID, name: files[0].name, type: "document", mimeType: "application/pdf", byteSize: files[0].content.length };
}
export function demoAttachmentFile(runId: string, attachmentId: string): RunAttachmentFile {
  if (attachmentId !== DEMO_ATTACHMENT_ID) throw new Error("Attachment not found in this conversation");
  const { artifactId: _artifactId, ...file } = demoOutputs(runId)[0];
  return { ...file, attachmentId };
}
export function readDemoAttachment(request: ReadRunAttachmentPayload): RunOutputChunk {
  demoAttachmentFile(request.runId, request.attachmentId);
  return readDemoOutput({ runId: request.runId, artifactId: files[0].id, version: request.version, offset: request.offset });
}

export function readDemoOutput(request: ReadRunOutputPayload): RunOutputChunk {
  const file = files.find((item) => item.id === request.artifactId);
  const output = demoOutputs(request.runId).find((item) => item.artifactId === request.artifactId);
  if (!file || !output || request.version !== output.version || !Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > output.byteSize) throw new Error("Invalid demo output");
  const text = file.content.slice(request.offset, request.offset + OUTPUT_CHUNK_BYTES);
  const next = request.offset + text.length;
  return { base64: btoa(text), offset: request.offset, nextOffset: next < file.content.length ? next : null, version: output.version, byteSize: output.byteSize };
}
