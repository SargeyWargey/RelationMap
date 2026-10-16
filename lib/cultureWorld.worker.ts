// Grows The Culture off the main thread. The graph is sent once; each build
// only sends the options.
import { buildCulture, packCulture, type CultureWorkerRequest, type CultureWorkerResponse } from "./cultureWorld";
import type { DatabaseSchema, GraphData } from "./types";

let graph: GraphData | null = null;
let schemas: DatabaseSchema[] = [];
let nodeIndex = new Map<string, number>();

self.onmessage = (e: MessageEvent<CultureWorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "graph") {
    graph = msg.graph;
    schemas = msg.schemas;
    nodeIndex = new Map(graph.nodes.map((n, i) => [n.id, i]));
    return;
  }
  if (!graph) return;
  const t0 = performance.now();
  const world = buildCulture(graph, {
    enabled: msg.enabled ? new Set(msg.enabled) : null,
    hidden: new Set(msg.hidden),
    schemas,
    colors: msg.colors,
    now: new Date(msg.now),
  });
  const packed = packCulture(world, nodeIndex);
  const res: CultureWorkerResponse = { seq: msg.seq, world: packed, ms: performance.now() - t0 };
  (self as unknown as Worker).postMessage(res, [packed.hist.births.buffer, packed.hist.dormant.buffer]);
};
