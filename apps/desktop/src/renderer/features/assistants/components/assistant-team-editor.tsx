import { useEffect, useRef, useState } from "react";
import type { AssistantTeam } from "@mains/contracts/assistants";
import { Button, Input, Label } from "@/components/ui";
import { useCreateAssistantTeamMutation } from "@/lib/redux/api/assistantsApi";
import { errorText } from "../lib/assistant-ui";

export function AssistantTeamEditor({ accountId, inline = false, onCreated, onCancel }: {
  accountId: string;
  inline?: boolean;
  onCreated(team: AssistantTeam): void;
  onCancel(): void;
}) {
  const [createTeam, { isLoading }] = useCreateAssistantTeamMutation();
  const [name, setName] = useState("");
  const [failure, setFailure] = useState("");
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function save() {
    const teamName = name.trim();
    if (!teamName || sending.current) return;
    sending.current = true;
    setFailure("");
    try {
      const team = await createTeam({ accountId, name: teamName }).unwrap();
      if (mounted.current) onCreated(team);
    } catch (error) {
      if (mounted.current) setFailure(errorText(error));
    } finally {
      sending.current = false;
    }
  }

  return <section aria-label="Create team" className={inline
    ? "mt-3 space-y-3.5 border-t border-primary-200/70 pt-3 dark:border-primary-800/60"
    : "glass-card space-y-4 rounded-2xl p-4"}>
    <label className={`flex flex-col ${inline ? "gap-1.5" : "gap-2.5"}`}>
      <Label as="span">Team name</Label>
      <Input value={name} maxLength={100} autoFocus autoComplete="off" placeholder="e.g. Release team" disabled={isLoading}
        onChange={event => setName(event.target.value)} onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void save();
          }
        }} />
    </label>
    {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" disabled={isLoading} onClick={onCancel}>Cancel team</Button>
      <Button type="button" variant="primary" isLoading={isLoading} disabled={!name.trim()} onClick={() => void save()}>Create team</Button>
    </div>
  </section>;
}
