import { NextResponse } from "next/server";

import { runSync } from "@/lib/notion/sync";

// In-module guard (Enhancement Plan D5): a sync triggers a full Notion crawl
// with thousands of file writes, so only one may run at a time and repeat
// requests are rejected until the cooldown elapses.
let syncInProgress = false;
let lastSyncCompletedAt = 0;
const SYNC_COOLDOWN_MS = 30_000;

export async function POST() {
  if (syncInProgress) {
    return NextResponse.json(
      { ok: false, error: "A sync is already running." },
      { status: 429 },
    );
  }

  const sinceLast = Date.now() - lastSyncCompletedAt;
  if (lastSyncCompletedAt > 0 && sinceLast < SYNC_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((SYNC_COOLDOWN_MS - sinceLast) / 1000);
    return NextResponse.json(
      { ok: false, error: `Sync just finished — try again in ${waitSeconds}s.` },
      { status: 429 },
    );
  }

  syncInProgress = true;
  try {
    const graph = await runSync();
    return NextResponse.json({
      ok: true,
      generatedAt: graph.generatedAt,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    });
  } catch (error) {
    console.error("sync POST failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown sync error",
      },
      { status: 500 },
    );
  } finally {
    syncInProgress = false;
    lastSyncCompletedAt = Date.now();
  }
}
