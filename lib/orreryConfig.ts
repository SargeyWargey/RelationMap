import { CONFIG_FILE } from "@/lib/config";
import { readJsonFile, writeJsonAtomic } from "@/lib/storage";
import type { AppConfig } from "@/lib/types";
import type { OrreryConfig, TierMapping } from "@/lib/orreryTypes";

/** Galaxy and Star tiers are required; Planet is optional; Moon needs a Planet tier. */
export function validateTierMapping(mapping: Partial<TierMapping>): string[] {
  const errors: string[] = [];
  if (!mapping.galaxyDatabaseId) errors.push("Galaxy database is required.");
  if (!mapping.starDatabaseId) errors.push("Star database is required.");
  if (mapping.moonDatabaseId && !mapping.planetDatabaseId) errors.push("Moons need a Planet database to orbit.");
  const used = [mapping.galaxyDatabaseId, mapping.starDatabaseId, mapping.planetDatabaseId, mapping.moonDatabaseId].filter(Boolean);
  if (new Set(used).size !== used.length) errors.push("Each tier needs a different database.");
  return errors;
}

export function isOrreryConfigured(config: AppConfig): boolean {
  const m = config.orreryConfig?.tierMapping;
  if (!m) return false;
  return !!(m.galaxyDatabaseId && m.starDatabaseId);
}

export async function readOrreryConfig(): Promise<OrreryConfig | null> {
  const config = await readJsonFile<AppConfig>(CONFIG_FILE);
  return config?.orreryConfig ?? null;
}

export async function writeOrreryConfig(orreryConfig: OrreryConfig): Promise<void> {
  const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };
  await writeJsonAtomic(CONFIG_FILE, { ...config, orreryConfig });
}
