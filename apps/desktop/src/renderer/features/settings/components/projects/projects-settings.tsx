import { useSearchParams } from "react-router-dom";
import { Muted } from "@/components/ui";
import { useActiveSpace } from "@/hooks/use-active-space";
import CollectionDetail from "./collection-detail";
import ProjectDetail from "./project-detail";

export default function ProjectsSettings() {
  const [searchParams] = useSearchParams();
  const { activeSpace } = useActiveSpace();
  const id = searchParams.get("id");
  const kind = searchParams.get("kind");

  if (id) {
    if (
      kind === "collection" ||
      (kind !== "code" && activeSpace?.mode !== "developer")
    ) {
      return <CollectionDetail id={id} />;
    }
    return <ProjectDetail id={id} />;
  }

  return (
    <div className="py-12 text-center">
      <Muted>Select a project from the sidebar.</Muted>
    </div>
  );
}
