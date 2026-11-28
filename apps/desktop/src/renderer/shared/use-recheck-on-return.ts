import { useEffect, useRef } from 'preact/hooks';

/**
 * After the user leaves for a terminal or a setup page, rechecks those providers once when the
 * window gets focus back, so nobody has to press Recheck. Returns the function that marks one.
 */
export function useRecheckOnReturn(recheck: (providerId: string) => void): (providerId: string) => void {
  const waiting = useRef(new Set<string>());
  const latest = useRef(recheck);
  latest.current = recheck;
  useEffect(() => {
    const onFocus = (): void => {
      const ids = [...waiting.current];
      waiting.current.clear();
      for (const id of ids) latest.current(id);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return (providerId) => {
    waiting.current.add(providerId);
  };
}
