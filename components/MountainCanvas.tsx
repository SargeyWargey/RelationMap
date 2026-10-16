"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

import { createMountainEngine, type EngineCallbacks, type MountainApi, type MountainEngine } from "@/components/mountain/engine";
import type { World } from "@/lib/mountainWorld";

export type { MountainApi, MountainMode, MountainPose } from "@/components/mountain/engine";

type Props = EngineCallbacks & {
  world: World | null;
  darkMode: boolean;
  selectedPeak: number | null;
  relatedPeaks: number[];
  visited: Set<string>;
  leftInset: number;
  rightInset: number;
  /** Auto day/night cycle: a full day every `secondsPerDay`. */
  cycle: { auto: boolean; secondsPerDay: number };
  apiRef: MutableRefObject<MountainApi | null>;
};

/** The Mountain: a walkable landscape. All rendering lives in ./mountain/engine. */
export function MountainCanvas(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MountainEngine | null>(null);
  const cbRef = useRef<EngineCallbacks>(props);
  cbRef.current = props;
  const { world, darkMode, selectedPeak, relatedPeaks, visited, leftInset, rightInset, cycle, apiRef } = props;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const engine = createMountainEngine(mount, cbRef);
    engineRef.current = engine;
    apiRef.current = engine.api;
    return () => {
      engine.dispose();
      engineRef.current = null;
      apiRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => { engineRef.current?.setInsets(leftInset, rightInset); }, [leftInset, rightInset]);
  useEffect(() => { engineRef.current?.setTheme(darkMode); }, [darkMode]);
  useEffect(() => { engineRef.current?.setCycle(cycle.auto, cycle.secondsPerDay); }, [cycle.auto, cycle.secondsPerDay]);
  useEffect(() => { if (world) engineRef.current?.setWorld(world); }, [world]);
  useEffect(() => { engineRef.current?.setSelection(selectedPeak, relatedPeaks); }, [selectedPeak, relatedPeaks, world]);
  useEffect(() => { engineRef.current?.setVisited(visited); }, [visited]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />;
}
