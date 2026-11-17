import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ASSISTANT_AVATAR_COLORS, ASSISTANT_AVATAR_SHAPES, type AssistantAvatar as Avatar, type AssistantTeam } from "@mains/contracts/assistants";
import type { EffortLevel } from "@mains/contracts/effort-levels";
import { useGetSpacesQuery, useGetProviderModelsQuery } from "@/lib/redux/api";
import { useAssistantOverviewQuery, useCreateAssistantMutation, useCreateAssistantTeamMutation } from "@/lib/redux/api/assistantsApi";
import { Button, Input, Label, Textarea, Select, ModelSelectDropdown } from "@/components/ui";
import { AssistantAvatar, AVATAR_COLORS } from "./assistant-avatar";
import { errorText } from "../lib/assistant-ui";
import { AVATAR_SHAPE_LABELS } from "../lib/assistant-particles";

export function AssistantProfileForm({ accountId, onCreated, onClose }: {
  accountId: string; onCreated(id: string): void; onClose(): void;
}) {
  const { data: spaces = [] } = useGetSpacesQuery();
  const [providerId, setProviderId] = useState("codex");
  const available = spaces.filter(s => s.providerId === providerId && s.accountId === accountId && !s.isArchived);
  const space = available.find(s => s.id === (providerId === "claude_code" ? "claude" : providerId)) ?? available[0];
  const { currentData: models = [], isFetching, error: catalogError } = useGetProviderModelsQuery(providerId);
  const [modelId, setModelId] = useState("");
  const model = models.find(m => m.id === modelId) ?? models[0];
  const efforts = model?.supportedEffortLevels ?? [];
  const [effortChoice, setEffortChoice] = useState("medium");
  const [thinking, setThinking] = useState(true);
  const effort = thinking ? efforts.includes(effortChoice) ? effortChoice : efforts[0] ?? "" : "";
  const [avatar, setAvatar] = useState<Avatar>({ shape: "sphere", color: "blue" });
  const [name, setName] = useState(""), [description, setDescription] = useState(""), [instructions, setInstructions] = useState("");
  const [failure, setFailure] = useState("");
  const [create, creation] = useCreateAssistantMutation();
  const { currentData: overview, isFetching: fetchingTeams, error: teamsError, refetch: refetchTeams } = useAssistantOverviewQuery(accountId);
  const [createTeam, teamCreation] = useCreateAssistantTeamMutation();
  const [createdTeams, setCreatedTeams] = useState<AssistantTeam[]>([]);
  const [teamChoice, setTeamChoice] = useState<string | null>(null);
  const [teamEditorOpen, setTeamEditorOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamFailure, setTeamFailure] = useState("");
  const teamLabelId = useId();
  const teamSending = useRef(false);
  const teams = [...new Map([...(overview?.teams ?? []), ...createdTeams]
    .filter(team => team.accountId === accountId).map(team => [team.id, team])).values()];
  const selectedTeam = teamChoice === null ? teams.find(team => team.name === "Mains") ?? teams[0] : teams.find(team => team.id === teamChoice);
  const loadingTeams = !!fetchingTeams && !overview;
  const unavailableTeams = !!teamsError && !overview;
  const missingTeamChoice = teamChoice !== null && !selectedTeam;
  const teamOptions = teams.length ? teams.map(team => ({ value: team.id, label: team.name }))
    : loadingTeams || unavailableTeams ? [] : [{ value: "", label: "Mains" }];
  const [modelMenu, setModelMenu] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const names = models.map(m => m.displayName || m.id);
  const modelName = model?.displayName || model?.id || "Choose a model";
  const levels = Object.fromEntries(models.map(m => [m.displayName || m.id, m.supportedEffortLevels as EffortLevel[] | undefined]));
  async function saveTeam() {
    const name = teamName.trim();
    if (!name || teamSending.current || creation.isLoading) return;
    teamSending.current = true;
    setTeamFailure("");
    try {
      const team = await createTeam({ accountId, name }).unwrap();
      if (!mounted.current) return;
      setCreatedTeams(current => [...current.filter(value => value.id !== team.id), team]);
      setTeamChoice(team.id);
      setTeamEditorOpen(false);
      setTeamName("");
    } catch (error) { if (mounted.current) setTeamFailure(errorText(error)); }
    finally { teamSending.current = false; }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!space || !model || sending.current || teamEditorOpen || teamSending.current || loadingTeams || unavailableTeams || missingTeamChoice) return;
    sending.current = true;
    setFailure("");
    try {
      const result = await create({ accountId, ...(selectedTeam ? { teamId: selectedTeam.id } : {}), spaceId: space.id, name: name.trim(), description: description.trim(), instructions: instructions.trim(), model: model.id, effort, avatar }).unwrap();
      if (mounted.current) onCreated(result.id);
    } catch (error) { if (mounted.current) setFailure(errorText(error)); }
    finally { sending.current = false; }
  }
  return <form onSubmit={submit} aria-label="Create assistant" className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-8 text-primary-900 sm:py-12 dark:text-primary-100">
    <div className="flex items-center justify-between gap-4"><h1 className="text-xl font-medium text-primary-950 dark:text-primary-50">New assistant</h1><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></div>
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-4 pb-2 pt-1">
        <AssistantAvatar avatar={avatar} detail="full" seed="creation-preview" className="size-24" />
        <div role="radiogroup" aria-label="Avatar shape" onKeyDown={event => cycleAvatar(event, ASSISTANT_AVATAR_SHAPES, avatar.shape, shape => setAvatar({ ...avatar, shape }))} className="grid w-full max-w-sm grid-cols-3 gap-1 sm:grid-cols-6">
          {ASSISTANT_AVATAR_SHAPES.map(shape => <Button key={shape} type="button" variant={avatar.shape === shape ? "subtle" : "ghost"} role="radio" tabIndex={avatar.shape === shape ? 0 : -1} aria-checked={avatar.shape === shape} onClick={() => setAvatar({ ...avatar, shape })} className="flex-col gap-1 px-2 py-2 text-xs">
            <AssistantAvatar avatar={{ ...avatar, shape }} animated={false} className="size-7" /><span>{AVATAR_SHAPE_LABELS[shape]}</span>
          </Button>)}
        </div>
        <div role="radiogroup" aria-label="Avatar color" onKeyDown={event => cycleAvatar(event, ASSISTANT_AVATAR_COLORS, avatar.color, color => setAvatar({ ...avatar, color }))} className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          {ASSISTANT_AVATAR_COLORS.map(color => <Button key={color} type="button" variant="bare" role="radio" tabIndex={avatar.color === color ? 0 : -1} aria-label={AVATAR_COLORS[color].label} aria-checked={avatar.color === color} onClick={() => setAvatar({ ...avatar, color })}
            className={`flex size-7 items-center justify-center rounded-full outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent ${avatar.color === color ? "ring-2 ring-accent ring-offset-3 ring-offset-primary dark:ring-offset-primary-950" : "hover:scale-110"}`} style={{ backgroundColor: AVATAR_COLORS[color].fill }} />)}
        </div>
      </div>
      <label className="flex flex-col gap-2.5 text-sm"><span>Name</span><Input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="TestFlight" autoComplete="off" /></label>
      <label className="flex flex-col gap-2.5 text-sm"><span>What should this assistant help with?</span><Input required maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Check builds and prepare TestFlight releases" /></label>
      <label className="flex flex-col gap-2.5 text-sm"><span>Instructions</span><Textarea required maxLength={16000} value={instructions} onChange={e => setInstructions(e.target.value)} className="min-h-28 resize-y rounded-2xl" placeholder="How should it work, and what should it check before reporting back?" /></label>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <Label as="span" id={teamLabelId}>Team</Label>
          <Button type="button" variant="ghost" disabled={teamEditorOpen || loadingTeams || creation.isLoading} onClick={() => { setTeamEditorOpen(true); setTeamFailure(""); setModelMenu(false); }}>New team</Button>
        </div>
        <Select aria-labelledby={teamLabelId} size="sm" searchable value={selectedTeam?.id ?? ""} options={teamOptions}
          placeholder={loadingTeams ? "Loading teams…" : "Choose a team"} disabled={loadingTeams || teamEditorOpen || creation.isLoading}
          onChange={value => setTeamChoice(value || null)} />
        {!!teamsError && <div role="alert" className="flex items-center gap-2 text-sm text-danger"><span>{errorText(teamsError)}</span><Button type="button" variant="ghost" onClick={() => void refetchTeams()}>Retry teams</Button></div>}
        {teamEditorOpen && <section aria-label="Create team" className="glass-card space-y-4 rounded-2xl p-4">
          <label className="flex flex-col gap-2.5">
            <Label as="span">Team name</Label>
            <Input value={teamName} maxLength={100} autoFocus autoComplete="off" placeholder="e.g. Mains releases" disabled={teamCreation.isLoading}
              onChange={event => setTeamName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void saveTeam(); } }} />
          </label>
          {teamFailure && <p role="alert" className="text-sm text-danger">{teamFailure}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={teamCreation.isLoading} onClick={() => { setTeamEditorOpen(false); setTeamName(""); setTeamFailure(""); }}>Cancel team</Button>
            <Button type="button" variant="primary" isLoading={teamCreation.isLoading} disabled={!teamName.trim()} onClick={() => void saveTeam()}>Create team</Button>
          </div>
        </section>}
      </div>
      <div className="glass-outline space-y-3 rounded-2xl p-4">
        <div className="flex items-center justify-between gap-4"><span className="text-sm">Provider</span><Select aria-label="Assistant provider" value={providerId} onChange={value => { setProviderId(value); setModelId(""); setModelMenu(false); }} options={[{ value: "codex", label: "Codex" }, { value: "claude_code", label: "Claude" }]} size="sm" /></div>
        <div className="flex items-center justify-between gap-3"><span className="shrink-0 text-sm">Model & effort</span><ModelSelectDropdown model={modelName} models={names} modelEffortLevelsByModel={levels} onModelChange={value => setModelId(models.find(m => (m.displayName || m.id) === value)?.id ?? "")}
          thinkingMode={!!effort} effortLevel={effort} onEffortLevelChange={value => { setEffortChoice(value); setThinking(true); }} onThinkingModeToggle={() => setThinking(!thinking)} allowUltracode={false} openUpward maxMenuHeight={224} isOpen={modelMenu} onToggle={() => setModelMenu(!modelMenu)} onClose={() => setModelMenu(false)} dropdownRef={modelRef} isLoading={isFetching} variant={providerId === "codex" ? "codex" : "claude"} /></div>
      </div>
      {!!(failure || catalogError || !space) && <p role="alert" className="text-sm text-danger">{failure || (catalogError ? errorText(catalogError) : "Enable this provider to create an assistant.")}</p>}
    </div>
    <div className="pt-1"><Button variant="submit" fullWidth type="submit" disabled={creation.isLoading || isFetching || !space || !model || loadingTeams || unavailableTeams || missingTeamChoice || teamEditorOpen}>{creation.isLoading ? "Creating…" : "Create assistant"}</Button></div>
  </form>;
}

function cycleAvatar<T extends string>(event: KeyboardEvent<HTMLDivElement>, values: readonly T[], value: T, choose: (value: T) => void) {
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (!step && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const index = event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : (values.indexOf(value) + step + values.length) % values.length;
  choose(values[index]);
  event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
}
