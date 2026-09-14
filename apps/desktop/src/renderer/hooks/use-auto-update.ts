import { useState, useEffect, useCallback } from "react";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

type UpdateInfo = {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
};

type UpdateProgress = {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
};

type UpdateState = {
  status: UpdateStatus;
  info: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
};

const INITIAL_STATE: UpdateState = {
  status: "idle",
  info: null,
  progress: null,
  error: null,
};

export function useAutoUpdate() {
  const [state, setState] = useState<UpdateState>(INITIAL_STATE);

  useEffect(() => {
    // Fetch current state from main process on mount
    window.api.updates.getStatus().then((result: any) => {
      if (result?.success && result.data) {
        setState(result.data);
      }
    });

    // Listen for state changes pushed from main process
    const unsubscribe = window.api.updates.onStatusChange((data: UpdateState) => {
      if (data) setState(data);
    });
    return () => { unsubscribe(); };
  }, []);

  const check = useCallback(async () => {
    const result = await window.api.updates.checkForUpdates();
    if (result?.success && result.data) {
      setState(result.data);
    }
  }, []);

  const install = useCallback(() => {
    window.api.updates.quitAndInstall();
  }, []);

  return { state, check, install };
}
