export const VISUALIZATION_FOLLOW_UP_EVENT =
  "mains:visualization-follow-up";

export interface VisualizationFollowUpDetail {
  prompt: string;
  title?: string;
}

export function requestVisualizationFollowUp(
  detail: VisualizationFollowUpDetail,
): void {
  window.dispatchEvent(
    new CustomEvent<VisualizationFollowUpDetail>(
      VISUALIZATION_FOLLOW_UP_EVENT,
      { detail },
    ),
  );
}
