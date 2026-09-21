/**
 * Cross-process subagent constants — knowledge both the Claude driver (main)
 * and the renderer's identity utilities need, kept here so the two sides of
 * the process boundary cannot drift.
 */

/**
 * The Claude SDK's continuation handle as it appears in an Agent tool_result
 * ("agentId: a2e1… (use SendMessage with to: 'a2e1…' …)"). The driver
 * extracts it into `metadata.subagent.agentId` at persist time; the renderer
 * keeps the regex as a fallback for rows persisted before that extraction
 * existed. No `g` flag on purpose — `.test()`/`.match()` stay stateless.
 */
export const AGENT_ID_IN_RESULT = /agentId:\s*([a-f0-9-]+)/i;
