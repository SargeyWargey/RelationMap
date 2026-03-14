import { NextRequest, NextResponse } from "next/server";

import { CONFIG_FILE } from "@/lib/config";
import { readJsonFile, writeJsonAtomic } from "@/lib/storage";
import type { AppConfig } from "@/lib/types";

export async function GET() {
  const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };
  return NextResponse.json(config.fieldConfig ?? {});
}

export async function POST(req: NextRequest) {
  try {
    const fieldConfig = await req.json();
    const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };
    await writeJsonAtomic(CONFIG_FILE, { ...config, fieldConfig });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
