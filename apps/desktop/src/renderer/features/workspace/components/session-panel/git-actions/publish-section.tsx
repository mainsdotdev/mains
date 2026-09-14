import { useCallback, useState } from "react";
import { ArrowUp, Github, Lock } from "@/components/ui/icons";
import { Button, Caption, Input, Text, toast } from "@/components/ui";
import {
  useGetPublishPreflightQuery,
  usePublishRepoMutation,
} from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { PanelItem, PanelCollapse, PANEL_ROW_X } from "../panel-item";
import { CheckboxOption } from "./controls";
import type { GitActionsPanel } from "./use-git-actions-panel";

/**
 * Create the GitHub repo and wire up origin. This takes the PR section's slot
 * when the repo has no remote yet — push and PR are impossible until it does.
 */
export function PublishSection({ panel }: { panel: GitActionsPanel }) {
  const {
    workspaceId,
    pending,
    setPending,
    busy,
    refreshStatus,
    isSectionOpen,
    toggleSection,
    closeSection,
  } = panel;
  const isOpen = isSectionOpen("publish");

  const [publishOwnerRepo, setPublishOwnerRepo] = useState("");
  const [publishPrivate, setPublishPrivate] = useState(true);
  const [publishSsh, setPublishSsh] = useState(false);
  const [publishRemote, setPublishRemote] = useState("origin");
  const [publishAdvanced, setPublishAdvanced] = useState(false);

  // gh auth + default owner/name, fetched only while the form is open.
  const { data: preflight, isFetching: preflightFetching } =
    useGetPublishPreflightQuery(workspaceId, { skip: !isOpen });

  const [publishRepo] = usePublishRepoMutation();

  // Default publish target from the gh preflight (authed login + repo name).
  // The input falls back to this until the user types, so no prefill effect
  // (and no cascading-render setState) is needed.
  const defaultOwnerRepo =
    preflight?.ghReady && preflight.login
      ? `${preflight.login}/${preflight.suggestedName}`
      : "";

  const handlePublish = useCallback(async () => {
    if (pending) return;
    const ownerRepo = (publishOwnerRepo || defaultOwnerRepo).trim();
    if (!ownerRepo.includes("/") || ownerRepo.split("/").some((s) => !s.trim())) {
      toast.error("Enter the repository as owner/name.");
      return;
    }
    setPending("publish");
    try {
      const result = await publishRepo({
        workspaceId,
        ownerRepo,
        visibility: publishPrivate ? "private" : "public",
        remoteName: publishRemote.trim() || "origin",
        protocol: publishSsh ? "ssh" : "https",
      }).unwrap();
      toast.success(`Published ${result.owner}/${result.repo}`);
      if (result.url) window.api.shell.openExternal(result.url);
      // Repo now has a remote — collapse this form (push/PR rows take its
      // place) and refresh the live status. The refresh would close the row on
      // its own, but only once it resolves; this closes it on the same beat as
      // the success toast.
      closeSection("publish");
      setPublishOwnerRepo("");
      setPublishAdvanced(false);
      refreshStatus();
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to publish repository."));
    } finally {
      setPending(null);
    }
  }, [
    workspaceId,
    pending,
    setPending,
    publishRepo,
    publishOwnerRepo,
    defaultOwnerRepo,
    publishPrivate,
    publishRemote,
    publishSsh,
    refreshStatus,
    closeSection,
  ]);

  return (
    <>
      <PanelItem
        icon={<Github className="size-4" />}
        label="Publish repository"
        expandable
        expanded={isOpen}
        onClick={() => toggleSection("publish")}
      />
      <PanelCollapse isOpen={isOpen}>
        <div className={`space-y-2 pt-2 pb-1 ${PANEL_ROW_X}`}>
          {!preflightFetching && preflight && !preflight.ghReady && (
            <Text
              as="div"
              size="xs"
              tone="warning"
              className="rounded-lg bg-primary px-3 py-2 dark:bg-warning/10"
            >
              {preflight.notReadyReason ?? "Sign in with the GitHub CLI first."}
            </Text>
          )}

          <div>
            <Caption tone="faint" className="mb-1 block">
              Repository
            </Caption>
            <div className="flex items-center gap-1.5 rounded-lg bg-primary-100/40 px-2.5 dark:bg-primary-800/40">
              <Github className="size-3.5 shrink-0 text-primary-500" />
              <Text as="span" size="xs" tone="faint" className="shrink-0">
                github.com/
              </Text>
              <Input
                variant="bare"
                type="text"
                value={publishOwnerRepo || defaultOwnerRepo}
                onChange={(e) => setPublishOwnerRepo(e.target.value)}
                placeholder="owner/repo"
                aria-label="Repository owner and name"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="min-w-0 flex-1 bg-transparent py-2 font-mono text-xs text-primary-900 placeholder:text-primary-500 focus:outline-none dark:text-primary-100"
              />
            </div>
          </div>

          <div>
            <Caption tone="faint" className="mb-1 block">
              Visibility
            </Caption>
            <div className="flex items-center gap-4">
              <CheckboxOption
                checked={publishPrivate}
                onChange={() => setPublishPrivate(true)}
              >
                <Lock className="size-3.5 text-primary-500" />
                Private
              </CheckboxOption>
              <CheckboxOption
                checked={!publishPrivate}
                onChange={() => setPublishPrivate(false)}
              >
                Public
              </CheckboxOption>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => setPublishAdvanced((v) => !v)}
            className="flex items-center gap-1 pt-2 text-s text-primary-500 hover:text-primary-700 dark:hover:text-primary-300"
          >
            <ArrowUp
              className={`size-3 transition-transform duration-200 ${publishAdvanced ? "rotate-180" : "rotate-90"}`}
            />
            Advanced
          </Button>

          {/* Smoothly expands/collapses via grid-rows 0fr↔1fr. */}
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
              publishAdvanced
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="space-y-2 pt-1">
                <div>
                  <Caption tone="faint" className="mb-1 block">
                    Remote
                  </Caption>
                  <Input
                    value={publishRemote}
                    onChange={(e) => setPublishRemote(e.target.value)}
                    placeholder="origin"
                    spellCheck={false}
                    className="min-w-0 py-2 text-xs"
                  />
                </div>
                <div>
                  <Caption tone="faint" className="mb-1 block">
                    Protocol
                  </Caption>
                  <div className="flex items-center gap-4">
                    <CheckboxOption
                      checked={publishSsh}
                      onChange={() => setPublishSsh(true)}
                    >
                      SSH
                    </CheckboxOption>
                    <CheckboxOption
                      checked={!publishSsh}
                      onChange={() => setPublishSsh(false)}
                    >
                      HTTPS
                    </CheckboxOption>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <PanelItem
          icon={<Github className="size-4" />}
          label="Publish repository"
          onClick={handlePublish}
          disabled={busy || !preflight?.ghReady}
          loading={pending === "publish"}
        />
      </PanelCollapse>
    </>
  );
}
