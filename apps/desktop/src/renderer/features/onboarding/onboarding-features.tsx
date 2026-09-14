import type { ReactNode } from "react";
import {
  ArrowUp,
  Bot,
  Branch,
  Clock,
  CodexColor,
  Commit,
  CopilotStatic,
  Cursor,
  Diff,
  Document,
  Github,
  Inbox,
  Linear,
  Plugin,
  Preset,
  PullRequest,
  Relay,
  Skill,
  Sparkles,
} from "@/components/ui/icons";
import { Bag, Chat, Claude, Code } from "@/components/ui/icons/space";
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
 * so these cards can't drift into a private palette. Hues repeat across the
 * grid rather than reaching for a colour the app doesn't already offer.
 */
export type FeatureAccent =
  | "purple"
  | "blue"
  | "green"
  | "orange"
  | "red"
  | "amber";

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
   * a screenshot; `center` is for frameless previews that read as artwork.
   */
  previewPlacement?: "corner" | "center";
}

/**
 * The "out of the box" tour: one card per core capability, in reading order.
 * Adding a feature is one entry here — the step renders whatever is listed.
 */
export const CORE_FEATURES: CoreFeature[] = [
  {
    id: "agents",
    title: "Every agent, one window",
    blurb: "Claude, Codex, Copilot & Cursor side by side",
    Icon: Bot,
    accent: "purple",
    previewPlacement: "center",
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
    Icon: Preset,
    accent: "blue",
    previewPlacement: "center",
    preview: (
      // Icon + tint per mode mirror `space-mode-picker.tsx`'s MODE_ICONS.
      <ModesPreview
        active="Work"
        items={[
          { label: "Code", Icon: Code, iconClassName: "text-accent", shortcut: "⌘ 1" },
          { label: "Work", Icon: Bag, iconClassName: "text-warning", shortcut: "⌘ 2" },
          { label: "Chat", Icon: Chat, iconClassName: "text-success", shortcut: "⌘ 3" },
        ]}
      />
    ),
  },
  {
    id: "worktrees",
    title: "Worktree workspaces",
    blurb: "A branch and folder per task, in parallel",
    Icon: Branch,
    accent: "green",
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
            active: true,
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
    blurb: "Ship from the chat, no terminal needed",
    Icon: Commit,
    accent: "orange",
    previewPlacement: "center",
    preview: (
      // Rows mirror `session-panel/git-actions` — same icons, same order.
      <SessionPanelPreview
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
          { icon: <Branch className="size-4" />, label: "feat/modes", expandable: true },
          { icon: <Commit className="size-4" />, label: "Commit or push", expandable: true },
          {
            icon: <ArrowUp className="size-4 rotate-180" />,
            label: "Pull",
            trailing: "↓2",
          },
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
    accent: "red",
    preview: (
      <ListPreview
        heading="Assigned to me"
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
    accent: "amber",
    preview: (
      <ListPreview
        heading="Today"
        rows={[
          { label: "Triage new issues", meta: "09:00 · Daily" },
          { label: "Summarize open PRs", meta: "17:30 · Weekdays" },
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
    accent: "purple",
    previewPlacement: "center",
    preview: (
      <ComposerPreview
        text="Draft the release notes from"
        chips={[
          { label: "CHANGELOG.md", Icon: Document },
          { label: "release-notes", Icon: Skill, iconClassName: "text-accent" },
          { label: "Docs", Icon: Sparkles, iconClassName: "text-success" },
        ]}
        model="Opus 5"
        effort="Medium"
      />
    ),
  },
  {
    id: "remote",
    title: "Phone and tablet",
    blurb: "Your Mac as a backend, over Tailscale or SSH",
    Icon: Relay,
    accent: "blue",
    previewPlacement: "center",
    preview: (
      <DevicesPreview
        lines={[
          { mine: true, text: "Is the sidebar fix merged?" },
          { text: "Yes — PR #481 landed." },
          { mine: true, text: "Start the glow task." },
        ]}
      />
    ),
  },
];
