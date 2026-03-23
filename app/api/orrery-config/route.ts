import { NextRequest, NextResponse } from "next/server";

import { readOrreryConfig, writeOrreryConfig, validateTierMapping } from "@/lib/orreryConfig";
import type { OrreryConfig } from "@/lib/orreryTypes";

export async function GET() {
  const orreryConfig = await readOrreryConfig();
  return NextResponse.json(orreryConfig ?? null);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<OrreryConfig>;

    if (!body.tierMapping) {
      return NextResponse.json({ error: "tierMapping is required." }, { status: 400 });
    }

    const errors = validateTierMapping(body.tierMapping);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
    }

    const orreryConfig: OrreryConfig = {
      tierMapping: {
        galaxyDatabaseId: body.tierMapping.galaxyDatabaseId!,
        starDatabaseId: body.tierMapping.starDatabaseId!,
        planetDatabaseId: body.tierMapping.planetDatabaseId!,
        moonDatabaseId: body.tierMapping.moonDatabaseId!,
        ringDatabases: body.tierMapping.ringDatabases ?? [],
      },
      configuredAt: new Date().toISOString(),
    };

    await writeOrreryConfig(orreryConfig);
    return NextResponse.json({ ok: true, orreryConfig });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
