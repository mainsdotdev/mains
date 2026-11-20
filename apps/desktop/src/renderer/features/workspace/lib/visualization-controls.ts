import type { VisualizationControls } from "@mains/contracts/visualization";

export function visualizationEdits(controls: VisualizationControls) {
  return controls.groups.flatMap((group) => group.controls
    .filter((control) => control.value !== control.initialValue)
    .map((control) => ({ group, control })));
}

export function visualizationDesignPrompt(absPath: string, controls: VisualizationControls): string | null {
  const edits = visualizationEdits(controls);
  if (!edits.length) return null;
  const prompt = ["Apply these design changes to the visualization:", `File: ${absPath}`,
    ...edits.map(({ group, control }) => `- ${group.variant ? `[${group.variant}] ` : ""}${group.label}: ${control.label}${control.reference ? ` (${control.reference})` : ""}: ${JSON.stringify(control.initialValue)} → ${JSON.stringify(control.value)}`),
  ].join("\n");
  return prompt.length <= 20_000 ? prompt : null;
}
