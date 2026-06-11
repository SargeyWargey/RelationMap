import fs from "node:fs/promises";
import { NextResponse } from "next/server";

import { SCHEMAS_DIR } from "@/lib/config";
import { readJsonFile } from "@/lib/storage";
import type { DatabaseSchema } from "@/lib/types";

// Bound the directory scan (Enhancement Plan D8): cap the file count and read
// in batches instead of one unbounded Promise.all over the whole directory.
const MAX_SCHEMA_FILES = 500;
const READ_BATCH_SIZE = 50;

export async function GET() {
  try {
    let files: string[];
    try {
      files = await fs.readdir(SCHEMAS_DIR);
    } catch {
      return NextResponse.json([]);
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json")).slice(0, MAX_SCHEMA_FILES);

    const schemas: Array<DatabaseSchema | null> = [];
    for (let i = 0; i < jsonFiles.length; i += READ_BATCH_SIZE) {
      const batch = await Promise.all(
        jsonFiles
          .slice(i, i + READ_BATCH_SIZE)
          .map((f) => readJsonFile<DatabaseSchema>(`${SCHEMAS_DIR}/${f}`)),
      );
      schemas.push(...batch);
    }

    return NextResponse.json(schemas.filter(Boolean));
  } catch (err) {
    console.error("schemas GET failed:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to read schemas." },
      { status: 500 },
    );
  }
}
