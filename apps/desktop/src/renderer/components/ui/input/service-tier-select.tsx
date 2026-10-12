import { useRef, useState } from "react";
import type { ModelServiceTier } from "@mains/contracts/run-settings";
import { useClickOutside } from "@/hooks/use-click-outside";
import { Button } from "../button";
import DropdownWrapper from "../dropdown-wrapper";
import { BoltFill, Check } from "../icons";
import { Bolt } from "../icons/space";

export function ServiceTierSelect({ value, options, onChange }: {
  value: string;
  options: ModelServiceTier[];
  onChange: (id: string) => void;
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
        className={`flex items-center ${accelerated ? "gap-1" : ""} rounded-full px-2 py-1.5 text-sm text-primary-700 transition-colors hover:bg-primary/5 dark:text-primary-300`}>
        {accelerated ? <BoltFill className="size-4 text-accent" /> : <Bolt className="size-4" />}
        {accelerated && <span className="font-medium text-accent">{selected.name}</span>}
      </Button>
      <DropdownWrapper isOpen={open} openUpward minWidth="min-w-56" role="menu" aria-label="Speed">
        <div className="py-1">
          {options.map((tier) => (
            <Button key={tier.id} type="button" role="menuitemradio" aria-checked={tier.id === value}
              onClick={() => { onChange(tier.id); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-primary-700 hover:bg-primary/5 dark:text-primary-300">
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{tier.name}</span>
                {tier.description && <span className="mt-0.5 block text-xs text-primary-500">{tier.description}</span>}
              </span>
              {tier.id === value && <Check className="size-3.5 shrink-0" />}
            </Button>
          ))}
        </div>
      </DropdownWrapper>
    </div>
  );
}
