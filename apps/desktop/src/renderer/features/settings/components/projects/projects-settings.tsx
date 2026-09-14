import { useSearchParams } from "react-router-dom";
import { Muted } from "@/components/ui";
import ProjectDetail from "./project-detail";

export default function ProjectsSettings() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get("id");

  if (id) {
    return <ProjectDetail id={id} />;
  }

  return (
    <div className="py-12 text-center">
      <Muted>Select a project from the sidebar.</Muted>
    </div>
  );
}
