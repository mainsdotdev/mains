import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { samePrRevision, type PrRefInput, type PrRevision } from "@mains/contracts/pull-requests";
import { Button, Label, Modal, ModalHeader, Select, Text, Textarea } from "@/components/ui";
import { AssistantAssignmentCard } from "@/features/assistants/components/assistant-assignment-card";
import { useAssistantUpdates } from "@/features/assistants/hooks/use-assistant-updates";
import { assistantHref } from "@/features/assistants/lib/assistant-navigation";
import { assistantsReadyForWork, errorText } from "@/features/assistants/lib/assistant-ui";
import { useGetAccountQuery } from "@/lib/redux/api";
import { useAssistantOverviewQuery, useAssistantPullRequestReviewsQuery, useReviewPullRequestWithAssistantMutation } from "@/lib/redux/api/assistantsApi";
import { getTransport } from "@/lib/transport";

export function PullRequestMateAction({ pr, revision, disabled, onReviewed }: {
  pr: PrRefInput;
  revision: PrRevision;
  disabled: boolean;
  onReviewed(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={opener} variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>Review with Mate</Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} returnFocusRef={opener} className="w-full max-w-md text-primary-900 dark:text-primary-100">
        <ModalHeader onClose={() => setOpen(false)}>Review with Mate</ModalHeader>
        {open && <ReviewForm pr={pr} revision={revision} disabled={disabled} onReviewed={id => { setOpen(false); onReviewed(id); }} />}
      </Modal>
    </>
  );
}

function ReviewForm({ pr, revision, disabled, onReviewed }: {
  pr: PrRefInput;
  revision: PrRevision;
  disabled: boolean;
  onReviewed(id: string): void;
}) {
  const mateLabelId = useId();
  const { currentData: account, isError: accountError, refetch: refetchAccount } = useGetAccountQuery();
  const { currentData: overview, isError, refetch } = useAssistantOverviewQuery(account?.id ?? "", { skip: !account });
  const { currentData: reviews } = useAssistantPullRequestReviewsQuery({ accountId: account?.id ?? "", pr }, { skip: !account });
  const [startReview, { isLoading }] = useReviewPullRequestWithAssistantMutation();
  const [chosenMate, setChosenMate] = useState("");
  const [focus, setFocus] = useState("");
  const [failure, setFailure] = useState("");
  const mounted = useRef(false);
  const submitting = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const mates = assistantsReadyForWork(overview);
  const assistantId = chosenMate || (mates.length === 1 ? mates[0].id : "");
  const eligible = mates.some(mate => mate.id === assistantId);
  const existing = reviews?.find(review => review.assignment.toAssistantId === assistantId && samePrRevision(review.revision, revision));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || disabled || !account || !eligible) return;
    if (existing) {
      onReviewed(existing.assignment.id);
      return;
    }
    submitting.current = true;
    setFailure("");
    const transport = getTransport();
    try {
      const assignment = await startReview({ accountId: account.id, assistantId, pr, revision, focus }).unwrap();
      if (mounted.current && getTransport() === transport) onReviewed(assignment.id);
    } catch (error) {
      if (mounted.current && getTransport() === transport) setFailure(errorText(error));
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 overflow-y-auto px-5 pb-5">
      <Text as="p" size="s" tone="subtle">Review the PR description and diff at <code>{revision.headOid.slice(0, 7)}</code>. The report appears on this pull request in Mains.</Text>
      {accountError || isError ? (
        <Button variant="secondary" onClick={() => void (accountError ? refetchAccount() : refetch())}>Retry loading Mates</Button>
      ) : !overview ? (
        <Text as="p" size="s" role="status">Loading Mates…</Text>
      ) : mates.length === 0 ? (
        <Text as="p" size="s">Set up a Mate to review this pull request. <Link to="/assistants?new=1" className="font-medium text-accent underline">New mate</Link></Text>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label as="span" id={mateLabelId}>Mate</Label>
            <Select aria-labelledby={mateLabelId} value={eligible ? assistantId : ""} placeholder="Select a Mate"
              disabled={isLoading} onChange={setChosenMate} options={mates.map(mate => ({ value: mate.id, label: mate.name }))} />
          </div>
          {!existing && <label className="flex flex-col gap-1.5">
            <Label as="span">Review focus (optional)</Label>
            <Textarea value={focus} onChange={event => setFocus(event.target.value)} disabled={isLoading} maxLength={2000} rows={3} />
          </label>}
          {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
          <div className="flex justify-end">
            <Button variant="primary" type="submit" disabled={disabled || !eligible} isLoading={isLoading}>{existing ? "Open review" : "Start review"}</Button>
          </div>
        </>
      )}
    </form>
  );
}

export function PullRequestMateReviews({ pr, revision, selected }: {
  pr: PrRefInput;
  revision: PrRevision;
  selected?: { id: string; version: number };
}) {
  useAssistantUpdates();
  const navigate = useNavigate();
  const { currentData: account } = useGetAccountQuery();
  const { currentData: reviews, isError, refetch } = useAssistantPullRequestReviewsQuery(
    { accountId: account?.id ?? "", pr, selectedId: selected?.id }, { skip: !account },
  );
  const { currentData: overview } = useAssistantOverviewQuery(account?.id ?? "", { skip: !account || !reviews?.length });
  const selection = useRef<HTMLLIElement>(null);
  const hasSelection = !!selected && !!reviews?.some(review => review.assignment.id === selected.id);
  useLayoutEffect(() => { if (hasSelection) selection.current?.focus(); }, [hasSelection, selected]);

  if (isError && !reviews?.length) return <Button variant="secondary" onClick={() => void refetch()}>Retry loading Mate reviews</Button>;
  if (!reviews?.length) return selected && <p role="status" className="text-sm text-primary-500">Loading Mate review…</p>;
  return (
    <section aria-label="Mate reviews" className="space-y-2">
      <h3 className="text-sm font-medium">Mate reviews</h3>
      {isError && <Button variant="secondary" onClick={() => void refetch()}>Refresh Mate reviews</Button>}
      <ul className="space-y-3">
        {reviews.map(({ assignment, revision: reviewed, truncated }, index) => {
          const chosen = selected?.id === assignment.id;
          return (
            <li key={chosen ? `${assignment.id}:${selected.version}` : assignment.id} ref={chosen ? selection : undefined} tabIndex={chosen ? -1 : undefined}>
              <p className="mb-1 px-1 text-xs text-primary-600 dark:text-primary-400">
                Commit <code>{reviewed.headOid.slice(0, 7)}</code> · Base <code>{reviewed.baseOid.slice(0, 7)}</code>
                {!samePrRevision(reviewed, revision) && " · Previous revision"}
                {truncated && " · Partial diff"}
              </p>
              <AssistantAssignmentCard task={assignment} assignee={overview?.assistants.find(mate => mate.id === assignment.toAssistantId)}
                openAssistant={(id, runId) => navigate(assistantHref(id, runId))} initiallyExpanded={chosen || index === 0} showBrief={false} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
