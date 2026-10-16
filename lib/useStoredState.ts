"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * State persisted in localStorage, hydration-safe: the server and the first
 * client render both use `fallback`; the stored value is loaded right after
 * mount. `loaded` turns true once that has happened, so callers can hold off
 * on expensive work (or rendering) until the user's saved choice is known.
 */
export function useStoredState<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T,
  serialize: (value: T) => string,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);
  const parseRef = useRef(parse);
  const serializeRef = useRef(serialize);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(parseRef.current(raw));
    } catch { /* unavailable or corrupt — keep the fallback */ }
    setLoaded(true);
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(key, serializeRef.current(value)); } catch { /* ignore */ }
  }, [key, value, loaded]);

  const set = useCallback<Dispatch<SetStateAction<T>>>((v) => setValue(v), []);
  return [value, set, loaded];
}

export const setCodec = {
  parse: (raw: string) => new Set(JSON.parse(raw) as string[]),
  serialize: (v: Set<string>) => JSON.stringify([...v]),
};
