"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

import {
  createCultureEngine,
  type CultureApi,
  type CultureCallbacks,
  type CultureEngine,
  type CultureInsets,
  type CultureSettings,
} from "@/components/culture/engine";
import type { CultureWorld } from "@/lib/cultureWorld";

export type { CultureApi, CultureInsets, CultureSettings, CultureStain } from "@/components/culture/engine";

type Props = CultureCallbacks & {
  world: CultureWorld | null;
  darkMode: boolean;
  selected: number | null;
  highlight: { species?: number; colony?: number } | null;
  settings: CultureSettings;
  insets: CultureInsets;
  /** Days of history per second of playback. */
  speed: number;
  /** Play the time-lapse when the first culture arrives. */
  timelapse: boolean;
  apiRef: MutableRefObject<CultureApi | null>;
};

/** The Culture: a living petri dish. All rendering lives in ./culture/engine. */
export function CultureCanvas(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CultureEngine | null>(null);
  const cbRef = useRef<CultureCallbacks>(props);
  cbRef.current = props;
  const timelapseRef = useRef(props.timelapse);
  timelapseRef.current = props.timelapse;
  const { world, darkMode, selected, highlight, settings, insets, speed, apiRef } = props;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const engine = createCultureEngine(mount, cbRef);
    engineRef.current = engine;
    apiRef.current = engine.api;
    return () => {
      engine.dispose();
      engineRef.current = null;
      apiRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => { engineRef.current?.setTheme(darkMode); }, [darkMode]);
  useEffect(() => {
    engineRef.current?.setSettings({ filaments: settings.filaments, sizeScale: settings.sizeScale, stain: settings.stain, labels: settings.labels });
  }, [settings.filaments, settings.sizeScale, settings.stain, settings.labels]);
  useEffect(() => {
    engineRef.current?.setInsets({ left: insets.left, right: insets.right, top: insets.top, bottom: insets.bottom });
  }, [insets.left, insets.right, insets.top, insets.bottom]);
  useEffect(() => { engineRef.current?.setSpeed(speed); }, [speed]);
  useEffect(() => { if (world) engineRef.current?.setWorld(world, { timelapse: timelapseRef.current }); }, [world]);
  useEffect(() => { engineRef.current?.setSelection(selected); }, [selected, world]);
  useEffect(() => { engineRef.current?.setHighlight(highlight); }, [highlight, world]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />;
}
