import type { SignalWithEntity } from "@/lib/redux/api";
import { BaseTab } from "./base-tab";
import { ProviderIcon } from "./provider-icon";

export function SignalTab({ signal, isActive, isFirst, onClick, onClose }: {
  signal: SignalWithEntity;
  isActive: boolean;
  isFirst?: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  const { signal: sig, entity } = signal;
  const label = entity.title || "Signal";

  return (
    <BaseTab
      isActive={isActive}
      isFirst={isFirst}
      onClick={onClick}
      onClose={onClose}
      icon={<ProviderIcon provider={sig.source} />}
      label={label}
      tooltip={label}
    />
  );
}
