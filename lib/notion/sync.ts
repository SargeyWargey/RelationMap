import fs from "node:fs/promises";

import { CONFIG_FILE, DEFAULT_COLORS, GRAPH_FILE, NODES_DIR, SCHEMAS_DIR } from "@/lib/config";
import { stablePosition } from "@/lib/graph/layout";
import { notionRequest } from "@/lib/notion/client";
import { writeJsonAtomic } from "@/lib/storage";
import { readJsonFile } from "@/lib/storage";
import type { AppConfig, DatabaseField, DatabaseSchema, FieldOption, GraphData, GraphEdge, GraphNode, NodeDetail, NodeFieldValues } from "@/lib/types";

type NotionPage = {
  id: string;
  url: string;
  created_time: string;
  created_by?: { id?: string; name?: string; type?: string; person?: { email?: string } };
  parent?: { database_id?: string };
  properties?: Record<string, any>;
};

type NotionDatabase = {
  id: string;
  title?: Array<{ plain_text?: string }>;
  properties?: Record<string, any>;
};

function extractPageId(notionUrlOrId: string): string {
  const raw = notionUrlOrId.trim();
  if (!raw) {
    throw new Error("NOTION_ROOT_PAGE is required.");
  }

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const url = new URL(raw);
    if (url.hash) {
      return url.hash.replace("#", "").replace(/-/g, "").slice(-32);
    }

    const slug = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return slug.split("-").at(-1)?.replace(/-/g, "").slice(-32) ?? slug;
  }

  return raw.replace(/-/g, "").slice(-32);
}

async function getBlockChildren(blockId: string, token: string): Promise<any[]> {
  const results: any[] = [];
  let startCursor: string | undefined;

  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (startCursor) qs.set("start_cursor", startCursor);
    const data = await notionRequest<any>("GET", `/blocks/${blockId}/children?${qs.toString()}`, token);
    results.push(...(data.results ?? []));
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);

  return results;
}

async function searchPageForDatabases(rootPageId: string, token: string, maxDepth = 4): Promise<Array<{ id: string; title: string }>> {
  const found: Array<{ id: string; title: string }> = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: rootPageId, depth: 0 }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;

    if (seen.has(item.id) || item.depth > maxDepth) continue;
    seen.add(item.id);

    let children: any[] = [];
    try {
      children = await getBlockChildren(item.id, token);
    } catch {
      continue;
    }

    for (const child of children) {
      if (child.type === "child_database") {
        found.push({
          id: child.id,
          title: child.child_database?.title ?? "Untitled DB",
        });
      }

      if (child.has_children) {
        queue.push({ id: child.id, depth: item.depth + 1 });
      }
    }
  }

  return found;
}

async function queryDatabase(databaseId: string, token: string): Promise<NotionPage[]> {
  const results: NotionPage[] = [];
  let startCursor: string | undefined;

  do {
    const payload: Record<string, unknown> = { page_size: 100 };
    if (startCursor) payload.start_cursor = startCursor;

    const data = await notionRequest<any>("POST", `/databases/${databaseId}/query`, token, payload);
    results.push(...(data.results ?? []));
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);

  return results;
}

function pageName(page: NotionPage): string {
  const props = page.properties ?? {};

  for (const prop of Object.values(props)) {
    if (prop?.type === "title") {
      const title = (prop.title ?? []).map((item: any) => item.plain_text ?? "").join("").trim();
      if (title) return title;
    }
  }

  return page.url?.split("/").at(-1) ?? page.id;
}

function creatorName(page: NotionPage): string {
  const user = page.created_by;
  if (!user) return "Unknown";
  return user.name ?? user.person?.email ?? user.id ?? "Unknown";
}

function extractSchema(dbId: string, dbName: string, properties: Record<string, any>): DatabaseSchema {
  const fields: DatabaseField[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    const type = prop?.type ?? "unknown";
    const field: DatabaseField = { id: prop?.id ?? name, name, type };
    if (type === "select" || type === "multi_select" || type === "status") {
      const rawOptions: any[] = prop?.[type]?.options ?? prop?.status?.options ?? [];
      field.options = rawOptions.map((o: any): FieldOption => ({
        id: o.id ?? o.name,
        name: o.name ?? "",
        color: o.color ?? "default",
      }));
    }
    fields.push(field);
  }
  return { databaseId: dbId, databaseName: dbName, fields };
}

function extractFieldValues(page: NotionPage): NodeFieldValues {
  const values: NodeFieldValues = {};
  const props = page.properties ?? {};

  for (const [name, prop] of Object.entries(props)) {
    const type = prop?.type;
    if (!type || type === "title" || type === "relation" || type === "formula" || type === "rollup") continue;

    switch (type) {
      case "rich_text":
        values[name] = (prop.rich_text ?? []).map((r: any) => r.plain_text ?? "").join("").trim() || null;
        break;
      case "select":
        values[name] = prop.select?.name ?? null;
        break;
      case "multi_select":
        values[name] = (prop.multi_select ?? []).map((o: any) => o.name ?? "").filter(Boolean);
        if ((values[name] as string[]).length === 0) values[name] = null;
        break;
      case "status":
        values[name] = prop.status?.name ?? null;
        break;
      case "number":
        values[name] = prop.number != null ? String(prop.number) : null;
        break;
      case "checkbox":
        values[name] = prop.checkbox ? "Yes" : "No";
        break;
      case "date":
        values[name] = prop.date?.start ?? null;
        break;
      case "people":
        values[name] = (prop.people ?? []).map((p: any) => p.name ?? p.person?.email ?? p.id ?? "").filter(Boolean);
        if ((values[name] as string[]).length === 0) values[name] = null;
        break;
      case "url":
        values[name] = prop.url ?? null;
        break;
      case "email":
        values[name] = prop.email ?? null;
        break;
      case "phone_number":
        values[name] = prop.phone_number ?? null;
        break;
      default:
        // skip unsupported types
        break;
    }
  }

  return values;
}

function pageDescription(page: NotionPage): string | undefined {
  const props = page.properties ?? {};
  for (const [key, prop] of Object.entries(props)) {
    if (key.toLowerCase() === "description" && prop?.type === "rich_text") {
      const text = (prop.rich_text ?? []).map((item: any) => item.plain_text ?? "").join("").trim();
      if (text) return text;
    }
  }
  return undefined;
}

function buildEdges(page: NotionPage): Array<{ targetId: string; relationName: string }> {
  const edges: Array<{ targetId: string; relationName: string }> = [];
  const props = page.properties ?? {};

  for (const [propName, propValue] of Object.entries(props)) {
    if (propValue?.type !== "relation") continue;
    const rels = Array.isArray(propValue.relation) ? propValue.relation : [];
    for (const rel of rels) {
      if (rel?.id) {
        edges.push({ targetId: rel.id, relationName: propName });
      }
    }
  }

  return edges;
}

export async function runSync(): Promise<GraphData> {
  const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };

  // Prefer token/rootPages from saved config, fall back to env vars
  const token = (config.notionToken && config.notionToken.trim()) || (process.env.NOTION_TOKEN ?? "");
  const rootPageEntries: string[] =
    config.rootPages && config.rootPages.length > 0
      ? config.rootPages
      : process.env.NOTION_ROOT_PAGE
        ? [process.env.NOTION_ROOT_PAGE]
        : [];

  if (!token || rootPageEntries.length === 0) {
    const warningGraph: GraphData = {
      generatedAt: new Date().toISOString(),
      nodes: [],
      edges: [],
      warnings: ["Missing Notion token or root pages. Configure them in Settings."],
    };
    await writeGraphArtifacts(warningGraph);
    return warningGraph;
  }

  // Collect databases from all root pages
  const allDatabases: Array<{ id: string; title: string }> = [];
  const seenDbIds = new Set<string>();
  for (const rootEntry of rootPageEntries) {
    let rootPageId: string;
    try {
      rootPageId = extractPageId(rootEntry);
    } catch {
      continue;
    }
    const dbs = await searchPageForDatabases(rootPageId, token);
    for (const db of dbs) {
      if (!seenDbIds.has(db.id)) {
        seenDbIds.add(db.id);
        allDatabases.push(db);
      }
    }
  }
  const databases = allDatabases;
  const warnings: string[] = [];
  if (databases.length === 0) {
    warnings.push("No child databases were found under the configured root page.");
  }

  const nodes: GraphNode[] = [];
  const nodeDetails: NodeDetail[] = [];
  const edges: GraphEdge[] = [];
  const schemas: DatabaseSchema[] = [];
  let inaccessibleDatabaseCount = 0;

  for (const [index, db] of databases.entries()) {
    let dbInfo: NotionDatabase;
    try {
      dbInfo = await notionRequest<NotionDatabase>("GET", `/databases/${db.id}`, token);
    } catch (error) {
      inaccessibleDatabaseCount += 1;
      warnings.push(
        `Skipped database ${db.id}: ${
          error instanceof Error ? error.message : "inaccessible to this Notion integration"
        }`,
      );
      continue;
    }

    const dbName = (dbInfo.title ?? []).map((t) => t.plain_text ?? "").join("") || db.title;

    // Extract and save database schema
    const schema = extractSchema(db.id, dbName, dbInfo.properties ?? {});
    schemas.push(schema);

    const configuredColor = config.databaseColors[dbName];
    const color = configuredColor ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];

    let pages: NotionPage[];
    try {
      pages = await queryDatabase(db.id, token);
    } catch (error) {
      warnings.push(
        `Skipped query for database ${dbName} (${db.id}): ${
          error instanceof Error ? error.message : "query failed"
        }`,
      );
      continue;
    }

    for (const page of pages) {
      const position = stablePosition(page.id);
      const description = pageDescription(page);
      const fieldValues = extractFieldValues(page);
      const node: GraphNode = {
        id: page.id,
        name: pageName(page),
        databaseId: db.id,
        databaseName: dbName,
        color,
        notionUrl: page.url ?? "",
        createdBy: creatorName(page),
        createdTime: page.created_time ?? new Date(0).toISOString(),
        x: position.x,
        y: position.y,
        fieldValues,
      };

      nodes.push(node);
      nodeDetails.push({
        id: node.id,
        name: node.name,
        createdBy: node.createdBy,
        createdTime: node.createdTime,
        databaseName: node.databaseName,
        databaseId: db.id,
        notionUrl: node.notionUrl,
        ...(description ? { description } : {}),
        fieldValues,
      });

      for (const rel of buildEdges(page)) {
        const edgeId = `${page.id}-${rel.targetId}-${rel.relationName}`;
        edges.push({
          id: edgeId,
          source: page.id,
          target: rel.targetId,
          relationName: rel.relationName,
        });
      }
    }
  }

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const dedupedEdges = edges.filter((edge, idx) => {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) return false;
    return edges.findIndex((candidate) => candidate.id === edge.id) === idx;
  });

  if (inaccessibleDatabaseCount > 0 && nodes.length === 0) {
    warnings.push(
      "No accessible database content was synced. In Notion, open each database and connect/share it with your integration.",
    );
  }

  const graph: GraphData = {
    generatedAt: new Date().toISOString(),
    nodes,
    edges: dedupedEdges,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  await writeGraphArtifacts(graph, nodeDetails, schemas);
  await writeJsonAtomic(CONFIG_FILE, {
    ...config,
    lastSyncAt: graph.generatedAt,
  } satisfies AppConfig);

  return graph;
}

async function writeGraphArtifacts(graph: GraphData, details?: NodeDetail[], schemas?: DatabaseSchema[]): Promise<void> {
  await writeJsonAtomic(GRAPH_FILE, graph);

  await fs.mkdir(NODES_DIR, { recursive: true });
  const nodeDetails = details ?? graph.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    createdBy: node.createdBy,
    createdTime: node.createdTime,
    databaseName: node.databaseName,
    databaseId: node.databaseId,
    notionUrl: node.notionUrl,
  } as NodeDetail));

  await Promise.all(
    nodeDetails.map((detail) =>
      writeJsonAtomic(`${NODES_DIR}/${detail.id}.json`, detail),
    ),
  );

  if (schemas && schemas.length > 0) {
    await fs.mkdir(SCHEMAS_DIR, { recursive: true });
    await Promise.all(
      schemas.map((schema) =>
        writeJsonAtomic(`${SCHEMAS_DIR}/${schema.databaseId}.json`, schema),
      ),
    );
  }
}
