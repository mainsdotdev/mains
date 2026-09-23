import type { ReactNode } from "react";
import {
  ArrowUp,
  Bot,
  Branch,
  Chart,
  Check,
  Clock,
  CodexColor,
  Commit,
  CopilotStatic,
  Cursor,
  Diff,
  Figma,
  Github,
  Gmail,
  GoogleCalendar,
  Inbox,
  Linear,
  Notion,
  Plugin,
  PullRequest,
  Relay,
  Sentry,
  Skill,
  Slack,
  Workflow,
} from "@/components/ui/icons";
import { Claude } from "@/components/ui/icons/space";
import {
  ComposerPreview,
  ListPreview,
  ModesPreview,
  DevicesPreview,
  SessionPanelPreview,
  TilesPreview,
  WorkspaceListPreview,
} from "./components/feature-previews";

/**
 * Icon tint per card, named from the app's own `ICON_COLORS` vocabulary
 * (`lib/icon-registry.tsx`) — the same names a user picks for a space icon,
 * so these cards can't drift into a private palette. Every card uses
 * `default` for now: tinting only some tiles read as a mismatch, since the
 * untinted ones looked like they were missing a colour rather than choosing
 * none. Tint them all or none.
 */
export type FeatureAccent =
  | "default"
  | "violet"
  | "rose"
  | "orange"
  | "amber"
  | "green"
  | "sky"
  | "olive";

export interface CoreFeature {
  id: string;
  title: string;
  /** A few words under the title — keep it to one short line. */
  blurb: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  accent: FeatureAccent;
  /** Decorative backdrop; built from `feature-previews.tsx` primitives. */
  preview: ReactNode;
  /**
   * Where the backdrop sits. `corner` (default) crops it off the top-left like
   * a screenshot; `center` hangs it from the top, centered across; `middle`
   * centers it both ways in the space above the label bar — for artwork short
   * enough that hanging from the top would leave it hugging the edge.
   */
  previewPlacement?: "corner" | "center" | "middle";
}

/**
 * The "out of the box" tour: one card per core capability, in reading order.
 * Adding a feature is one entry here — the step renders whatever is listed.
 */
export const CORE_FEATURES: CoreFeature[] = [
  {
    id: "agents",
    title: "Powerful agents, one window",
    blurb: "Claude, Codex, Copilot & Cursor side by side",
    Icon: Bot,
    accent: "default",
    previewPlacement: "middle",
    preview: (
      <TilesPreview
        tiles={[
          { label: "Claude", Icon: Claude, iconClassName: "text-claude!" },
          { label: "Codex", Icon: CodexColor },
          { label: "Copilot", Icon: CopilotStatic, iconClassName:"text-primary-900 dark:text-primary-100" },
          { label: "Cursor", Icon: Cursor, iconClassName:"text-primary-900 dark:text-primary-100" },
        ]}
      />
    ),
  },
  {
    id: "modes",
    title: "Code, Work & Chat",
    blurb: "One space, three ways to work",
    Icon: Workflow,
    accent: "default",
    previewPlacement: "center",
    preview: (
      // The sidebar header's `SpaceModePicker`, open; shortcuts are the defaults.
      <ModesPreview
        prefixLabel="Mains"
        items={[
          { mode: "developer", shortcut: "⌘ 1" },
          { mode: "work", shortcut: "⌘ 2" },
          { mode: "chat", shortcut: "⌘ 3" },
        ]}
      />
    ),
  },
  {
    id: "connect",
    title: "Mains Connect",
    blurb: "Remote-control your Mac's agents from your phone",
    Icon: Relay,
    accent: "default",
    previewPlacement: "center",
    preview: (
      // One run, mirrored on both screens and scrolling in step on hover.
      <DevicesPreview
        title="Sidebar height"
        workspaces={["Sidebar height", "Mode harness", "Usage ticks"]}
        run={[
          { kind: "user", text: "Fix the sidebar height on small windows" },
          { kind: "tool", text: "Read sidebar.tsx" },
          { kind: "tool", text: "Edit sidebar.tsx  +12 -4" },
          { kind: "agent", text: "Capped it at the viewport. Running tests." },
          { kind: "approval", text: "Run npm test?" },
          { kind: "tool", text: "npm test  ·  48 passed" },
          { kind: "agent", text: "All green. Ready for review." },
          { kind: "user", text: "Ship it" },
          { kind: "tool", text: "Committed and pushed" },
        ]}
      />
    ),
  },
  {
    id: "worktrees",
    title: "Worktree workspaces",
    blurb: "A branch and folder per task, in parallel",
    Icon: Branch,
    accent: "default",
    previewPlacement: "center",
    preview: (
      <WorkspaceListPreview
        rows={[
          {
            name: "Mode harness",
            branch: "feat/modes",
            status: "in_progress",
            insertions: 214,
            deletions: 38,
          },
          {
            name: "Sidebar height",
            branch: "fix/sidebar-height",
            status: "in_review",
            insertions: 12,
            deletions: 4,
          },
          { name: "Usage ticks", branch: "chore/usage-ticks", status: "done" },
          { name: "Mains", branch: "main", status: "todo" },
        ]}
      />
    ),
  },
  {
    id: "git",
    title: "Commit, push & PR",
    blurb: "Ship from the session panel, no terminal needed",
    Icon: Commit,
    accent: "default",
    previewPlacement: "center",
    preview: (
      // Rows mirror `session-panel/git-actions` — same icons, same order.
      <SessionPanelPreview
        heading="Environment"
        // On hover: open "Commit or push", type the message, commit and push.
        action={{
          row: 1,
          // The first two are `commit-section.tsx`'s own placeholders.
          placeholder: "Commit message (leave blank to generate)…",
          generating: "Generating commit message…",
          message: "fix(sidebar): cap height to the viewport",
          confirm: { icon: <ArrowUp className="size-4" />, label: "Commit and push" },
          done: (
            <span className="flex items-center gap-1 text-success">
              <Check className="size-3" />
              Pushed
            </span>
          ),
        }}
        rows={[
          {
            icon: <Diff className="size-4" />,
            label: "Changes",
            trailing: (
              <span className="flex items-center gap-1">
                <span className="text-success">+214</span>
                <span className="text-danger">-38</span>
              </span>
            ),
            expandable: true,
          },
          { icon: <Commit className="size-4" />, label: "Commit or push", expandable: true },
          {
            icon: <PullRequest className="size-4" />,
            label: "Create pull request",
            expandable: true,
          },
        ]}
      />
    ),
  },
  {
    id: "tasks",
    title: "Tasks inbox",
    blurb: "Issues & PRs from GitHub, Linear, Jira",
    Icon: Inbox,
    accent: "default",
    previewPlacement: "center",
    preview: (
      <ListPreview
        heading="Assigned to me"
        motion="ticker"
        rows={[
          { label: "#482 Composer glow bands in dark mode", meta: "Bug", Icon: Github },
          { label: "MNS-31 Plugins picker for work mode", meta: "Todo", Icon: Linear },
          { label: "#479 Mode-aware placeholders", meta: "Review", Icon: Github },
        ]}
      />
    ),
  },
  {
    id: "pulse",
    title: "Pulse schedules",
    blurb: "Prompts that run on a schedule",
    Icon: Clock,
    accent: "default",
    preview: (
      <ListPreview
        heading="Today"
        rows={[
          { label: "Triage new issues", meta: "09:00 · Daily" },
          { label: "Check failing CI", meta: "Every 2h" },
          { label: "Summarize open PRs", meta: "17:30 · Weekdays" },
          { label: "Draft the changelog", meta: "Fri · Weekly" },
          { label: "Audit dependencies", meta: "Sun · Weekly" },
        ]}
      />
    ),
  },
  {
    id: "plugins",
    title: "Plugins & skills",
    blurb: "Type @, / or $ to bring them in",
    Icon: Plugin,
    accent: "default",
    previewPlacement: "middle",
    preview: (
      // Three chip slots; on hover each cycles through its plugins.
      <ComposerPreview
        text="Summarize this week from"
        slots={[
          [
            { label: "Gmail", Icon: Gmail },
            { label: "Notion", Icon: Notion },
            { label: "Slack", Icon: Slack },
          ],
          [
            { label: "Linear", Icon: Linear },
            { label: "Sentry", Icon: Sentry },
            { label: "Figma", Icon: Figma },
          ],
          [
            { label: "Visualize", Icon: Chart, iconClassName: "text-accent" },
            { label: "Calendar", Icon: GoogleCalendar },
            { label: "release-notes", Icon: Skill, iconClassName: "text-accent" },
          ],
        ]}
        model="Opus 5.5"
        effort="Medium"
      />
    ),
  },
];
