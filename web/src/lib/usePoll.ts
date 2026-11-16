import { useCallback, useEffect, useRef, useState } from "react";

export interface Poll<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: () => void;
}

/**
 * Calls `fn` now and every `ms` while the tab is visible; pauses when hidden and refreshes
 * immediately when it becomes visible again. Pass `ms = null` (or `enabled = false`) to stop.
 * Re-runs when `deps` change. Overlapping calls are skipped; stale results are ignored.
 */
export function usePoll<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number | null, deps: unknown[] = [], enabled = true): Poll<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const gen = useRef(0);
  const inFlight = useRef(false);

  const run = useCallback(async (myGen: number, signal: AbortSignal) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const v = await fnRef.current(signal);
      if (myGen === gen.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (myGen === gen.current && !(e instanceof DOMException && e.name === "AbortError")) setError(e);
    } finally {
      inFlight.current = false;
      if (myGen === gen.current) setLoading(false);
    }
  }, []);

  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const myGen = ++gen.current;
    const ctrl = new AbortController();
    inFlight.current = false;
    setLoading(true);
    void run(myGen, ctrl.signal);
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (ms !== null && !timer) timer = setInterval(() => void run(myGen, ctrl.signal), ms);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void run(myGen, ctrl.signal);
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled, tick, run, ...deps]);

  return { data, error, loading, refresh };
}
