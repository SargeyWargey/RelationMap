import fs from "node:fs/promises";
import { NextResponse } from "next/server";

import { SCHEMAS_DIR } from "@/lib/config";
import { readJsonFile } from "@/lib/storage";
import type { DatabaseSchema } from "@/lib/types";

export async function GET() {
  try {
    let files: string[];
    try {
      files = await fs.readdir(SCHEMAS_DIR);
    } catch {
      return NextResponse.json([]);
    }

    const schemas = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map((f) => readJsonFile<DatabaseSchema>(`${SCHEMAS_DIR}/${f}`)),
    );

    return NextResponse.json(schemas.filter(Boolean));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
