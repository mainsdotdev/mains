import { Button } from "@/components/ui";
import type { ReviewDiffStyle } from "../lib/review-diff";

function DiffLayoutIcon({ split }: { split: boolean }) {
  return <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1" />
    {split ? <>
      <path d="M5 6h6v12H5z" className="fill-danger" opacity=".65" />
      <path d="M13 6h6v12h-6z" className="fill-success" opacity=".65" />
    </> : <>
      <path d="M5 6h14v5H5z" className="fill-danger" opacity=".65" />
      <path d="M5 13h14v5H5z" className="fill-success" opacity=".65" />
    </>}
  </svg>;
}

export function DiffLayoutToggle({ diffStyle, onStyleChange }: {
  diffStyle: ReviewDiffStyle;
  onStyleChange: (style: ReviewDiffStyle) => void;
}) {
  const split = diffStyle === "split";
  const label = split ? "Switch to unified diff" : "Switch to split diff";
  return (
    <Button variant="icon" type="button" aria-label={label} aria-pressed={split} tooltip={label}
      tooltipPosition="bottom-left" onClick={() => onStyleChange(split ? "unified" : "split")}>
      <DiffLayoutIcon split={split} />
    </Button>
  );
}
