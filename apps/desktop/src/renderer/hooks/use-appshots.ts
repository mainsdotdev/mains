import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "@/components/ui";
import { useCapabilities } from "@/lib/platform";
import { useAppDispatch } from "@/lib/redux/hooks";
import { addContextItem } from "@/lib/redux/slices/workspaceSlice";
import type { AppshotCapture } from "../../shared/appshots";
import type { ServiceResponse } from "../../shared/ipc-kit/service-response";

/** Bridges main-process global captures into the next composer message. */
export function useAppshots(): void {
  const caps = useCapabilities();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!caps.appshots) return;

    const attach = (capture: AppshotCapture) => {
      if (seenRef.current.has(capture.id)) return;
      seenRef.current.add(capture.id);
      dispatch(addContextItem({ kind: "appshot", ...capture }));
      if (!locationRef.current.startsWith("/code")) navigate("/code");
      toast.success(`Window captured from ${capture.appName}`);
    };

    const unsubscribeCapture = window.api.appshots.onCaptured((capture) => {
      attach(capture);
      void window.api.appshots.acknowledge(capture.id);
    });
    const unsubscribeError = window.api.appshots.onError((message) => {
      toast.error(message);
    });

    void window.api.appshots.consumePending().then(
      (response: ServiceResponse<AppshotCapture[]>) => {
        if (!response.success) return;
        response.data.forEach(attach);
      },
      () => {
        // The renderer can mount while the app is shutting down.
      },
    );

    return () => {
      unsubscribeCapture();
      unsubscribeError();
    };
  }, [caps.appshots, dispatch, navigate]);
}
