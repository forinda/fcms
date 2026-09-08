/**
 * A request, as three states.
 *
 * Every screen here needs the same three — loading, failed, loaded — and a
 * screen that forgets the middle one renders an empty list where an error
 * belongs, which reads as "you have nothing" rather than "this did not load".
 */
import { useCallback, useEffect, useState } from "react";

export interface Async<T> {
  readonly data: T | undefined;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly reload: () => void;
}

export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): Async<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  useEffect(() => {
    let live = true;
    setLoading(true);
    run()
      .then((value) => {
        if (!live) return;
        setData(value);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    // The guard is not ceremony: a list that resolves after you have navigated
    // away sets state on a screen nobody is looking at, and the next one shows
    // the previous screen's data for a frame.
    return () => {
      live = false;
    };
  }, [run, tick]);

  return { data, error, loading, reload: () => setTick((n) => n + 1) };
}
