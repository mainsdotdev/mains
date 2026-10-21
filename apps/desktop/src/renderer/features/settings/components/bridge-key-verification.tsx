import { useState } from "react";
import { normalizeBridgeVerificationCode } from "@mains/contracts/bridge-auth";
import { Button, Input, Muted, Text } from "@/components/ui";
import { SettingsSection } from "./settings-layout";

export function BridgeKeyVerification({ busy, onConfirm }: {
  busy: boolean; onConfirm(joinCode: string): Promise<void>;
}) {
  const [input, setInput] = useState("");
  let code: string | null = null;
  try { code = normalizeBridgeVerificationCode(input); } catch { /* Wait for a complete code. */ }
  return (
    <SettingsSection title="Verify this device">
      <div className="space-y-4 py-4">
        <Muted size="xs">Step 2 of 2</Muted>
        <Text className="max-w-2xl">
          On the device that approved this one, open Bridge › Device setup.
          Enter the join code shown in Step 2 for this device.
        </Text>
        <Muted className="max-w-2xl">
          Sync stays paused until the code matches.
        </Muted>
        <form className="max-w-xl space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (code && !busy) void onConfirm(code);
        }}>
          <Input
            aria-label="Join code from the approving device"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="Enter the join code from your approving device"
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button type="submit" variant="primary" disabled={busy || !code}>
            Verify and start sync
          </Button>
        </form>
      </div>
    </SettingsSection>
  );
}
