import { useGetAccountQuery } from "@/lib/redux/api";
import { useSaveToAtlasMutation } from "@/lib/redux/api/atlasApi";
import { toast } from "@/components/ui";

export function atlasError(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "error" in error) return String(error.error);
  return "Atlas could not complete this action. Please try again.";
}
/** One action shared by the conversation cards and Atlas generated views. */
export function useSaveToAtlas() {
  const { data: account } = useGetAccountQuery();
  const [save, state] = useSaveToAtlasMutation();
  return {
    saving: state.isLoading,
    save: async (runId: string, path: string) => {
      if (!account) return undefined;
      try {
        const item = await save({ accountId: account.id, runId, path }).unwrap();
        toast.success("Saved to Atlas");
        return item;
      } catch (error) { toast.error(atlasError(error)); return undefined; }
    },
  };
}
