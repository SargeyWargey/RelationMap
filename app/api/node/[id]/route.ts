import path from "node:path";

import { NextResponse } from "next/server";

import { NODES_DIR } from "@/lib/config";
import { readJsonFile } from "@/lib/storage";
import type { NodeDetail } from "@/lib/types";

// Notion page ids are hex + dashes; anything else (slashes, dots, encodings)
// is rejected before it can reach the filesystem (Enhancement Plan D2).
const NODE_ID_PATTERN = /^[a-zA-Z0-9-]{1,64}$/;

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!NODE_ID_PATTERN.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid node id." }, { status: 400 });
  }

  // Defense in depth: the resolved path must stay inside NODES_DIR.
  const filePath = path.resolve(path.join(NODES_DIR, `${id}.json`));
  if (!filePath.startsWith(NODES_DIR + path.sep)) {
    return NextResponse.json({ ok: false, error: "Invalid node id." }, { status: 400 });
  }

  const detail = await readJsonFile<NodeDetail>(filePath);

  if (!detail) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
