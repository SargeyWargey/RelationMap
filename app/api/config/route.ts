import { NextResponse } from "next/server";

import { CONFIG_FILE } from "@/lib/config";
import { readJsonFile } from "@/lib/storage";
import type { AppConfig } from "@/lib/types";

export async function GET() {
  const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };

  // Strip secrets — Notion tokens must never reach the browser.
  const safe: Record<string, unknown> = { ...config };
  delete safe.notionToken;
  if (config.workspaces) {
    safe.workspaces = config.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      rootPages: w.rootPages,
    }));
  }

  return NextResponse.json(safe, { headers: { "Cache-Control": "no-store" } });
}
