/**
 * Keeps a long-lived tab on the current build.
 *
 * An iOS home-screen app is never really closed — it is suspended and resumed,
 * so it can keep running a months-old bundle until the user force-quits it.
 * This hook notices on every resume that the server is serving a different
 * commit and reloads once so the app self-heals instead of needing a force-quit.
 */

import { useEffect, useRef } from 'react';
import { fetchVersion } from '../api';

// The backend reports this when it cannot read its own git hash. Treating it as
// a version change would reload the page on every resume, so it is ignored.
const UNKNOWN_VERSION = 'unknown';

export function useAppUpdate(): void {
  // The build this tab actually loaded, captured once and never overwritten.
  const runningVersionRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function recordRunningVersion() {
      const version = await fetchVersion();
      if (isMounted && runningVersionRef.current === null) runningVersionRef.current = version;
    }

    async function reloadIfServerHasNewerBuild() {
      const runningVersion = runningVersionRef.current;
      if (!runningVersion || runningVersion === UNKNOWN_VERSION) return;

      const serverVersion = await fetchVersion();
      if (!isMounted) return;
      if (serverVersion === UNKNOWN_VERSION || serverVersion === runningVersion) return;

      window.location.reload();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') void reloadIfServerHasNewerBuild();
    }

    function handleResume() {
      void reloadIfServerHasNewerBuild();
    }

    void recordRunningVersion();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handleResume);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handleResume);
    };
  }, []);
}
