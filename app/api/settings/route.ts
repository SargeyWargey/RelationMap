import { NextResponse } from "next/server";

import { CONFIG_FILE, GRAPH_FILE } from "@/lib/config";
import { readJsonFile, writeJsonAtomic } from "@/lib/storage";
import type { AppConfig, GraphData, NotionWorkspace } from "@/lib/types";

import { errorResponse, isPlainObject, readJsonBody } from "../_lib/validate";

const WORKSPACE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_WORKSPACES = 50;
const MAX_NAME_LENGTH = 100;
const MAX_TOKEN_LENGTH = 200;
const MAX_ROOT_PAGES = 50;
const MAX_ROOT_PAGE_LENGTH = 500;

/**
 * Masked hint shown in the config UI. Deliberately avoids emitting the
 * literal `ntn_` prefix (the underscore is dropped) so a response scan for
 * token substrings stays clean: "ntn…bp".
 */
function maskToken(token: string): string {
  const t = token.trim();
  if (!t) return "";
  if (t.length <= 8) return "saved";
  return `${t.slice(0, 3)}…${t.slice(-2)}`;
}

/** Workspace shape sent to the browser — never includes the token itself. */
function sanitizeWorkspace(ws: NotionWorkspace) {
  const token = typeof ws.notionToken === "string" ? ws.notionToken.trim() : "";
  return {
    id: ws.id,
    name: ws.name,
    rootPages: ws.rootPages ?? [],
    hasToken: token.length > 0,
    tokenHint: maskToken(token),
  };
}

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

  return NextResponse.json(
    {
      workspaces: workspaces.map(sanitizeWorkspace),
      activeWorkspaceId,
      warnings,
      // Legacy field kept for backward compat (non-secret). The token itself
      // never leaves the server — clients get hasToken/tokenHint instead.
      rootPages: config.rootPages ?? [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const parsed = await readJsonBody(request);
    if (parsed.error) return parsed.error;
    const body = parsed.body;
    if (!isPlainObject(body)) {
      return errorResponse("Expected a JSON object body.", 400);
    }

    const existing = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };

    if (Array.isArray(body.workspaces)) {
      if (body.workspaces.length > MAX_WORKSPACES) {
        return errorResponse(`Too many workspaces (max ${MAX_WORKSPACES}).`, 400);
      }

      // Stored tokens by workspace id — saving the modal without retyping a
      // token must preserve the previously stored token (Enhancement Plan D1).
      const storedTokens = new Map<string, string>();
      for (const w of existing.workspaces ?? []) {
        if (w?.id && typeof w.notionToken === "string" && w.notionToken.trim()) {
          storedTokens.set(w.id, w.notionToken.trim());
        }
      }
      // Legacy single-workspace configs surface as id "default" in the UI.
      if (storedTokens.size === 0 && existing.notionToken && existing.notionToken.trim()) {
        storedTokens.set("default", existing.notionToken.trim());
      }

      const workspaces: NotionWorkspace[] = [];
      for (const raw of body.workspaces as unknown[]) {
        if (!isPlainObject(raw)) {
          return errorResponse("Each workspace must be an object.", 400);
        }
        if (typeof raw.id !== "string" || !WORKSPACE_ID_PATTERN.test(raw.id)) {
          return errorResponse("Invalid workspace id.", 400);
        }
        const id = raw.id;

        const name = typeof raw.name === "string" ? raw.name.trim() : "Workspace";
        if (name.length > MAX_NAME_LENGTH) {
          return errorResponse(`Workspace name is too long (max ${MAX_NAME_LENGTH} characters).`, 400);
        }

        const typedToken = typeof raw.notionToken === "string" ? raw.notionToken.trim() : "";
        if (typedToken.length > MAX_TOKEN_LENGTH) {
          return errorResponse("Notion token is too long.", 400);
        }

        const rootPagesRaw = Array.isArray(raw.rootPages) ? raw.rootPages : [];
        if (rootPagesRaw.length > MAX_ROOT_PAGES) {
          return errorResponse(`Too many root pages (max ${MAX_ROOT_PAGES}).`, 400);
        }
        const rootPages: string[] = [];
        for (const page of rootPagesRaw as unknown[]) {
          if (typeof page !== "string") continue;
          const trimmed = page.trim();
          if (!trimmed) continue;
          if (trimmed.length > MAX_ROOT_PAGE_LENGTH) {
            return errorResponse("Root page entry is too long.", 400);
          }
          rootPages.push(trimmed);
        }

        // Empty/missing token for an existing workspace = keep stored token.
        const notionToken = typedToken || storedTokens.get(id) || "";

        workspaces.push({ id, name: name || "Workspace", notionToken, rootPages });
      }

      const activeWorkspaceId: string =
        typeof body.activeWorkspaceId === "string" && WORKSPACE_ID_PATTERN.test(body.activeWorkspaceId)
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
      const typedToken = typeof body.notionToken === "string" ? body.notionToken.trim() : "";
      if (typedToken.length > MAX_TOKEN_LENGTH) {
        return errorResponse("Notion token is too long.", 400);
      }
      const rootPagesRaw = Array.isArray(body.rootPages) ? body.rootPages : [];
      if (rootPagesRaw.length > MAX_ROOT_PAGES) {
        return errorResponse(`Too many root pages (max ${MAX_ROOT_PAGES}).`, 400);
      }
      const rootPages: string[] = [];
      for (const page of rootPagesRaw as unknown[]) {
        if (typeof page !== "string") continue;
        const trimmed = page.trim();
        if (!trimmed) continue;
        if (trimmed.length > MAX_ROOT_PAGE_LENGTH) {
          return errorResponse("Root page entry is too long.", 400);
        }
        rootPages.push(trimmed);
      }

      // No token in the request = keep the stored one.
      const notionToken = typedToken || (existing.notionToken ?? "").trim();

      await writeJsonAtomic(CONFIG_FILE, {
        ...existing,
        notionToken,
        rootPages,
      } satisfies AppConfig);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("settings POST failed:", err);
    return errorResponse("Failed to save settings.", 500);
  }
}
