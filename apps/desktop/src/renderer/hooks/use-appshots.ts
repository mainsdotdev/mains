import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "@/components/ui";
import { useCapabilities } from "@/lib/platform";
import { useAppDispatch } from "@/lib/redux/hooks";
import { addContextItem } from "@/lib/redux/slices/workspaceSlice";
import { createLensReceiver } from "../../shared/capture-shortcut-lifecycle";
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

  useLayoutEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!caps.appshots) return;

    const receiver = createLensReceiver<AppshotCapture>(seenRef.current, {
      attach: (capture) => { dispatch(addContextItem({ kind: "appshot", ...capture })); },
      acknowledge: (id) => window.api.appshots.acknowledge(id),
      present: (capture) => {
        if (!locationRef.current.startsWith("/code")) navigate("/code");
        toast.success(`Window captured from ${capture.appName}`);
      },
    });
    const unsubscribeCapture = window.api.appshots.onCaptured(receiver.receive);
    const unsubscribeError = window.api.appshots.onError((message) => {
      if (receiver.active()) toast.error(message);
    });

    void window.api.appshots.consumePending().then(
      (response: ServiceResponse<AppshotCapture[]>) => {
        if (!response.success) return;
        response.data.forEach(receiver.receive);
      },
      () => {
        // The renderer can mount while the app is shutting down.
      },
    );

    return () => {
      receiver.close();
      unsubscribeCapture();
      unsubscribeError();
    };
  }, [caps.appshots, dispatch, navigate]);
}
