import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Calls `fetcher` immediately and then every `intervalMs` while `enabled`.
 * Polling pauses while the tab is hidden to avoid burning the rate limit.
 */
export function usePolling(fetcher, intervalMs, { enabled = true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      setData(await fetcherRef.current());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, refresh, ...deps]);

  return { data, error, refresh, loading: data === null && error === null };
}
