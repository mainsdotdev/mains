import { parseElicitationSchema } from "@mains/contracts/mcp-elicitation";

/** A missing or damaged cached schema must never become an empty confirmation. */
export function parseApprovalForm(schemaJson: string | null) {
  try {
    if (schemaJson) return parseElicitationSchema(JSON.parse(schemaJson));
  } catch { /* An invalid schema stays visible and cannot be submitted. */ }
  return { fields: [], unsupported: ["Form schema"] };
}
