import { useEffect, useState } from "react";
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
  type GitHubDeviceAuthorization,
} from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";

interface GitHubDeviceFlowPanelProps {
  /** Runs the wizard's shared save-credentials tail with the token. */
  onToken: (token: string) => Promise<void>;
  /** True while the wizard is saving the token / loading repositories. */
  submitting: boolean;
}

/**
 * GitHub OAuth device flow: show a one-time code, send the user to
 * github.com/login/device, poll until they approve, then hand the token
 * to the wizard. Same result as pasting a PAT — only the acquisition
 * differs.
 */
export function GitHubDeviceFlowPanel({
  onToken,
  submitting,
}: GitHubDeviceFlowPanelProps) {
  const [startFlow, { isLoading: isStarting }] =
    useStartGithubDeviceFlowMutation();
  const [pollFlow] = usePollGithubDeviceFlowMutation();

  const [auth, setAuth] = useState<GitHubDeviceAuthorization | null>(null);
  const [error, setError] = useState("");

  const handleStart = async () => {
    setError("");
    try {
      const authorization = await startFlow().unwrap();
      setAuth(authorization);
      // Send the user straight to the approval page — the code is on screen.
      window.api.shell.openExternal(authorization.verificationUri);
    } catch (err) {
      setError(extractErrorMessage(err, "Could not start GitHub sign-in"));
    }
  };


  // Poll while an authorization is pending. GitHub dictates the pace
  // (interval, slow_down); the loop dies with the effect on cancel/unmount.
  useEffect(() => {
    if (!auth) return;

    let cancelled = false;
    let timer: number | undefined;
    let intervalMs = Math.max(auth.interval, 1) * 1000;
    const expiresAt = Date.now() + auth.expiresIn * 1000;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > expiresAt) {
        setAuth(null);
        setError("The sign-in code expired. Start again.");
        return;
      }
      try {
        const result = await pollFlow(auth.deviceCode).unwrap();
        if (cancelled) return;

        if (result.status === "success") {
          setAuth(null);
          await onToken(result.token);
          return;
        }
        if (result.status === "slow_down") {
          intervalMs = Math.max(result.interval, 1) * 1000;
        } else if (result.status === "expired") {
          setAuth(null);
          setError("The sign-in code expired. Start again.");
          return;
        } else if (result.status === "denied") {
          setAuth(null);
          setError("Sign-in was declined on GitHub.");
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setAuth(null);
        setError(extractErrorMessage(err, "GitHub sign-in failed"));
        return;
      }
      timer = window.setTimeout(tick, intervalMs);
    };

    timer = window.setTimeout(tick, intervalMs);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  if (submitting) {
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

        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AsciiSpinner variant="null" kind="circle" />
            <Caption>Waiting for approval on GitHub...</Caption>
          </span>
          <span className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setAuth(null)}>
              Cancel
            </Button>
            <Button
          variant="ghost"
          onClick={() => window.api.shell.openExternal(auth.verificationUri)}
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
          disabled={isStarting}
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
