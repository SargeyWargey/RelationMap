import { NextRequest, NextResponse } from "next/server";

import { CONFIG_FILE } from "@/lib/config";
import { readJsonFile, writeJsonAtomic } from "@/lib/storage";
import type { AppConfig } from "@/lib/types";

import { errorResponse, isPlainObject, readJsonBody } from "../_lib/validate";

const MAX_ENTRIES = 500;
const MAX_KEY_LENGTH = 100;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export async function GET() {
  const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };
  return NextResponse.json(config.fieldConfig ?? {});
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await readJsonBody(req);
    if (parsed.error) return parsed.error;
    const fieldConfig = parsed.body;

    if (!isPlainObject(fieldConfig)) {
      return errorResponse("Expected a JSON object body.", 400);
    }
    const entries = Object.entries(fieldConfig);
    if (entries.length > MAX_ENTRIES) {
      return errorResponse(`Too many field-config entries (max ${MAX_ENTRIES}).`, 400);
    }
    for (const [databaseId, value] of entries) {
      if (databaseId.length > MAX_KEY_LENGTH) {
        return errorResponse("Invalid database id key.", 400);
      }
      if (!isPlainObject(value)) {
        return errorResponse("Each field config entry must be an object.", 400);
      }
      const color = value.databaseColor;
      if (color != null && (typeof color !== "string" || !HEX_COLOR_PATTERN.test(color))) {
        return errorResponse("databaseColor must be a #RRGGBB hex value.", 400);
      }
    }

    const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };
    await writeJsonAtomic(CONFIG_FILE, {
      ...config,
      fieldConfig: fieldConfig as AppConfig["fieldConfig"],
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("field-config POST failed:", err);
    return errorResponse("Failed to save field configuration.", 500);
  }
}
