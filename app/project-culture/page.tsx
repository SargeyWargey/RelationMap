import fs from "node:fs/promises";

import { ProjectCultureScreen } from "@/components/ProjectCultureScreen";
import { CONFIG_FILE, GRAPH_FILE, SCHEMAS_DIR } from "@/lib/config";
import { readJsonFile } from "@/lib/storage";
import { runSync } from "@/lib/notion/sync";
import type { AppConfig, DatabaseSchema, GraphData } from "@/lib/types";

async function readSchemas(): Promise<DatabaseSchema[]> {
  let files: string[];
  try {
    files = await fs.readdir(SCHEMAS_DIR);
  } catch {
    return [];
  }
  const schemas = await Promise.all(
    files.filter((f) => f.endsWith(".json")).map((f) => readJsonFile<DatabaseSchema>(`${SCHEMAS_DIR}/${f}`)),
  );
  return schemas.filter((s): s is DatabaseSchema => !!s);
}

export default async function CulturePage() {
  let graph = await readJsonFile<GraphData>(GRAPH_FILE);
  if (!graph) {
    graph = await runSync();
  }

  const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };
  const schemas = await readSchemas();

  return (
    <main style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      <ProjectCultureScreen
        initialGraph={graph}
        databaseColors={config.databaseColors}
        fieldConfig={config.fieldConfig ?? {}}
        schemas={schemas}
        initialCultureConfig={config.cultureConfig}
      />
    </main>
  );
}
