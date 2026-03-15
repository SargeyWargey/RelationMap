import { NextResponse } from "next/server";

import { CONFIG_FILE, GRAPH_FILE } from "@/lib/config";
import { readJsonFile, writeJsonAtomic } from "@/lib/storage";
import type { AppConfig, GraphData, NotionWorkspace } from "@/lib/types";

export async function GET() {
  const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };

  let workspaces = config.workspaces ?? [];
  let activeWorkspaceId = config.activeWorkspaceId ?? null;

  // Migrate legacy single-workspace config into workspaces array on first load
  if (workspaces.length === 0 && (config.notionToken || (config.rootPages && config.rootPages.length > 0))) {
    const legacy: NotionWorkspace = {
      id: "default",
      name: "Primary Workspace",
      notionToken: config.notionToken ?? "",
      rootPages: config.rootPages ?? [],
    };
    workspaces = [legacy];
    activeWorkspaceId = "default";
  }

  const graph = await readJsonFile<GraphData>(GRAPH_FILE);
  const warnings = graph?.warnings ?? [];

  return NextResponse.json({
    workspaces,
    activeWorkspaceId,
    warnings,
    // Legacy fields for backward compat
    notionToken: config.notionToken ?? "",
    rootPages: config.rootPages ?? [],
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const existing = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };

  if (Array.isArray(body.workspaces)) {
    const workspaces: NotionWorkspace[] = body.workspaces.map((w: NotionWorkspace) => ({
      id: typeof w.id === "string" ? w.id : String(Date.now()),
      name: typeof w.name === "string" ? w.name.trim() : "Workspace",
      notionToken: typeof w.notionToken === "string" ? w.notionToken.trim() : "",
      rootPages: Array.isArray(w.rootPages)
        ? w.rootPages.filter((p: unknown) => typeof p === "string" && (p as string).trim()).map((p: string) => p.trim())
        : [],
    }));

    const activeWorkspaceId: string =
      typeof body.activeWorkspaceId === "string"
        ? body.activeWorkspaceId
        : (workspaces[0]?.id ?? "");

    // Mirror active workspace into legacy top-level fields so sync continues to work
    const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

    await writeJsonAtomic(CONFIG_FILE, {
      ...existing,
      workspaces,
      activeWorkspaceId,
      notionToken: active?.notionToken ?? existing.notionToken,
      rootPages: active?.rootPages ?? existing.rootPages,
    } satisfies AppConfig);
  } else {
    // Legacy single-workspace format (kept for compat)
    const notionToken: string = typeof body.notionToken === "string" ? body.notionToken.trim() : "";
    const rootPages: string[] = Array.isArray(body.rootPages)
      ? body.rootPages.filter((p: unknown) => typeof p === "string" && p.trim()).map((p: string) => p.trim())
      : [];
    await writeJsonAtomic(CONFIG_FILE, {
      ...existing,
      notionToken,
      rootPages,
    } satisfies AppConfig);
  }

  return NextResponse.json({ ok: true });
}
