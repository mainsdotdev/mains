import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MAX_MATE_SKILLS, type Assistant, type AssistantSkill, type AssistantSkillDraft } from "@mains/contracts/assistants";
import { Button, Input, Modal, ModalHeader, Select, Textarea } from "@/components/ui";
import { Import, Maximize, Minimize, Plus, Skill, Sparkles } from "@/components/ui/icons";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { useAssistantSkillCatalogQuery, useGenerateAssistantSkillMutation, useSaveAssistantSkillMutation, useUpdateAssistantProfileMutation } from "@/lib/redux/api/assistantsApi";
import { errorText } from "../lib/assistant-ui";
import { AssistantSkillList, UnavailableAssistantSkills } from "./assistant-skill-list";

const SKILLS_VIEW_TRANSITION_NAME = "mate-skills";
const emptyDraft: AssistantSkillDraft = { name: "", title: "", description: "", markdown: "" };

interface SkillsViewTransition {
  finished: Promise<void>;
  skipTransition(): void;
}

export function AssistantSkillsFields({ assistant, selectedIds, editingProfile, canManage, disabled, onChange }: {
  assistant: Assistant;
  selectedIds: string[];
  editingProfile: boolean;
  canManage: boolean;
  disabled: boolean;
  onChange(ids: string[]): void;
}) {
  const identity = { accountId: assistant.accountId, id: assistant.id };
  const catalog = useAssistantSkillCatalogQuery({ ...identity, providerId: assistant.providerId }, { skip: assistant.isArchived, refetchOnMountOrArgChange: true });
  const [generate, { isLoading: generating }] = useGenerateAssistantSkillMutation();
  const [save, { isLoading: saving }] = useSaveAssistantSkillMutation();
  const [updateProfile, { isLoading: savingSelection }] = useUpdateAssistantProfileMutation();
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<{ ids: string[]; expectedIds: string[] } | null>(null);
  const [created, setCreated] = useState<AssistantSkill[]>([]);
  const [draft, setDraft] = useState<AssistantSkillDraft | null>(null);
  const [prompt, setPrompt] = useState("");
  const [failure, setFailure] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const viewTransition = useRef<SkillsViewTransition | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  // Declare the optional browser API for editors with older DOM typings.
  const transitionDocument = document as Document & {
    startViewTransition?: (update: () => void) => SkillsViewTransition;
  };
  const startViewTransition = !reducedMotion && typeof transitionDocument.startViewTransition === "function"
    ? transitionDocument.startViewTransition
    : undefined;
  const busy = disabled || generating || saving || savingSelection;

  useEffect(() => () => viewTransition.current?.skipTransition(), []);

  const available = new Map([...(catalog.currentData?.skills ?? []), ...created].map(skill => [skill.id, skill]));
  const saved = new Map((assistant.skills ?? []).map(skill => [skill.id, skill]));
  const pluginSkillIds = new Set(catalog.currentData?.pluginSkillIds ?? []);
  const count = selectedIds.filter(id => !pluginSkillIds.has(id)).length;
  const localSelection = (selection?.ids ?? selectedIds).filter(id => !pluginSkillIds.has(id));
  const selected = localSelection.flatMap(id => {
    const skill = available.get(id) ?? saved.get(id);
    return skill ? [skill] : [];
  });
  const inactive = (skill: AssistantSkill) => !!catalog.currentData && !catalog.error && !available.has(skill.id);
  const activeSkills = selected.filter(skill => !inactive(skill));
  const unavailableSkills = selected.filter(inactive);
  const choices = [...available.values()].filter(skill => !localSelection.includes(skill.id));
  const full = localSelection.length >= MAX_MATE_SKILLS;

  function moveSkills(open: boolean, clearSelection = false) {
    viewTransition.current?.skipTransition();
    const update = () => {
      if (clearSelection) setSelection(null);
      setExpanded(open);
    };
    if (!startViewTransition) {
      update();
      return;
    }
    const transition = startViewTransition.call(document, () => flushSync(update));
    viewTransition.current = transition;
    const finish = () => {
      if (viewTransition.current === transition) viewTransition.current = null;
    };
    void transition.finished.then(finish, finish);
  }

  function changeSelection(ids: string[]) {
    if (editingProfile) onChange(ids);
    else setSelection(current => {
      const expectedIds = current?.expectedIds ?? selectedIds;
      return JSON.stringify(ids) === JSON.stringify(expectedIds) ? null : { ids, expectedIds };
    });
    setFailure("");
  }

  async function saveSelection() {
    if (!canManage || busy || !selection) return;
    setFailure("");
    const { name, description, instructions, avatar } = assistant;
    const profile = { name, description, instructions, avatar };
    try {
      await updateProfile({ ...identity, profile, expectedProfile: profile, skillChange: selection }).unwrap();
      moveSkills(false, true);
    } catch (error) {
      setFailure(errorText(error));
    }
  }

  async function generateDraft() {
    setFailure("");
    try { setDraft(await generate({ ...identity, request: prompt.trim() }).unwrap()); }
    catch (error) { setFailure(errorText(error)); }
  }

  async function saveDraft(input: { draft: AssistantSkillDraft } | { document: string }) {
    setFailure("");
    try {
      const skill = await save({ ...identity, input }).unwrap();
      setCreated(current => [...current.filter(entry => entry.id !== skill.id), skill]);
      if (!localSelection.includes(skill.id)) changeSelection([...localSelection, skill.id]);
      setDraft(null);
      setPrompt("");
    } catch (error) { setFailure(errorText(error)); }
  }

  function startDraft() {
    setFailure("");
    setDraft(emptyDraft);
  }

  function removeSkill(id: string) {
    changeSelection(localSelection.filter(selectedId => selectedId !== id));
  }

  const minimize = () => { if (!savingSelection) moveSkills(false); };

  return <>
    <section aria-label="Skills" className={`flex items-center gap-2 rounded-2xl glass-card p-3.5 text-sm ${expanded ? "invisible" : ""}`}
      style={{ viewTransitionName: expanded ? undefined : SKILLS_VIEW_TRANSITION_NAME }}>
      <h3 className="mr-auto font-semibold text-primary-950 dark:text-primary-50">Skills</h3>
      <span className="tabular-nums text-primary-600 dark:text-primary-300">{count}<span className="sr-only"> assigned</span></span>
      <Button type="button" ref={expandButton} variant="icon" iconSize="sm" aria-label="Expand Skills"
        aria-haspopup="dialog" disabled={disabled} tooltip="Expand Skills" tooltipPosition="top-left" onClick={() => moveSkills(true)}>
        <Maximize aria-hidden="true" className="size-4" />
      </Button>
    </section>
    <Modal isOpen={expanded} onClose={minimize} returnFocusRef={expandButton} aria-label="Skills"
      motion={startViewTransition || reducedMotion ? "none" : "command"} viewTransitionName={SKILLS_VIEW_TRANSITION_NAME}
      className="h-[min(38rem,calc(100dvh-3rem))] w-full max-w-2xl text-primary-900 dark:text-primary-100">
      <ModalHeader onClose={minimize} closeIcon={<Minimize aria-hidden="true" className="size-4.5 text-primary-500" />} closeLabel="Minimize Skills">
        <h3 className="font-medium text-primary-950 dark:text-primary-50">Skills</h3>
      </ModalHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pt-1 pb-5 text-sm">
        <div className="glass-card space-y-4 rounded-2xl p-4">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <h4 className="min-w-0 wrap-break-word font-semibold">{assistant.name} Skills</h4>
            {canManage && activeSkills.length > 0 && !draft && <Button variant="secondary" className="shrink-0" disabled={busy || full}
              leftIcon={<Plus aria-hidden="true" className="size-3.5" />} onClick={startDraft}>New skill</Button>}
          </div>
          {canManage && <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-[1_1_16rem]">
              <Select searchable size="s" aria-label="Add skills" value="" placeholder="Add from library" searchPlaceholder="Search skills"
                disabled={busy || full} onChange={id => { if (id) changeSelection([...localSelection, id]); }}
                options={choices.map(skill => ({
                  value: skill.id, label: skill.name, description: skill.description,
                  icon: <Skill aria-hidden="true" className="mr-1 size-4 shrink-0 text-primary-500" />,
                }))}
                emptyMessage={catalog.isFetching ? "Loading skills…" : "No additional skills"} />
            </div>
            <Button variant="ghost" disabled={busy || full} onClick={() => fileInput.current?.click()}
              leftIcon={<Import aria-hidden="true" className="size-4" />}>Import SKILL.md</Button>
            <Input ref={fileInput} type="file" accept=".md,text/markdown" hidden onChange={async event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              if (file.size > 64 * 1024) { setFailure("Choose a SKILL.md file up to 64 KB."); return; }
              try { await saveDraft({ document: await file.text() }); }
              catch (error) { setFailure(errorText(error)); }
            }} />
          </div>}
          {canManage && !!catalog.error && <div className="flex items-center justify-between gap-2 text-xs">
            <span role="status">Couldn’t load the skill catalog.</span>
            <Button variant="ghost" disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>Retry</Button>
          </div>}
          {canManage && draft && <div className="space-y-3 rounded-xl bg-primary-950/5 p-3 dark:bg-primary/5">
            <label className="flex flex-col gap-2">
              <span className="font-medium ">Skill workflow</span>
              <Textarea autoFocus placeholder="Describe what this skill should do" rows={2} maxLength={8000}
                value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} />
            </label>
            <div className="flex justify-end">
              <Button variant="primary" disabled={busy || !prompt.trim()} isLoading={generating}
                leftIcon={<Sparkles aria-hidden="true" className="size-3.5" />} onClick={() => void generateDraft()}>Generate draft</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="Skill title" placeholder="Title" value={draft.title} maxLength={100} disabled={busy}
                onChange={event => setDraft({ ...draft, title: event.target.value })} />
              <Input aria-label="Skill name" placeholder="skill-name" value={draft.name} maxLength={64} disabled={busy}
                onChange={event => setDraft({ ...draft, name: event.target.value })} />
            </div>
            <Input aria-label="Skill description" placeholder="When to use this skill" value={draft.description} maxLength={1024} disabled={busy}
              onChange={event => setDraft({ ...draft, description: event.target.value })} />
            <Textarea aria-label="Skill Markdown" placeholder="Workflow instructions in Markdown" value={draft.markdown} rows={6} maxLength={65536}
              disabled={busy} onChange={event => setDraft({ ...draft, markdown: event.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => { setDraft(null); setPrompt(""); setFailure(""); }}>Cancel</Button>
              <Button variant="secondary" disabled={busy || full || ![draft.name, draft.title, draft.description, draft.markdown].every(field => field.trim())}
                isLoading={saving} onClick={() => void saveDraft({ draft })}>Save skill</Button>
            </div>
          </div>}
          {activeSkills.length > 0 ? <AssistantSkillList skills={activeSkills} disabled={busy} onRemove={canManage ? removeSkill : undefined} />
            : (!draft || !canManage) && <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-primary-950/10 px-4 py-6 text-center dark:border-primary/12">
              <div className="grid size-11 place-items-center rounded-full bg-primary-950/6 text-primary-600 dark:bg-primary/8 dark:text-primary-300">
                <Skill aria-hidden="true" className="size-5" />
              </div>
              <p className="font-medium">{unavailableSkills.length > 0 ? "No active skills" : "No skills assigned"}</p>
              {canManage && <Button variant="secondary" disabled={busy || full} leftIcon={<Sparkles aria-hidden="true" className="size-3.5" />}
                onClick={startDraft}>Create with Mains</Button>}
            </div>}
        </div>
        {unavailableSkills.length > 0 && <UnavailableAssistantSkills skills={unavailableSkills} disabled={busy} onRemove={canManage ? removeSkill : undefined} />}
        {!!failure && <p role="alert" className="text-xs text-danger">{failure}</p>}
      </div>
      {canManage && selection && <div className="flex shrink-0 justify-end gap-2 border-t border-primary-200/70 px-6 py-4 dark:border-primary-800/60">
        <Button variant="ghost" disabled={busy} onClick={() => { setFailure(""); moveSkills(false, true); }}>Discard changes</Button>
        <Button variant="primary" disabled={busy} isLoading={savingSelection} onClick={() => void saveSelection()}>Save changes</Button>
      </div>}
    </Modal>
  </>;
}
