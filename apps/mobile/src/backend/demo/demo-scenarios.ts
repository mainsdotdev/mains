/**
 * Small, honest demo scripts. They exercise the same run, tool and approval UI
 * as a paired Mac, but all content below is bundled with the phone.
 */

export interface DemoToolSpec {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
}

export interface DemoScenario {
  id: string;
  suggestedPrompt: string;
  title: string;
  intro: (prompt: string) => string;
  inspectionTools: DemoToolSpec[];
  approval: {
    command: string;
    header: string;
    question: string;
    output: string;
  };
  approvedResult: (prompt: string) => string;
  deniedResult: (prompt: string) => string;
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

const SCENARIOS = [appStoreReadiness, issueInvestigation] as const;

export function demoScenarioForPrompt(prompt: string): DemoScenario {
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
