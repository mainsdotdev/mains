import { randomUUID } from "crypto";
import {
  buildMcpAppContentSecurityPolicy,
  buildMcpAppPermissionsPolicy,
  renderMcpAppDocument,
  type McpAppResourceMeta,
} from "./mcpApps.document";

const RESOURCE_TTL_MS = 30 * 60 * 1_000;
const MAX_REGISTERED_DOCUMENTS = 64;

interface RegisteredMcpAppDocument {
  html: string;
  csp: string;
  permissionsPolicy: string;
  expiresAt: number;
}

const documents = new Map<string, RegisteredMcpAppDocument>();

function pruneExpired(now = Date.now()): void {
  for (const [token, document] of documents) {
    if (document.expiresAt <= now) documents.delete(token);
  }
}

export const mcpAppsRegistry = {
  register(html: string, meta: McpAppResourceMeta): string {
    pruneExpired();
    while (documents.size >= MAX_REGISTERED_DOCUMENTS) {
      const oldest = documents.keys().next().value as string | undefined;
      if (!oldest) break;
      documents.delete(oldest);
    }
    const token = randomUUID();
    documents.set(token, {
      html: renderMcpAppDocument(html),
      csp: buildMcpAppContentSecurityPolicy(meta.csp),
      permissionsPolicy: buildMcpAppPermissionsPolicy(meta.permissions),
      expiresAt: Date.now() + RESOURCE_TTL_MS,
    });
    return `mains-mcp-app://resource/${token}/index.html`;
  },

  get(token: string): RegisteredMcpAppDocument | null {
    const document = documents.get(token);
    if (!document) return null;
    if (document.expiresAt <= Date.now()) {
      documents.delete(token);
      return null;
    }
    return document;
  },

  clear(): void {
    documents.clear();
  },
};
