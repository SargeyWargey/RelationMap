import { NextRequest, NextResponse } from "next/server";

import { readOrreryConfig, writeOrreryConfig, validateTierMapping } from "@/lib/orreryConfig";
import type { OrreryConfig, RingDatabaseMapping, TierMapping } from "@/lib/orreryTypes";

import { errorResponse, isPlainObject, readJsonBody } from "../_lib/validate";

const MAX_DB_ID_LENGTH = 100;
const MAX_RING_DATABASES = 50;
const RING_SUB_TYPES = new Set(["planet-rings", "star-belt"]);

function isValidDbId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_DB_ID_LENGTH;
}

export async function GET() {
  const orreryConfig = await readOrreryConfig();
  return NextResponse.json(orreryConfig ?? null);
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await readJsonBody(req);
    if (parsed.error) return parsed.error;
    const body = parsed.body;

    if (!isPlainObject(body) || !isPlainObject(body.tierMapping)) {
      return NextResponse.json({ error: "tierMapping is required." }, { status: 400 });
    }
    const tierMapping = body.tierMapping;

    for (const key of ["galaxyDatabaseId", "starDatabaseId", "planetDatabaseId", "moonDatabaseId"]) {
      const value = tierMapping[key];
      if (value !== undefined && !isValidDbId(value)) {
        return errorResponse(`${key} must be a database id string.`, 400);
      }
    }

    const ringsRaw = tierMapping.ringDatabases;
    if (ringsRaw !== undefined && !Array.isArray(ringsRaw)) {
      return errorResponse("ringDatabases must be an array.", 400);
    }
    const ringDatabases: RingDatabaseMapping[] = [];
    for (const ring of (ringsRaw ?? []) as unknown[]) {
      if (ringDatabases.length >= MAX_RING_DATABASES) {
        return errorResponse(`Too many ring databases (max ${MAX_RING_DATABASES}).`, 400);
      }
      if (!isPlainObject(ring) || !isValidDbId(ring.databaseId)) {
        return errorResponse("Each ring database needs a databaseId string.", 400);
      }
      if (typeof ring.subType !== "string" || !RING_SUB_TYPES.has(ring.subType)) {
        return errorResponse("Each ring database needs a valid subType.", 400);
      }
      ringDatabases.push({
        databaseId: ring.databaseId,
        subType: ring.subType as RingDatabaseMapping["subType"],
      });
    }

    const errors = validateTierMapping(tierMapping as Partial<TierMapping>);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
    }

    const orreryConfig: OrreryConfig = {
      tierMapping: {
        galaxyDatabaseId: tierMapping.galaxyDatabaseId as string,
        starDatabaseId: tierMapping.starDatabaseId as string,
        planetDatabaseId: tierMapping.planetDatabaseId as string,
        moonDatabaseId: tierMapping.moonDatabaseId as string,
        ringDatabases,
      },
      configuredAt: new Date().toISOString(),
    };

    await writeOrreryConfig(orreryConfig);
    return NextResponse.json({ ok: true, orreryConfig });
  } catch (err) {
    console.error("orrery-config POST failed:", err);
    return errorResponse("Failed to save orrery configuration.", 500);
  }
}
