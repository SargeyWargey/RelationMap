import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const NODES_DIR = path.join(DATA_DIR, "nodes");
export const GRAPH_FILE = path.join(DATA_DIR, "graph.json");
export const CONFIG_FILE = path.join(DATA_DIR, "config.json");
export const SCHEMAS_DIR = path.join(DATA_DIR, "schemas");

export const DEFAULT_COLORS = [
  "#0D9488",
  "#F97316",
  "#2563EB",
  "#DC2626",
  "#7C3AED",
  "#16A34A",
  "#EA580C",
  "#4F46E5",
  "#BE123C",
  "#0891B2",
];
