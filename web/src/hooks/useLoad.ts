// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

export interface Loaded<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Runs a read once per dependency change. Stale responses (older request) are ignored. */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    const request = ++latest.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    loader.current().then(
      (data) => { if (request === latest.current) setState({ data, error: null, loading: false }); },
      (error) => { if (request === latest.current) setState({ data: null, error, loading: false }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, reload };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
