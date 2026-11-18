import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { DEFAULT_ASSISTANT_AVATAR, type AssistantAvatar as Avatar, type AssistantTeam } from "@mains/contracts/assistants";
import type { EffortLevel } from "@mains/contracts/effort-levels";
import { useGetSpacesQuery, useGetProviderModelsQuery, useGetProvidersQuery } from "@/lib/redux/api";
import { useAssistantOverviewQuery, useCreateAssistantMutation } from "@/lib/redux/api/assistantsApi";
import { Button, Input, Label, Select, ModelSelectDropdown } from "@/components/ui";
import { AssistantAvatarPicker } from "./assistant-avatar-picker";
import { AssistantCreationHeader } from "./assistant-profile-header";
import { AssistantTeamEditor } from "./assistant-team-editor";
import { errorText } from "../lib/assistant-ui";

export function AssistantProfileForm({ accountId, onCreated, onClose }: {
  accountId: string; onCreated(id: string): void; onClose(): void;
}) {
  const { data: spaces = [] } = useGetSpacesQuery();
  const { data: providers, isLoading: loadingProviders } = useGetProvidersQuery();
  const [providerChoice, setProviderId] = useState<string>();
  const accountSpaces = spaces.filter(s => s.accountId === accountId && !s.isArchived);
  const hasProvider = (id: string) => accountSpaces.some(s => s.providerId === id) &&
    (!providers || providers.some(provider => provider.id === id && provider.isEnabled));
  const providerId = providerChoice ?? (!hasProvider("codex") && hasProvider("claude_code") ? "claude_code" : "codex");
  const availableProvider = hasProvider(providerId);
  const available = accountSpaces.filter(s => s.providerId === providerId);
  const space = available.find(s => s.id === (providerId === "claude_code" ? "claude" : providerId)) ?? available[0];
  const { currentData: models = [], isFetching, error: catalogError } = useGetProviderModelsQuery(providerId, { skip: loadingProviders || !availableProvider });
  const [modelId, setModelId] = useState("");
  const model = models.find(m => m.id === modelId) ?? models[0];
  const efforts = model?.supportedEffortLevels ?? [];
  const [effortChoice, setEffortChoice] = useState("medium");
  const [thinking, setThinking] = useState(true);
  const effort = thinking ? efforts.includes(effortChoice) ? effortChoice : efforts[0] ?? "" : "";
  const [avatar, setAvatar] = useState<Avatar>(DEFAULT_ASSISTANT_AVATAR);
  const [name, setName] = useState("");
  const [failure, setFailure] = useState("");
  const [create, creation] = useCreateAssistantMutation();
  const { currentData: overview, isFetching: fetchingTeams, error: teamsError, refetch: refetchTeams } = useAssistantOverviewQuery(accountId);
  const [createdTeams, setCreatedTeams] = useState<AssistantTeam[]>([]);
  const [teamChoice, setTeamChoice] = useState("");
  const [teamEditorOpen, setTeamEditorOpen] = useState(false);
  const teamLabelId = useId();
  const teams = [...new Map([...(overview?.teams ?? []), ...createdTeams]
    .filter(team => team.accountId === accountId).map(team => [team.id, team])).values()];
  const loadingTeams = !!fetchingTeams && !overview;
  const missingTeam = !!teamChoice && !teams.some(team => team.id === teamChoice);
  const teamOptions = [{ value: "", label: "No team" }, ...teams.map(team => ({ value: team.id, label: team.name }))];
  const [modelMenu, setModelMenu] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const names = models.map(m => m.displayName || m.id);
  const modelName = model?.displayName || model?.id || "Choose a model";
  const levels = Object.fromEntries(models.map(m => [m.displayName || m.id, m.supportedEffortLevels as EffortLevel[] | undefined]));
  function onTeamCreated(team: AssistantTeam) {
    setCreatedTeams(current => [...current.filter(value => value.id !== team.id), team]);
    setTeamChoice(team.id);
    setTeamEditorOpen(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!space || !model || loadingProviders || !availableProvider || sending.current || teamEditorOpen || missingTeam) return;
    sending.current = true;
    setFailure("");
    try {
      const result = await create({ accountId, teamId: teamChoice || null, spaceId: space.id, name: name.trim(), profileSetup: true, model: model.id, effort, avatar }).unwrap();
      if (mounted.current) onCreated(result.id);
    } catch (error) { if (mounted.current) setFailure(errorText(error)); }
    finally { sending.current = false; }
  }
  return <form onSubmit={submit} aria-label="Create mate" className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-8 text-primary-900 sm:py-12 dark:text-primary-100">
    <AssistantCreationHeader name={name} avatar={avatar} onClose={onClose} />
    <div className="space-y-5">
      <AssistantAvatarPicker avatar={avatar} seed="creation-preview" onChange={setAvatar} />
      <label className="flex flex-col gap-2.5 text-sm"><span>Name</span><Input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Name your mate" autoComplete="off" /></label>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <Label as="span" id={teamLabelId}>Team</Label>
          <Button type="button" variant="primary" disabled={teamEditorOpen || loadingTeams || creation.isLoading} onClick={() => { setTeamEditorOpen(true); setModelMenu(false); }}>New team</Button>
        </div>
        <Select aria-labelledby={teamLabelId} searchable value={teamChoice} options={teamOptions}
          placeholder="Choose a team" disabled={teamEditorOpen || creation.isLoading} onChange={setTeamChoice} />
        {!!teamsError && <div role="alert" className="flex items-center gap-2 text-sm text-danger"><span>{errorText(teamsError)}</span><Button type="button" variant="ghost" onClick={() => void refetchTeams()}>Retry teams</Button></div>}
        {teamEditorOpen && <AssistantTeamEditor accountId={accountId} onCreated={onTeamCreated} onCancel={() => setTeamEditorOpen(false)} />}
      </div>
      <div className="glass-outline space-y-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"><span className="text-sm">Provider</span><Select aria-label="Mate provider" value={providerId} onChange={value => { setProviderId(value); setModelId(""); setModelMenu(false); }} options={[{ value: "codex", label: "Codex" }, { value: "claude_code", label: "Claude" }]} /></div>
        <div className="flex items-center justify-between gap-3"><span className="shrink-0 text-sm">Model & effort</span><ModelSelectDropdown model={modelName} models={names} modelEffortLevelsByModel={levels} onModelChange={value => setModelId(models.find(m => (m.displayName || m.id) === value)?.id ?? "")}
          thinkingMode={!!effort} effortLevel={effort} onEffortLevelChange={value => { setEffortChoice(value); setThinking(true); }} onThinkingModeToggle={() => setThinking(!thinking)} allowUltracode={false} openUpward maxMenuHeight={224} isOpen={modelMenu} onToggle={() => setModelMenu(!modelMenu)} onClose={() => setModelMenu(false)} dropdownRef={modelRef} isLoading={isFetching} variant={providerId === "codex" ? "codex" : "claude"} /></div>
      </div>
      {!!(failure || catalogError || !loadingProviders && !availableProvider) && <p role="alert" className="text-sm text-danger">{failure || (catalogError ? errorText(catalogError) : "Enable a provider to create a mate.")}</p>}
    </div>
    <div className="pt-1"><Button variant="submit" fullWidth type="submit" disabled={creation.isLoading || isFetching || loadingProviders || !availableProvider || !space || !model || missingTeam || teamEditorOpen}>{creation.isLoading ? "Creating…" : "Create mate"}</Button></div>
  </form>;
}
