import { clearPlanDecisions } from "./plan-decision-lifecycle";
import { closeApprovalRequests, openApprovalRequests } from "./user-input-broker";
import { openAsyncAnswers, shutdownAsyncAnswers } from "./async-answer-lifecycle";
export function openUserDecisions(): void { openAsyncAnswers(); openApprovalRequests(); }
export function shutdownUserDecisions(): Promise<void> { closeApprovalRequests(); return shutdownAsyncAnswers().then(clearPlanDecisions); }
