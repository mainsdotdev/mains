import { useState, useEffect, useCallback, useRef } from "react";
import { createUpdateProjection, initialUpdateState } from "../../shared/update-lifecycle";

export function useAutoUpdate() {
  const [state, setState] = useState(initialUpdateState);
  const owner = useRef<ReturnType<typeof createUpdateProjection> | null>(null);

  useEffect(() => {
    const projection = createUpdateProjection(setState);
    owner.current = projection;
    const read = projection.read();
    // Update status belongs to the local shell even while a remote backend is
    // selected. Subscribe before reading so synchronous pushes cannot be lost.
    const off = window.api.updates.onStatusChange(projection.push);
    void (async () => {
      try {
        const result = await window.api.updates.getStatus();
        if (result?.success && result.data) read.apply(result.data);
        else read.fail(result?.error);
      } catch (error) { read.fail(error); }
    })();
    return () => { projection.close(); off(); if (owner.current === projection) owner.current = null; };
  }, []);

  const check = useCallback(async () => {
    const read = owner.current?.read();
    if (!read) return;
    try {
      const result = await window.api.updates.checkForUpdates();
      if (result?.success && result.data) read.apply(result.data);
      else read.fail(result?.error);
    } catch (error) { read.fail(error); }
  }, []);

  const install = useCallback(() => {
    const read = owner.current?.read();
    if (!read) return;
    void (async () => {
      try {
        const result = await window.api.updates.quitAndInstall();
        if (!result?.success) read.fail(result?.error);
      } catch (error) { read.fail(error); }
    })();
  }, []);

  return { state, check, install };
}
