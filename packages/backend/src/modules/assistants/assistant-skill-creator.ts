export const MATE_SKILL_CREATOR_ID = "mains-skill-creator";

// Bundled with the backend so the same guide is available in desktop and server builds.
export const MATE_SKILL_CREATOR = `---
name: mains-skill-creator
description: Write a reusable SKILL.md when the user asks to save a workflow as a skill.
---

# Create a skill

Clarify the intended outcome and when the skill should apply. Ask about missing details only if they change the workflow. Check assigned skill names for duplicates.

- Choose a short lowercase hyphenated name, a readable title, and a description that says when to use the skill.
- Write a self-contained Markdown workflow with useful decision rules, genuine constraints, and a way to verify the result. Preserve the user's scope and explicit requirements.
- Treat an app, website, or tool as a preference unless the workflow truly requires it. Prefer the named source when available. Otherwise use another suitable authorized source, identify the source actually used, and report anything you could not verify. A citation link is not a tool dependency.
- Use one Markdown document. Include only the details that help the Mate repeat the workflow. Never include credentials or treat a saved workflow as authorization for external actions.
- In chat, call CreateAssistantSkill with the draft after the user asks to create a skill. Confirm the saved skill after the tool returns successfully.
`;
