import { useRef, useState } from "react";
import type { ModelServiceTier } from "@mains/contracts/run-settings";
import { useClickOutside } from "@/hooks/use-click-outside";
import { Button } from "../button";
import DropdownWrapper from "../dropdown-wrapper";
import { BoltFill, Check } from "../icons";
import { Bolt } from "../icons/space";

export function ServiceTierSelect({ value, options, onChange, compact = false }: {
  value: string;
  options: ModelServiceTier[];
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const selected = options.find((tier) => tier.id === value) ?? options[0];
  const accelerated = !!selected && selected.id !== "default";
  return (
    <div className="relative" ref={ref}>
      <Button type="button" aria-label={`Speed: ${selected?.name ?? "Standard"}`}
        aria-haspopup="menu" aria-expanded={open} tooltip="Speed" onClick={() => setOpen(!open)}
        className={`flex shrink-0 items-center justify-center ${accelerated ? "gap-1" : ""} rounded-full px-2 ${compact ? "h-8 min-w-8" : "py-1.5"} text-sm text-primary-700 transition-colors hover:bg-primary/5 dark:text-primary-300`}>
        {accelerated ? <BoltFill className="size-4 text-accent" /> : <Bolt className="size-4" />}
        {accelerated && <span className="font-medium text-accent">{selected.name}</span>}
      </Button>
      <DropdownWrapper isOpen={open} openUpward position={compact ? "right" : "left"} minWidth="min-w-48" role="menu" aria-label="Speed">
        <div className="grid auto-rows-fr">
          {options.map((tier) => (
            <Button key={tier.id} type="button" role="menuitemradio" aria-checked={tier.id === value}
              onClick={() => { onChange(tier.id); setOpen(false); }}
              className="flex min-h-11 w-full items-center gap-2 px-3 py-1 text-left text-primary-700 hover:bg-primary/5 dark:text-primary-300">
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{tier.name}</span>
                {tier.description && <span className="block text-xs text-primary-500">{tier.description}</span>}
              </span>
              {tier.id === value && <Check className="size-3.5 shrink-0" />}
            </Button>
          ))}
        </div>
      </DropdownWrapper>
    </div>
  );
}
