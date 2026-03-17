import { ProjectCityScreen } from "@/components/ProjectCityScreen";
import { CONFIG_FILE, GRAPH_FILE } from "@/lib/config";
import { readJsonFile } from "@/lib/storage";
import { runSync } from "@/lib/notion/sync";
import type { AppConfig, GraphData } from "@/lib/types";

export default async function ProjectCityPage() {
  let graph = await readJsonFile<GraphData>(GRAPH_FILE);
  if (!graph) {
    graph = await runSync();
  }

  const config = (await readJsonFile<AppConfig>(CONFIG_FILE)) ?? { databaseColors: {} };

  return (
    <main style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      <ProjectCityScreen
        initialGraph={graph}
        databaseColors={config.databaseColors}
        lastSyncAt={config.lastSyncAt}
      />
    </main>
  );
}
