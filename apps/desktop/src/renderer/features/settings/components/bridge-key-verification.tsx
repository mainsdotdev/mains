import { useState } from "react";
import { normalizeBridgeVerificationCode } from "@mains/contracts/bridge-auth";
import { Button, Input, Muted, Text } from "@/components/ui";
import { SettingsSection } from "./settings-layout";

export function BridgeKeyVerification({ busy, onConfirm }: {
  busy: boolean; onConfirm(fingerprint: string): Promise<void>;
}) {
  const [input, setInput] = useState("");
  let code: string | null = null;
  try { code = normalizeBridgeVerificationCode(input); } catch { /* Wait for a complete fingerprint. */ }
  return (
    <SettingsSection title="Verify account key">
      <div className="space-y-4 py-4">
        <Text className="max-w-2xl">
          On an approved device, open Settings › Bridge and find its account
          fingerprint. Enter that fingerprint below to verify this device.
        </Text>
        <Muted className="max-w-2xl">
          Sync stays paused until the account keys match.
        </Muted>
        <form className="max-w-xl space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (code && !busy) void onConfirm(code);
        }}>
          <Input
            aria-label="Fingerprint from approved device"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="Enter the fingerprint from your approved device"
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
