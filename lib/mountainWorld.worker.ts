// Builds the Mountain world off the main thread.
import { buildWorld } from "./mountainWorld";
import type { GraphData } from "./types";

type Req = { seq: number; graph: GraphData; edges: GraphData["edges"]; resolution: number };

self.onmessage = (e: MessageEvent<Req>) => {
  const { seq, graph, edges, resolution } = e.data;
  const world = buildWorld(graph, edges, { resolution });
  (self as unknown as Worker).postMessage({ seq, world }, [world.heights.buffer, world.normalShadow.buffer, world.ao.buffer, world.trees.buffer, world.horizon.buffer]);
};
