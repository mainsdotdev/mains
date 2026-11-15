import { useGetAccountQuery } from "@/lib/redux/api/accountApi";
import { useAssistantOverviewQuery } from "@/lib/redux/api/assistantsApi";
import { AssistantAvatar, assistantAvatarColor } from "./assistant-avatar";

/** Resolve saved mentions by identity so older messages share the assistant's appearance. */
export function AssistantMention({ id, name }: { id: string; name: string }) {
  const { data: account } = useGetAccountQuery();
  const { currentData: overview } = useAssistantOverviewQuery(account?.id ?? "", { skip: !account });
  const assistant = overview?.assistants.find(item => item.id === id && item.accountId === account?.id);
  return <span title={name} className="inline-flex align-middle items-center gap-1 mb-0.5 h-6 mx-0.5 rounded-lg text-s font-medium leading-none select-none cursor-default" style={{ color: assistantAvatarColor(assistant?.avatar) }}>
    <AssistantAvatar avatar={assistant?.avatar} className="size-3.5" />
    <span className="leading-none">{name}</span>
  </span>;
}
