import type { EntityInput } from "../sync.dto";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

const DEFAULT_PROP_NAMES = {
  TITLE: "Name",
  URL: "URL",
  DATE: "Date",
  DESCRIPTION: "Description",
  IMAGE: "Image",
} as const;

const DEFAULT_LIMITS = {
  DATABASE: 5,
  BOOKMARKS: 10,
} as const;

const DEFAULT_TITLE = "Untitled";
const TAG_PROPERTY_NAMES = ["Tags", "Tag", "Category"] as const;

type NotionText = { plain_text?: string };

export type NotionDatabaseMap = {
  titleProp?: string;
  urlProp?: string;
  dateProp?: string;
  descriptionProp?: string;
  imageProp?: string;
  limit?: number;
  filter?: any;
  sorts?: any[];
  connectionId?: string;
  resourceId?: string;
};

export type NotionBookmarksOptions = {
  limit?: number;
  connectionId?: string;
  resourceId?: string;
};

function plain(rt?: NotionText[] | null): string {
  if (!rt || !Array.isArray(rt)) return "";
  return rt
    .map((t) => t?.plain_text ?? "")
    .join("")
    .trim();
}

function first<T>(arr?: T[] | null): T | undefined {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
}

function fileUrl(file: any | null | undefined): string | null {
  if (!file) return null;
  if (file.type === "external" && file.external?.url)
    return file.external.url as string;
  if (file.type === "file" && file.file?.url) return file.file.url as string;
  return null;
}

function coverUrl(page: any): string | null {
  return fileUrl(page?.cover) ?? null;
}

function extractUrlFromProperty(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === "url") return prop.url ?? null;
  if (prop.type === "rich_text") {
    const firstRt = first(prop.rich_text);
    const href = (firstRt as any)?.href as string | undefined;
    return (href && href.trim()) || plain(prop.rich_text) || null;
  }
  if (prop.type === "files") {
    const f = first(prop.files);
    return fileUrl(f) ?? null;
  }
  return null;
}

function extractDate(prop: any, page: any): string {
  if (prop?.type === "date")
    return prop.date?.start ?? page?.created_time ?? new Date().toISOString();
  return page?.created_time ?? new Date().toISOString();
}

function extractTags(props: any): string[] {
  const tagPropKey = TAG_PROPERTY_NAMES.find(
    (k) => props[k]?.type === "multi_select"
  );
  if (!tagPropKey) return [];
  return (
    (props[tagPropKey].multi_select as any[] | undefined)
      ?.map((t: any) => t?.name)
      .filter(Boolean) ?? []
  );
}

function notionHeaders(): Record<string, string> | null {
  if (!NOTION_TOKEN) return null;
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

function normalizePageSize(limit: number): number {
  return Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, limit));
}

function buildDatabaseUrl(databaseId: string): string {
  return `${NOTION_API_BASE}/databases/${databaseId}/query`;
}

function buildBlockChildrenUrl(blockId: string, pageSize: number): string {
  const normalized = normalizePageSize(pageSize);
  return `${NOTION_API_BASE}/blocks/${blockId}/children?page_size=${normalized}`;
}

function mapDatabasePageToEntityInput(
  page: any,
  databaseId: string,
  propMapping: {
    titleProp: string;
    urlProp: string;
    dateProp: string;
    descriptionProp: string;
    imageProp: string;
    limit: number;
    filter?: any;
    sorts?: any[];
    connectionId?: string;
    resourceId?: string;
  }
): EntityInput {
  const props = page?.properties ?? {};
  const title = plain(props?.[propMapping.titleProp]?.title) || DEFAULT_TITLE;
  const url =
    extractUrlFromProperty(props?.[propMapping.urlProp]) || page?.url || "#";
  const description =
    plain(props?.[propMapping.descriptionProp]?.rich_text) || null;
  const date = extractDate(props?.[propMapping.dateProp], page);
  const imageFromProp = extractUrlFromProperty(props?.[propMapping.imageProp]);
  const imageUrl = imageFromProp || coverUrl(page) || null;
  const tags = extractTags(props);

  return {
    kind: "notion_page",
    title,
    url,
    body: description,
    summary: description?.substring(0, 500) || null,
    occurredAt: date,
    externalId: page?.id || null,
    connectionId: propMapping.connectionId || null,
    resourceId: propMapping.resourceId || null,
    metadata: {
      notion: {
        page_id: page?.id ?? null,
        database_id: databaseId,
      },
      tags,
      imageUrl,
    },
  };
}

export async function fetchNotionDatabaseItems(
  databaseId: string,
  map: NotionDatabaseMap = {}
): Promise<EntityInput[]> {
  const headers = notionHeaders();
  if (!headers) {
    console.error("Notion API error: NOTION_TOKEN not configured");
    return [];
  }

  const propMapping = {
    titleProp: map.titleProp ?? DEFAULT_PROP_NAMES.TITLE,
    urlProp: map.urlProp ?? DEFAULT_PROP_NAMES.URL,
    dateProp: map.dateProp ?? DEFAULT_PROP_NAMES.DATE,
    descriptionProp: map.descriptionProp ?? DEFAULT_PROP_NAMES.DESCRIPTION,
    imageProp: map.imageProp ?? DEFAULT_PROP_NAMES.IMAGE,
    limit: map.limit ?? DEFAULT_LIMITS.DATABASE,
    filter: map.filter,
    sorts: map.sorts,
    connectionId: map.connectionId,
    resourceId: map.resourceId,
  };

  try {
    const res = await fetch(buildDatabaseUrl(databaseId), {
      method: "POST",
      headers,
      body: JSON.stringify({
        page_size: normalizePageSize(propMapping.limit),
        filter: propMapping.filter,
        sorts: propMapping.sorts,
      }),
    });

    if (!res.ok) {
      console.error("Notion database query error:", res.status);
      return [];
    }

    const data = (await res.json()) as any;
    const results: any[] = Array.isArray(data?.results) ? data.results : [];

    return results
      .slice(0, propMapping.limit)
      .map((page: any) =>
        mapDatabasePageToEntityInput(page, databaseId, propMapping)
      );
  } catch (error) {
    console.error("Error fetching Notion database items:", error);
    return [];
  }
}

export async function fetchNotionBookmarkBlocks(
  blockId: string,
  opts: NotionBookmarksOptions = {}
): Promise<EntityInput[]> {
  const headers = notionHeaders();
  if (!headers) {
    console.error("Notion API error: NOTION_TOKEN not configured");
    return [];
  }

  const limit = opts.limit ?? DEFAULT_LIMITS.BOOKMARKS;

  try {
    const res = await fetch(buildBlockChildrenUrl(blockId, limit), { headers });

    if (!res.ok) {
      console.error("Notion block children error:", res.status);
      return [];
    }

    const data = (await res.json()) as any;
    const results: any[] = Array.isArray(data?.results) ? data.results : [];

    const items: EntityInput[] = [];
    for (const block of results) {
      if (block?.type !== "bookmark") continue;
      const url: string | undefined = block?.bookmark?.url;
      if (!url) continue;

      items.push({
        kind: "notion_bookmark",
        title: url,
        url,
        body: null,
        summary: null,
        occurredAt: block?.created_time ?? new Date().toISOString(),
        externalId: block?.id || null,
        connectionId: opts.connectionId || null,
        resourceId: opts.resourceId || null,
        metadata: {
          notion: { block_id: block?.id ?? null, parent_id: blockId },
        },
      });

      if (items.length >= limit) break;
    }

    return items;
  } catch (error) {
    console.error("Error fetching Notion bookmark blocks:", error);
    return [];
  }
}
