import type { ModeId } from "../../../shared/modes";

export type PulseTemplateCategory =
  | "status-reports"
  | "release-prep"
  | "incidents-triage"
  | "repo-hygiene"
  | "knowledge-work"
  | "planning"
  | "briefings"
  | "research";

export interface PulseTemplate {
  id: string;
  category: PulseTemplateCategory;
  title: string;
  /** One-line hint on the template card (picker UI). */
  description: string;
  /** Full instruction passed to the agent as the run goal. */
  prompt: string;
  emoji: string;
  /** Which experience modes offer this template. Absent = every mode. */
  modes?: ModeId[];
  defaultFrequency: "hourly" | "daily" | "weekdays" | "weekly";
  defaultHour: number;
  defaultMinute: number;
  defaultDayOfWeek?: number; // 0=Sun..6=Sat
}

export const PULSE_CATEGORIES: { id: PulseTemplateCategory; label: string }[] = [
  { id: "status-reports", label: "Standups & summaries" },
  { id: "release-prep", label: "Shipping & releases" },
  { id: "incidents-triage", label: "Risk & stability" },
  { id: "repo-hygiene", label: "Repo hygiene" },
  { id: "knowledge-work", label: "Docs & digests" },
  { id: "planning", label: "Planning & follow-through" },
  { id: "briefings", label: "Briefings" },
  { id: "research", label: "Reading & research" },
];

// The original template corpus is git/repo-centric — developer-only. Work and
// chat sets below run workspace-less (optionally against a collection's
// sources), so their prompts never reference git.
const DEVELOPER: ModeId[] = ["developer"];
const WORK: ModeId[] = ["work"];
const CHAT: ModeId[] = ["chat"];

export const PULSE_TEMPLATES: PulseTemplate[] = [
  // ── Standups & summaries (git-centric — reliable in Pulse)
  {
    id: "standup-summary",
    category: "status-reports",
    title: "Daily standup digest",
    description:
      "Yesterday’s commits, authors, and themes from git — formatted for standup.",
    prompt:
      "Use git history for this workspace. Summarize work useful for a daily standup: commits since yesterday (subjects, authors, touched areas). Call out anything that looks risky (large diffs, migrations, lockfile-only changes). Keep bullets short; no speculation beyond what git shows.",
    modes: DEVELOPER,
    emoji: "📰",
    defaultFrequency: "weekdays",
    defaultHour: 9,
    defaultMinute: 0,
  },
  {
    id: "weekly-update",
    category: "status-reports",
    title: "Weekly engineering update",
    description:
      "Narrative of the week from merges, churn, and notable repo changes.",
    prompt:
      "From git logs and repo state (last ~7 days), draft a weekly engineering update: shipped themes, recurring actors or modules, infra/tooling changes, and open risks. If conventional commits exist, lean on them; otherwise infer themes from messages and paths. End with 3 bullet \"asks\" or follow-ups grounded in the repo.",
    modes: DEVELOPER,
    emoji: "📝",
    defaultFrequency: "weekly",
    defaultHour: 17,
    defaultMinute: 0,
    defaultDayOfWeek: 5,
  },
  {
    id: "weekly-pr-digest",
    category: "status-reports",
    title: "Merge & integration digest",
    description:
      "What landed recently — grouped by area — plus carry-over risks.",
    prompt:
      "Review recent integration activity via git (merge commits or main-line history over ~7 days). Group changes by subsystem or top-level folder. Highlight regressions-prone zones (auth, billing, migrations, CI configs). Mention dependency or lockfile churn explicitly. Stay factual to git; note when something needs human CI/issue tracker context.",
    modes: DEVELOPER,
    emoji: "📒",
    defaultFrequency: "weekly",
    defaultHour: 9,
    defaultMinute: 0,
    defaultDayOfWeek: 1,
  },
  {
    id: "branch-tracking-brief",
    category: "status-reports",
    title: "Branch vs default brief",
    description:
      "How this workspace compares to its default upstream branch.",
    prompt:
      "Inspect git remotes/branches for this workspace. Summarize how the current branch relates to the default branch (ahead/behind if determinable locally, notable divergence). List files or dirs with the most churn vs default branch using git diff stats if available. Suggest a minimal merge/rebase or QA focus — reporting only unless the user expects edits.",
    modes: DEVELOPER,
    emoji: "🔀",
    defaultFrequency: "weekdays",
    defaultHour: 8,
    defaultMinute: 30,
  },

  // ── Shipping & releases
  {
    id: "release-notes",
    category: "release-prep",
    title: "Release notes draft",
    description:
      "User-facing notes from recent merges — ready to paste into changelog or GitHub.",
    prompt:
      "Draft release notes from recent merged work in git (since last tag if tags exist, otherwise last ~2 weeks). Group into Features, Fixes, Breaking changes, Internal. Use PR/commit titles when present; avoid inventing ticket URLs. Call out DB migrations, env vars, or config changes explicitly.",
    modes: DEVELOPER,
    emoji: "📕",
    defaultFrequency: "weekly",
    defaultHour: 10,
    defaultMinute: 0,
    defaultDayOfWeek: 5,
  },
  {
    id: "release-checklist",
    category: "release-prep",
    title: "Pre-release checklist",
    description:
      "Repo-grounded gates: migrations, versioning, flags, and smoke paths.",
    prompt:
      "Build a pre-release checklist grounded in this repository: locate changelog/release docs, migration folders (e.g. Drizzle/prisma), feature-flag patterns, version files (package.json, Cargo.toml, etc.). Mark each item verify/not-applicable. Include suggested smoke tests inferred from README or scripts — no promises about external CI dashboards.",
    modes: DEVELOPER,
    emoji: "✅",
    defaultFrequency: "weekly",
    defaultHour: 14,
    defaultMinute: 0,
    defaultDayOfWeek: 4,
  },
  {
    id: "changelog-update",
    category: "release-prep",
    title: "Changelog unreleased section",
    description:
      "Proposed CHANGELOG bullets aligned with conventional commits.",
    prompt:
      "Find CHANGELOG.md or similar. Propose new bullets for an [Unreleased] section based on git history since the last changelog header or tag. Follow the file’s existing style. Separate noteworthy vs internal-only lines; flag anything uncertain.",
    modes: DEVELOPER,
    emoji: "🟡",
    defaultFrequency: "weekly",
    defaultHour: 16,
    defaultMinute: 0,
    defaultDayOfWeek: 5,
  },
  {
    id: "migration-release-sync",
    category: "release-prep",
    title: "DB migrations vs schema sanity",
    description:
      "Cross-check migration files and schema hints before you ship.",
    prompt:
      "Scan for database migration folders and schema definitions (ORM configs, SQL migrations). Summarize pending migrations vs main branch if comparable. Flag risky patterns (data backfills, destructive drops, missing rollbacks). Do not apply migrations — analysis and checklist only.",
    modes: DEVELOPER,
    emoji: "🗄️",
    defaultFrequency: "weekly",
    defaultHour: 11,
    defaultMinute: 0,
    defaultDayOfWeek: 4,
  },

  // ── Risk & stability (repo files + git — no CI API)
  {
    id: "ci-config-review",
    category: "incidents-triage",
    title: "CI workflow review",
    description:
      "Static pass on workflow YAML — flaky patterns and sharp edges.",
    prompt:
      "Locate CI configs (.github/workflows, .gitlab-ci.yml, Azure/build YAML, etc.). Summarize workflows touching tests/build/deploy; flag brittle patterns (unpinned actions, missing caches, reliance on secrets without fallbacks, heavy integration suites on every push). Propose incremental hardening — you cannot query live CI status unless CLI/network is available.",
    modes: DEVELOPER,
    emoji: "🛠️",
    defaultFrequency: "weekly",
    defaultHour: 8,
    defaultMinute: 0,
    defaultDayOfWeek: 2,
  },
  {
    id: "merge-risk-qa-brief",
    category: "incidents-triage",
    title: "Merge-risk QA brief",
    description:
      "What changed vs default branch — focused manual QA angles.",
    prompt:
      "Using git diff vs the repo’s default integration branch when available (--stat and high-level paths), propose a concise QA brief: surfaces to exercise, edge cases suggested by changed files, and regression hotspots. If diff scope is huge, prioritize top directories and public APIs. Note limitations if branches aren’t fetched.",
    modes: DEVELOPER,
    emoji: "📋",
    defaultFrequency: "daily",
    defaultHour: 9,
    defaultMinute: 30,
  },
  {
    id: "issue-triage",
    category: "incidents-triage",
    title: "Bug triage worksheet",
    description:
      "Severity rubric + repro checklist tailored to repo conventions.",
    prompt:
      "Read CONTRIBUTING.md, issue templates (.github/ISSUE_TEMPLATE), SECURITY.md if present. Produce a reusable bug triage worksheet: severity definitions aligned with this project, repro steps checklist, info to request from reporters, and suggested labels/categories inferred from docs — not from external trackers Pulse cannot see.",
    modes: DEVELOPER,
    emoji: "💬",
    defaultFrequency: "weekdays",
    defaultHour: 10,
    defaultMinute: 0,
  },

  // ── Repo hygiene (filesystem + git — safe, read-first)
  {
    id: "dependency-manifest-review",
    category: "repo-hygiene",
    title: "Dependency manifest review",
    description:
      "package.json / lockfile sanity — duplicates, engines, obvious smells.",
    prompt:
      "Inspect package manifests and lockfiles present (npm/yarn/pnpm, Cargo, go.mod, etc.). Report duplicate/conflicting dependency declarations, engines/node constraints, workspace boundaries if monorepo, and scripts that look outdated vs README. Avoid requiring network installs — flag places where maintainers should run `outdated` or audits manually.",
    modes: DEVELOPER,
    emoji: "📦",
    defaultFrequency: "weekly",
    defaultHour: 10,
    defaultMinute: 0,
    defaultDayOfWeek: 3,
  },
  {
    id: "readme-scripts-audit",
    category: "repo-hygiene",
    title: "README ↔ scripts audit",
    description:
      "Docs vs actual npm/Makefile scripts — drift that trips newcomers.",
    prompt:
      "Compare README (and docs/getting-started) with declared scripts and tooling configs (package.json scripts, Makefile, task runners). List mismatches: documented commands that don’t exist, missing prerequisites (Node version, DB), stale paths. Suggest minimal doc patches as bullet points.",
    modes: DEVELOPER,
    emoji: "📖",
    defaultFrequency: "weekly",
    defaultHour: 15,
    defaultMinute: 0,
    defaultDayOfWeek: 3,
  },
  {
    id: "stale-branch-report",
    category: "repo-hygiene",
    title: "Stale branches inventory",
    description:
      "Which remote branches look merged or abandoned — report only.",
    prompt:
      "Using git branch listings (prefer read-only inspection), identify remote branches likely merged into the default branch or stale with no recent commits. Produce a table: branch name, last activity hint if visible, recommendation (candidate for deletion vs investigate). Explicitly do not delete branches — reporting only.",
    modes: DEVELOPER,
    emoji: "🌿",
    defaultFrequency: "weekly",
    defaultHour: 16,
    defaultMinute: 0,
    defaultDayOfWeek: 5,
  },
  {
    id: "todo-hotspot-scan",
    category: "repo-hygiene",
    title: "TODO / FIXME radar",
    description:
      "Recent hotspots via markers — tech debt visibility.",
    prompt:
      "Search the codebase for TODO, FIXME, HACK, XXX markers (respect .gitignore). Group by directory or package; estimate urgency from surrounding code comments only. Exclude vendor/build dirs if obvious. Summarize top 10 hotspots maintainers should schedule — no automatic edits.",
    modes: DEVELOPER,
    emoji: "🎯",
    defaultFrequency: "weekdays",
    defaultHour: 16,
    defaultMinute: 30,
  },
  // ── Docs & digests (work — collection sources / managed files, never git)
  {
    id: "daily-doc-digest",
    category: "knowledge-work",
    title: "Daily document digest",
    description:
      "Morning summary of your project sources — what each covers, what changed, what needs attention.",
    prompt:
      "Review the project source documents available to you. Produce a short morning digest: what each document covers, anything that looks new or changed, and up to three items that deserve attention today. Write it as a polished summary document the user can skim in one minute.",
    modes: WORK,
    emoji: "🗞️",
    defaultFrequency: "weekdays",
    defaultHour: 8,
    defaultMinute: 30,
  },
  {
    id: "weekly-report-draft",
    category: "knowledge-work",
    title: "Weekly report draft",
    description:
      "Drafts the weekly status report from your project sources and recent work.",
    prompt:
      "Draft a weekly status report from the project source documents available to you. Structure it as: accomplishments, in-progress items, blockers, and next week's focus. Where the sources are thin, mark the section as needing the user's input rather than inventing content. Save the draft as a document the user can edit and share.",
    modes: WORK,
    emoji: "📝",
    defaultFrequency: "weekly",
    defaultHour: 16,
    defaultMinute: 0,
    defaultDayOfWeek: 5,
  },
  {
    id: "meeting-notes-cleanup",
    category: "knowledge-work",
    title: "Meeting notes cleanup",
    description:
      "Turns rough meeting notes in your sources into structured minutes with action items.",
    prompt:
      "Find meeting notes among the project source documents. Rewrite each set as structured minutes: attendees (if stated), decisions, action items with owners, and open questions. Keep the original files untouched; produce cleaned versions as new documents and list what you produced.",
    modes: WORK,
    emoji: "🧹",
    defaultFrequency: "weekly",
    defaultHour: 17,
    defaultMinute: 0,
    defaultDayOfWeek: 5,
  },
  {
    id: "deliverable-status",
    category: "knowledge-work",
    title: "Deliverable status check",
    description:
      "Reviews in-progress documents and reports what is finished, stale, or blocked.",
    prompt:
      "Review the documents you have produced in this project so far, together with the project sources. Report per deliverable: finished, in progress, or stale (untouched lately), and whether anything blocks completion. End with a short prioritized list of what to finish next.",
    modes: WORK,
    emoji: "📊",
    defaultFrequency: "weekly",
    defaultHour: 9,
    defaultMinute: 30,
    defaultDayOfWeek: 1,
  },
  {
    id: "action-item-sweep",
    category: "knowledge-work",
    title: "Action item sweep",
    description:
      "Pulls every open action item out of your material into one owner-and-date list.",
    prompt:
      "Go through the project source documents and the documents you have produced here, and pull out every action item, promise, or follow-up you can find. Consolidate them into a single list with owner, what was asked for, and any date mentioned; mark the ones where the owner or date is unstated. Save it as one document, replacing your previous sweep if there is one, and name the most urgent few in your reply.",
    modes: WORK,
    emoji: "📌",
    defaultFrequency: "weekdays",
    defaultHour: 9,
    defaultMinute: 0,
  },
  {
    id: "source-consistency-check",
    category: "knowledge-work",
    title: "Source consistency check",
    description:
      "Cross-reads your sources for figures, dates, and claims that contradict each other.",
    prompt:
      "Cross-read the project source documents against each other. Report figures, dates, names, or claims that disagree between documents, plus anything that reads as out of date. For each conflict, quote both sides and say which document appears more recent when that is knowable. Save the findings as a short discrepancy report — flag the conflicts, don't resolve them yourself.",
    modes: WORK,
    emoji: "🔍",
    defaultFrequency: "weekly",
    defaultHour: 11,
    defaultMinute: 0,
    defaultDayOfWeek: 3,
  },
  {
    id: "executive-one-pager",
    category: "knowledge-work",
    title: "Executive one-pager",
    description:
      "Condenses the current material into a single page a busy reader can absorb.",
    prompt:
      "Condense the project source documents into a one-page brief for someone with no prior context: what this is, where it stands, what has been decided, and what is still open. No jargon, no filler, one page. Save it as a document and say in your reply what you had to leave out to make it fit.",
    modes: WORK,
    emoji: "🗒️",
    defaultFrequency: "weekly",
    defaultHour: 15,
    defaultMinute: 0,
    defaultDayOfWeek: 4,
  },
  {
    id: "follow-up-drafts",
    category: "knowledge-work",
    title: "Follow-up message drafts",
    description:
      "Drafts the messages your open items imply — ready to review and send.",
    prompt:
      "Look at the open action items and recent meeting material in the project sources. Draft the follow-up messages they imply: one short, sendable draft per recipient, each with a subject line and a single clear ask. Never invent facts, names, or dates the material doesn't support — leave a bracketed blank instead. Save the drafts as one document.",
    modes: WORK,
    emoji: "✉️",
    defaultFrequency: "weekdays",
    defaultHour: 16,
    defaultMinute: 30,
  },
  {
    id: "glossary-faq",
    category: "knowledge-work",
    title: "Glossary & FAQ upkeep",
    description:
      "Keeps a plain-language glossary and FAQ in step with your project material.",
    prompt:
      "Maintain a plain-language glossary and FAQ for this project. Read the project source documents, add terms, acronyms, and recurring questions that aren't covered yet, and correct entries the material has outgrown. Edit the existing document in place if one exists; otherwise create it. Report what you added or changed rather than restating the whole file.",
    modes: WORK,
    emoji: "📚",
    defaultFrequency: "weekly",
    defaultHour: 10,
    defaultMinute: 0,
    defaultDayOfWeek: 2,
  },
  {
    id: "deck-outline",
    category: "knowledge-work",
    title: "Presentation outline",
    description:
      "Turns the latest material into a slide-by-slide outline you can build from.",
    prompt:
      "Turn the current project material into a presentation outline: a title, then slide-by-slide bullets with a one-line speaker note under each. Ten slides or fewer, conclusion first. Where the material can't support a slide the story needs, say so instead of filling it in. Save the outline as a document.",
    modes: WORK,
    emoji: "🎞️",
    defaultFrequency: "weekly",
    defaultHour: 14,
    defaultMinute: 0,
    defaultDayOfWeek: 3,
  },
  // ── Planning & follow-through (work — the plan is a file, not a chat reply)
  {
    id: "week-ahead-plan",
    category: "planning",
    title: "Week ahead plan",
    description:
      "A Monday plan built from your sources, open items, and whatever is still unfinished.",
    prompt:
      "Plan the week ahead. Read the project source documents and the documents you have produced here, then propose a prioritized plan: what to finish, what to start, what can wait, with a rough effort estimate for each. Mark anything that depends on someone else answering first. Save the plan as a document the user can edit, and keep the reply to the top three items.",
    modes: WORK,
    emoji: "🗓️",
    defaultFrequency: "weekly",
    defaultHour: 8,
    defaultMinute: 30,
    defaultDayOfWeek: 1,
  },
  {
    id: "deadline-radar",
    category: "planning",
    title: "Deadline radar",
    description:
      "Every date hiding in your material, in order — with the next two weeks flagged.",
    prompt:
      "Scan the project source documents for dates, deadlines, and time-bound promises. Build one chronological timeline of what falls due when, noting the document each came from, and flag everything inside the next two weeks. When a date is relative or ambiguous (\"next month\", \"after the review\"), record it as such rather than guessing a day. Save it as a document.",
    modes: WORK,
    emoji: "⏳",
    defaultFrequency: "weekdays",
    defaultHour: 8,
    defaultMinute: 0,
  },
  {
    id: "decision-log",
    category: "planning",
    title: "Decision log update",
    description:
      "Appends the decisions your recent material records — what, when, by whom, and why.",
    prompt:
      "Maintain a decision log for this project. Read the project source documents for decisions that have been made — what was decided, when, by whom, and the reasoning given — and append the ones the log doesn't already record. Keep each entry to a few lines and quote the sentence you took it from. Create the log if it doesn't exist yet.",
    modes: WORK,
    emoji: "⚖️",
    defaultFrequency: "weekly",
    defaultHour: 15,
    defaultMinute: 30,
    defaultDayOfWeek: 5,
  },
  // ── Briefings (chat — read-only; the reply IS the deliverable)
  {
    id: "daily-briefing",
    category: "briefings",
    title: "Daily briefing",
    description:
      "A read-only morning briefing from your project sources — answers in chat, changes nothing.",
    prompt:
      "Give a concise morning briefing based on the project source documents available to you: the key themes, anything time-sensitive, and up to three suggested focus points for today. Answer entirely in chat — do not create or modify any files.",
    modes: CHAT,
    emoji: "☀️",
    defaultFrequency: "weekdays",
    defaultHour: 8,
    defaultMinute: 0,
  },
  {
    id: "weekly-recap",
    category: "briefings",
    title: "Weekly recap",
    description:
      "A read-only end-of-week recap of your project's sources and conversations.",
    prompt:
      "Give an end-of-week recap based on the project source documents available to you: what the week's material covered, patterns worth noticing, and open questions going into next week. Answer entirely in chat — do not create or modify any files.",
    modes: CHAT,
    emoji: "🌇",
    defaultFrequency: "weekly",
    defaultHour: 17,
    defaultMinute: 30,
    defaultDayOfWeek: 5,
  },
  {
    id: "end-of-day-checkin",
    category: "briefings",
    title: "End-of-day check-in",
    description:
      "A read-only wind-down: what today's material amounted to, and what to carry into tomorrow.",
    prompt:
      "Wind the day down. Based on the project source documents available to you, walk through what the day's material amounted to, what still looks unfinished, and the two or three things worth carrying into tomorrow. Keep it conversational and short — this is a check-in, not a report. Answer entirely in chat — do not create or modify any files.",
    modes: CHAT,
    emoji: "🌙",
    defaultFrequency: "weekdays",
    defaultHour: 18,
    defaultMinute: 0,
  },
  {
    id: "devils-advocate",
    category: "briefings",
    title: "Devil's advocate pass",
    description:
      "Argues the other side of your current plan — pointed, specific, and read-only.",
    prompt:
      "Take the opposing view. Read the project source documents available to you, work out the plan or position they assume, and argue against it: the assumptions that could be wrong, the risks being waved away, and what would have to be true for this to fail. Be specific and point at the material rather than offering generic caution. Answer entirely in chat — do not create or modify any files.",
    modes: CHAT,
    emoji: "🥊",
    defaultFrequency: "weekly",
    defaultHour: 11,
    defaultMinute: 0,
    defaultDayOfWeek: 2,
  },
  {
    id: "one-sharp-question",
    category: "briefings",
    title: "One sharp question",
    description:
      "A single pointed question about your material — a thinking prompt, nothing more.",
    prompt:
      "Ask one sharp question. Read the project source documents available to you and raise the single question the material most needs answered — the one whose answer would change what happens next. Add a short paragraph on why it matters, then stop and leave the user to think. Answer entirely in chat — do not create or modify any files.",
    modes: CHAT,
    emoji: "❓",
    defaultFrequency: "weekdays",
    defaultHour: 13,
    defaultMinute: 0,
  },
  // ── Reading & research (chat — read-only, web-grounded when reachable)
  {
    id: "topic-watch",
    category: "research",
    title: "Topic watch",
    description:
      "Checks what's new on the topics your project revolves around — answers in chat.",
    prompt:
      "Work out the main topics, products, or organizations the project source documents revolve around. If you can reach the web, look for what is genuinely new about them and report the handful that matter, with links and one line each on why. If you have no web access, say so plainly and instead summarize what the material itself assumes about those topics. Answer entirely in chat — do not create or modify any files.",
    modes: CHAT,
    emoji: "📡",
    defaultFrequency: "weekdays",
    defaultHour: 9,
    defaultMinute: 0,
  },
  {
    id: "market-scan",
    category: "research",
    title: "Market scan",
    description:
      "A read-only sweep of what's moving in the space your work sits in.",
    prompt:
      "Work out which market or field the project source documents place this work in. If you can reach the web, sweep for what has changed there lately — announcements, competitors, notable writing — and report only the few items that would actually affect this work, with links. Say plainly when you cannot reach the web. Answer entirely in chat — do not create or modify any files.",
    modes: CHAT,
    emoji: "🧭",
    defaultFrequency: "weekly",
    defaultHour: 9,
    defaultMinute: 30,
    defaultDayOfWeek: 1,
  },
  {
    id: "plain-language-explainer",
    category: "research",
    title: "Plain-language explainer",
    description:
      "Explains one dense piece of your material as if you were brand new to it.",
    prompt:
      "Pick the densest or least approachable of the project source documents available to you and explain it as if the user were meeting this project for the first time: what it covers, why it exists, and the three things worth remembering. Plain language, no jargon, no summary of the summary. Answer entirely in chat — do not create or modify any files.",
    modes: CHAT,
    emoji: "🧑‍🏫",
    defaultFrequency: "weekly",
    defaultHour: 10,
    defaultMinute: 0,
    defaultDayOfWeek: 4,
  },
];
