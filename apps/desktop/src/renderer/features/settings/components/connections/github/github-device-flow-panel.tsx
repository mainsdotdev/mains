import { useLayoutEffect, useRef, useState } from "react";
import {
  AsciiSpinner,
  Button,
  Caption,
  CopyButton,
  ErrorText,
  Muted,
  Text,
} from "@/components/ui";
import { Github } from "@/components/ui/icons";
import {
  useStartGithubDeviceFlowMutation,
  usePollGithubDeviceFlowMutation,
} from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { createGitHubDeviceFlowLifecycle, idleGitHubDeviceFlow } from "../../../lib/github-device-flow-lifecycle";
import { onTransportChange } from "@/lib/transport";

interface GitHubDeviceFlowPanelProps {
  /** Runs the wizard's shared save-credentials tail with the token. */
  onToken: (token: string) => Promise<void>;
  /** True while the wizard is saving the token / loading repositories. */
  submitting: boolean;
  isCurrent?: () => boolean;
}
const currentPane = () => true;

/**
 * GitHub OAuth device flow: show a one-time code, send the user to
 * github.com/login/device, poll until they approve, then hand the token
 * to the wizard. Same result as pasting a PAT — only the acquisition
 * differs.
 */
export function GitHubDeviceFlowPanel({
  onToken,
  submitting,
  isCurrent = currentPane,
}: GitHubDeviceFlowPanelProps) {
  const [startFlow] = useStartGithubDeviceFlowMutation();
  const [pollFlow] = usePollGithubDeviceFlowMutation();
  const [view, setView] = useState({ scope: isCurrent, state: idleGitHubDeviceFlow });
  // A replacement wizard must never paint the previous wizard's code.
  if (view.scope !== isCurrent) setView({ scope: isCurrent, state: idleGitHubDeviceFlow });
  const state = view.scope === isCurrent ? view.state : idleGitHubDeviceFlow;
  const callback = useRef(onToken);
  const owner = useRef<ReturnType<typeof createGitHubDeviceFlowLifecycle> | null>(null);
  useLayoutEffect(() => { callback.current = onToken; });
  useLayoutEffect(() => {
    const lifecycle = createGitHubDeviceFlowLifecycle({
      start: () => startFlow().unwrap(), poll: (code) => pollFlow(code).unwrap(),
      open: (url) => window.api.shell.openExternal(url),
      onToken: (token) => callback.current(token),
      change: (state) => setView({ scope: isCurrent, state }), error: extractErrorMessage,
      isCurrent,
    });
    owner.current = lifecycle;
    const off = onTransportChange(() => lifecycle.retire());
    return () => { off(); lifecycle.close(); if (owner.current === lifecycle) owner.current = null; };
  }, [startFlow, pollFlow, isCurrent]);
  const { auth, error } = state;
  const isStarting = state.phase === "starting";
  const handleStart = () => { void owner.current?.start(); };

  if (submitting || state.phase === "submitting") {
    return (
      <div className="flex flex-1 items-center gap-2 py-6 justify-center">
        <AsciiSpinner variant="null" />
        <Muted>Connecting to GitHub...</Muted>
      </div>
    );
  }

  if (auth) {
    return (
      <div className="flex flex-1 flex-col justify-between gap-4">
        <Muted>
          Enter this code on GitHub to authorize Mains. The page should have
          opened in your browser.
        </Muted>

        <div className="flex items-center gap-2">
          <Text
            as="code"
            size="xl"
            align="center"
            className="flex-1 tracking-[0.3em] font-mono py-3 rounded-xl bg-primary dark:bg-primary-900 select-all"
          >
            {auth.userCode}
          </Text>
          <CopyButton text={auth.userCode} tooltip="Copy code" variant="bare"
          className=" text-primary-700 dark:text-primary-300 hover:text-primary-900 dark:hover:text-primary-100 transition-colors cursor-pointer"
          />
        </div>

        {error && <ErrorText>{error}</ErrorText>}

        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AsciiSpinner variant="null" kind="circle" />
            <Caption>Waiting for approval on GitHub...</Caption>
          </span>
          <span className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => owner.current?.cancel()}>
              Cancel
            </Button>
            <Button
          variant="ghost"
          onClick={() => owner.current?.openBrowser()}
          className="flex glass-outline py-2 items-center gap-2 bg-primary-950 hover:bg-primary-900 text-primary!"
            >
          <Github className="size-4" />
          Open GitHub
            </Button>
          </span>
        </div>
      </div>
    );
  }

  return (
    // The pane's height comes from the taller token form — center the
    // whole block vertically so it doesn't hug the top with a bare gap.
    <div className="flex flex-1 flex-col justify-between gap-4">
      <Muted className="mt-4">
        Authorize Mains from your browser — no token to create or paste.
        GitHub shows a one-time code; approve it and you&apos;re connected.
      </Muted>

      {error && <ErrorText>{error}</ErrorText>}

      <div className="flex justify-end pt-2">
        <Button
          variant="ghost"
          onClick={handleStart}
          disabled={isStarting || state.phase === "retired"}
          isLoading={isStarting}
          className="flex glass-outline py-2 items-center gap-2 bg-primary-950 hover:bg-primary-900 text-primary!"
        >
          <Github className="size-4" />
          {isStarting ? "Starting..." : "Sign in with GitHub"}
        </Button>
      </div>
    </div>
  );
}
