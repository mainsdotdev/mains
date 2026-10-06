import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/components/ui";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { appApi } from "@/lib/transport";
import type { ContextSkill } from "../lib/composer-context";
import { composerSkillDestination } from "../lib/composer-mention";

export function useOpenComposerMention(skills: readonly ContextSkill[], providerId: string) {
  const navigate = useNavigate();
  const { open: openDocument } = useDocumentViewer();

  return useCallback(async (name: string) => {
    const skill = skills.find((entry) => entry.name === name);
    const destination = skill && composerSkillDestination(skill);
    if (!destination) return;
    if (destination.kind === "plugin") {
      const params = new URLSearchParams({ plugin: destination.pluginId, provider: providerId });
      navigate(`/plugins?${params}`);
      return;
    }
    try {
      const result = await appApi.fileExplorer.getPathInfo(destination.path);
      if (!result.success || !result.data.isFile) {
        toast.error("Skill file is unavailable");
        return;
      }
      openDocument({
        path: destination.path,
        fileName: destination.path.split(/[/\\]/).pop() || "SKILL.md",
        docType: "md",
      });
    } catch {
      toast.error("Unable to open skill file");
    }
  }, [skills, providerId, navigate, openDocument]);
}
