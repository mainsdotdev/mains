/**
 * Small, honest demo scripts. They exercise the same run, tool and approval UI
 * as a paired Mac, but all content below is bundled with the phone.
 */

import type { SkillSummary } from "@mains/contracts/runs";

export interface DemoToolSpec {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
}

export interface DemoImageSpec {
  sourceArtifactId: number;
  fileName: string;
}

export interface DemoScenario {
  id: string;
  suggestedPrompt: string;
  title: string;
  intro: (prompt: string) => string;
  inspectionTools: DemoToolSpec[];
  resultImage?: DemoImageSpec;
  approval?: {
    command: string;
    header: string;
    question: string;
    output: string;
  };
  approvedResult: (prompt: string) => string;
  deniedResult?: (prompt: string) => string;
}

export const DEMO_SPACE_ID = "codex";
export const DEMO_SUGGESTED_PROMPT =
  "Review the mobile app for App Store readiness";

const appStoreReadiness: DemoScenario = {
  id: "app-store-readiness",
  suggestedPrompt: DEMO_SUGGESTED_PROMPT,
  title: "Review App Store readiness",
  intro: () =>
    "I’ll inspect the bundled mobile workspace snapshot, then run a validation command with your approval. This is a simulated Demo Mode run; no data leaves this phone.",
  inspectionTools: [
    {
      toolName: "Glob",
      input: {
        pattern: "apps/mobile/{app.config.ts,eas.json,package.json}",
        path: "/Users/demo/Desktop/work/demo-org/mains",
      },
      output:
        "apps/mobile/app.config.ts\napps/mobile/eas.json\napps/mobile/package.json",
    },
    {
      toolName: "Read",
      input: {
        file_path:
          "/Users/demo/Desktop/work/demo-org/mains/apps/mobile/app.config.ts",
      },
      output:
        'version: "0.1.0"\nplatforms: ["ios"]\nbundleIdentifier: "dev.mains.mobile"\nITSAppUsesNonExemptEncryption: false\nNSCameraUsageDescription: configured',
    },
    {
      toolName: "Read",
      input: {
        file_path: "/Users/demo/Desktop/work/demo-org/mains/apps/mobile/eas.json",
      },
      output:
        'production: { node: "24.20.0", autoIncrement: true, channel: "production" }\nsubmit.production.ios.ascAppId: "6808557372"',
    },
  ],
  approval: {
    command: "npm run typecheck",
    header: "Run the type check?",
    question:
      "The demo agent wants to run `npm run typecheck` in the mobile workspace.",
    output: "> mobile@0.1.0 typecheck\n> tsc --noEmit\n\n✓ No TypeScript errors found",
  },
  approvedResult: () => `## Demo readiness result

- **App identity:** production bundle ID and App Store Connect app ID are configured.
- **Privacy:** the camera purpose string explains that the camera scans the Mac pairing code.
- **Build:** the production profile auto-increments the build number and can auto-submit.
- **Validation:** the simulated type check completed successfully.

For a real submission, I would next verify the archive, TestFlight metadata, review notes, privacy answers, and the reviewer’s Demo Mode path on a physical device.`,
  deniedResult: () => `## Demo readiness result

I inspected the bundled configuration, but skipped the type check because you declined the command. The app identity, privacy purpose string, and production submission profile are present. Run validation before treating the build as submission-ready.`,
};

const issueInvestigation: DemoScenario = {
  id: "issue-investigation",
  suggestedPrompt: "Investigate why the mobile run screen can get stuck",
  title: "Investigate the mobile issue",
  intro: (prompt) =>
    `I’ll trace the relevant mobile code for “${shortPrompt(prompt)}” using the bundled workspace snapshot. This is a simulated Demo Mode run; no data leaves this phone.`,
  inspectionTools: [
    {
      toolName: "Grep",
      input: {
        pattern: "statusChanged|eventPersisted|pendingApproval",
        path: "/Users/demo/Desktop/work/demo-org/mains/apps/mobile/src",
      },
      output:
        "src/backend/backend-session.ts: attachRunEvents(...)\nsrc/backend/sync.ts: syncPendingApprovals(...)\nsrc/features/runs/components/run-view.tsx: isRunLive",
    },
    {
      toolName: "Read",
      input: {
        file_path:
          "/Users/demo/Desktop/work/demo-org/mains/apps/mobile/src/backend/backend-session.ts",
      },
      output:
        "Run events update the local projection, then the active run is pulled again after reconnect.",
    },
  ],
  approval: {
    command: "npm run typecheck",
    header: "Validate the mobile app?",
    question:
      "The demo agent wants to run `npm run typecheck` before reporting its diagnosis.",
    output: "> mobile@0.1.0 typecheck\n> tsc --noEmit\n\n✓ No TypeScript errors found",
  },
  approvedResult: (prompt) => `## Demo investigation result

For **${shortPrompt(prompt)}**, the representative trace points to run-state reconciliation rather than rendering. The mobile client updates its SQLite projection from pushed events and refreshes the active run after reconnect. The simulated validation passed; the next real step would be to reproduce against a paired Mac and capture the event sequence.`,
  deniedResult: (prompt) => `## Demo investigation result

For **${shortPrompt(prompt)}**, the representative trace points to run-state reconciliation rather than rendering. I skipped validation because you declined the command, so this remains a preliminary diagnosis.`,
};

const workspaceReview: DemoScenario = {
  id: "workspace-review",
  suggestedPrompt: "Summarize the current mobile architecture",
  title: "Review the mobile workspace",
  intro: (prompt) =>
    `I’ll demonstrate a representative workspace review for “${shortPrompt(prompt)}” using bundled sample data. No data leaves this phone in Demo Mode.`,
  inspectionTools: [
    {
      toolName: "Glob",
      input: {
        pattern: "apps/mobile/src/**/*.{ts,tsx}",
        path: "/Users/demo/Desktop/work/demo-org/mains",
      },
      output:
        "apps/mobile/src/app/(main)/index.tsx\napps/mobile/src/backend/backend-session.ts\napps/mobile/src/backend/sync.ts\napps/mobile/src/features/runs/components/run-view.tsx",
    },
    {
      toolName: "Read",
      input: {
        file_path:
          "/Users/demo/Desktop/work/demo-org/mains/apps/mobile/src/backend/backend-session.ts",
      },
      output:
        "The session owns pairing, connection supervision, local sync, and run commands.",
    },
  ],
  approval: {
    command: "npm run typecheck",
    header: "Run a validation command?",
    question:
      "The demo agent wants to run `npm run typecheck` in the sample workspace.",
    output: "> mobile@0.1.0 typecheck\n> tsc --noEmit\n\n✓ No TypeScript errors found",
  },
  approvedResult: (prompt) => `## Demo workspace result

I completed a representative review for **${shortPrompt(prompt)}**. The mobile app keeps a local SQLite projection, connects to the paired desktop through a supervised WebSocket session, and renders runs from persisted artifacts and tool calls. The simulated validation completed successfully.`,
  deniedResult: (prompt) => `## Demo workspace result

I reviewed the bundled sample for **${shortPrompt(prompt)}**, but skipped validation because you declined the command. The architecture remains visible in the transcript without claiming that a command ran.`,
};

interface PluginDemoDefinition {
  aliases: string[];
  title: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  result: string;
  resultImage?: DemoImageSpec;
}

const PLUGIN_DEMOS: PluginDemoDefinition[] = [
  {
    aliases: ["gmail"],
    title: "Summarize the demo inbox",
    toolName: "Gmail",
    input: { action: "search", query: "is:unread newer_than:7d" },
    output: {
      source: "bundled-demo",
      messages: [
        {
          from: "Maya Chen",
          subject: "Launch checklist",
          receivedAt: "09:42",
          snippet: "The screenshots are approved. Review notes are the last item.",
        },
        {
          from: "Noah Williams",
          subject: "Build 4 is ready",
          receivedAt: "Yesterday",
          snippet: "The TestFlight smoke test passed on iPhone and iPad.",
        },
        {
          from: "Design Weekly",
          subject: "A calmer way to ship",
          receivedAt: "Friday",
          snippet: "Five small interface details worth revisiting before launch.",
        },
      ],
    },
    result: `## Demo inbox summary

- **Launch checklist:** screenshots are approved; review notes remain.
- **Build 4:** the sample TestFlight smoke test passed on iPhone and iPad.
- **Newsletter:** low priority and safe to read later.

This is bundled demo data. No Gmail account was connected or accessed.`,
  },
  {
    aliases: ["google-calendar", "google calendar"],
    title: "Plan the demo day",
    toolName: "Google Calendar",
    input: { action: "list_events", range: "today" },
    output: {
      source: "bundled-demo",
      events: [
        { time: "10:00–10:30", title: "Launch check-in" },
        { time: "13:00–14:00", title: "Focus time" },
        { time: "16:30–17:00", title: "Release review" },
      ],
    },
    result: `## Demo day at a glance

Your sample calendar has a launch check-in at **10:00**, protected focus time at **13:00**, and a release review at **16:30**. The clearest uninterrupted window is **14:00–16:30**.

This is bundled demo data. No Google Calendar account was connected or accessed.`,
  },
  {
    aliases: ["linear"],
    title: "Triage the demo release",
    toolName: "Linear",
    input: { action: "list_issues", team: "Mains", state: "In Progress" },
    output: {
      source: "bundled-demo",
      issues: [
        { id: "MNS-128", title: "Finalize App Store review notes", priority: "High" },
        { id: "MNS-121", title: "Verify light mode contrast", priority: "Medium" },
        { id: "MNS-117", title: "Polish plugin picker dismissal", priority: "Low" },
      ],
    },
    result: `## Demo release triage

1. **MNS-128** — finalize App Store review notes.
2. **MNS-121** — verify light mode contrast on a physical device.
3. **MNS-117** — keep the plugin picker polish in the follow-up queue.

This is bundled demo data. No Linear workspace was connected or accessed.`,
  },
  {
    aliases: ["github"],
    title: "Review the demo pull requests",
    toolName: "GitHub",
    input: { action: "list_pull_requests", repository: "demo-org/mains", state: "open" },
    output: {
      source: "bundled-demo",
      pullRequests: [
        { number: 84, title: "Polish App Store demo flow", checks: "passing", review: "approved" },
        { number: 82, title: "Improve light mode surfaces", checks: "passing", review: "changes requested" },
      ],
    },
    result: `## Demo pull request review

- **#84** is approved and all sample checks pass; it is ready to merge.
- **#82** also passes checks, but still has requested visual changes.

This is bundled demo data. No GitHub account or repository was connected or accessed.`,
  },
  {
    aliases: ["imagegen", "image generation", "image gen"],
    title: "Create a demo image",
    toolName: "Image Generation",
    input: { action: "generate", mode: "bundled-demo", aspectRatio: "3:2" },
    output: {
      source: "bundled-demo",
      status: "completed",
      fileName: "mains-chrome-sky.jpg",
      width: 1000,
      height: 666,
    },
    resultImage: {
      sourceArtifactId: 20,
      fileName: "mains-chrome-sky.jpg",
    },
    result: `## Demo image ready

The bundled sample shows a chrome **mains** wordmark floating among soft clouds. In a connected session, Image Generation would render the prompt supplied in the composer.

This is a fixed, locally bundled demo image. No generation request was sent and no external service was contacted.`,
  },
  {
    aliases: ["figma"],
    title: "Review the demo design",
    toolName: "Figma",
    input: { action: "inspect_file", file: "Mains · App Store" },
    output: {
      source: "bundled-demo",
      file: "Mains · App Store",
      frames: 8,
      observations: ["Consistent device scale", "Safe text margins", "No alpha channel"],
    },
    result: `## Demo design review

The sample file contains **8 export-ready frames** with consistent device scale, safe text margins, and opaque backgrounds. The visual sequence moves cleanly from positioning to remote control and everyday use.

This is bundled demo data. No Figma file or account was connected or accessed.`,
  },
  {
    aliases: ["expo"],
    title: "Check the demo build",
    toolName: "Expo",
    input: { action: "inspect_build", platform: "ios", profile: "production" },
    output: {
      source: "bundled-demo",
      platform: "ios",
      profile: "production",
      buildNumber: 4,
      status: "finished",
    },
    result: `## Demo build status

The sample **iOS production build 4** is finished and ready for the submission flow. Its production profile uses automatic build-number increments and the release channel.

This is bundled demo data. No Expo project or account was connected or accessed.`,
  },
  {
    aliases: ["messages"],
    title: "Catch up on demo messages",
    toolName: "Messages",
    input: { action: "list_recent", unreadOnly: true },
    output: {
      source: "bundled-demo",
      conversations: [
        { name: "Launch crew", unread: 2, latest: "Build 4 looks good here." },
        { name: "Alex", unread: 1, latest: "Want me to review the final screenshots?" },
      ],
    },
    result: `## Demo message catch-up

The launch crew confirmed that build 4 looks good, and Alex offered to review the final screenshots. A concise next reply would be: **“Yes please — focus on readability at thumbnail size.”**

This is bundled demo data. No Messages conversations were accessed and nothing was sent.`,
  },
  {
    aliases: ["notion"],
    title: "Find the demo launch notes",
    toolName: "Notion",
    input: { action: "search", query: "App Store launch" },
    output: {
      source: "bundled-demo",
      pages: [
        { title: "App Store launch", updated: "Today", status: "In review" },
        { title: "Release checklist", updated: "Yesterday", status: "4 of 5 done" },
      ],
    },
    result: `## Demo workspace summary

The sample launch page is **in review**. Its linked release checklist has **4 of 5 items complete**; reviewer notes are the remaining item.

This is bundled demo data. No Notion workspace was connected or accessed.`,
  },
  {
    aliases: ["asana"],
    title: "Review the demo launch plan",
    toolName: "Asana",
    input: { action: "list_tasks", project: "Mobile launch", incompleteOnly: true },
    output: {
      source: "bundled-demo",
      tasks: [
        { title: "Add review notes", assignee: "Noah", due: "Today" },
        { title: "Run physical-device smoke test", assignee: "Maya", due: "Today" },
      ],
    },
    result: `## Demo launch plan

Two sample tasks remain: add the App Store review notes and finish the physical-device smoke test. Both are due today, so the submission should follow those checks.

This is bundled demo data. No Asana workspace was connected or accessed.`,
  },
];

function selectedPluginScenario(
  prompt: string,
  skills: readonly SkillSummary[],
): DemoScenario | null {
  const selected = skills.find((skill) => skill.scope === "plugin");
  if (!selected) return null;

  const identity = `${selected.name} ${selected.displayName ?? ""}`.toLocaleLowerCase("en-US");
  const definition = PLUGIN_DEMOS.find((candidate) =>
    candidate.aliases.some((alias) => identity.includes(alias)),
  );
  const displayName = selected.displayName?.trim() || selected.name;

  if (!definition) {
    return {
      id: `plugin-${selected.name}`,
      suggestedPrompt: `Try ${displayName}`,
      title: `Explore ${displayName}`,
      intro: (prompt) =>
        `I’ll demonstrate how ${displayName} can help with “${shortPrompt(prompt)}” using bundled sample data. No external account is contacted in Demo Mode.`,
      inspectionTools: [
        {
          toolName: displayName,
          input: { action: "demo_preview", request: shortPrompt(prompt) },
          output: {
            source: "bundled-demo",
            status: "completed",
            summary: `${displayName} returned a representative sample result.`,
          },
        },
      ],
      approvedResult: () => `## ${displayName} demo result

The plugin completed a representative read-only action using bundled sample content. In a paired, connected session, the same flow would use the account and permissions configured on the Mac.

This is demo data. No external account was connected or accessed.`,
    };
  }

  return {
    id: `plugin-${definition.aliases[0]}`,
    suggestedPrompt: `Try ${definition.toolName}`,
    title: definition.title,
    intro: (prompt) =>
      `I’ll use ${definition.toolName} to demonstrate “${shortPrompt(prompt)}” with bundled sample data. No external account is contacted in Demo Mode.`,
    inspectionTools: [
      {
        toolName: definition.toolName,
        input: definition.resultImage
          ? { ...definition.input, prompt: shortPrompt(prompt) }
          : definition.input,
        output: definition.output,
      },
    ],
    resultImage: definition.resultImage,
    approvedResult: () => definition.result,
  };
}

const SCENARIOS = [appStoreReadiness, issueInvestigation] as const;

export function demoScenarioForPrompt(
  prompt: string,
  contextSkills: readonly SkillSummary[] = [],
): DemoScenario {
  const pluginScenario = selectedPluginScenario(prompt, contextSkills);
  if (pluginScenario) return pluginScenario;

  const normalized = prompt.toLocaleLowerCase("en-US");
  if (/app\s*store|test\s*flight|submission|\bios\b|mobile app/.test(normalized)) {
    return appStoreReadiness;
  }
  if (/bug|error|crash|stuck|broken|fix|investigate|issue/.test(normalized)) {
    return issueInvestigation;
  }
  return workspaceReview;
}

export function shortPrompt(prompt: string): string {
  const plain = prompt.replace(/\s+/g, " ").trim();
  if (!plain) return "this request";
  return plain.length <= 72 ? plain : `${plain.slice(0, 69).trimEnd()}…`;
}

// Keep the named scenarios reachable for future prompt suggestions without
// exporting mutable data from this module.
export const DEMO_PROMPT_SUGGESTIONS = [
  ...SCENARIOS.map((scenario) => scenario.suggestedPrompt),
  workspaceReview.suggestedPrompt,
] as const;
