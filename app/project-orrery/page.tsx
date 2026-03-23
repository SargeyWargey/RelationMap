import { ProjectOrreryScreen } from "@/components/ProjectOrreryScreen";
import { CONFIG_FILE, GRAPH_FILE } from "@/lib/config";
import { readJsonFile } from "@/lib/storage";
import { runSync } from "@/lib/notion/sync";
import type { AppConfig, GraphData } from "@/lib/types";
import type { OrreryConfig } from "@/lib/orreryTypes";

export default async function ProjectOrreryPage() {
  let graph = await readJsonFile<GraphData>(GRAPH_FILE);
  if (!graph) {
    graph = await runSync();
  }

  const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };
  const orreryConfig: OrreryConfig | null = config.orreryConfig ?? null;

  return (
    <main style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      <ProjectOrreryScreen
        initialGraph={graph}
        databaseColors={config.databaseColors}
        lastSyncAt={config.lastSyncAt}
        orreryConfig={orreryConfig}
      />
    </main>
  );
}
