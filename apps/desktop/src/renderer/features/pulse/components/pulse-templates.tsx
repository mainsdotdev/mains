import { Body, Button, Text } from "@/components/ui";
import { useModeConfig } from "@/hooks/use-mode-config";
import { PULSE_CATEGORIES, PULSE_TEMPLATES, type PulseTemplate } from "../templates";

export function PulseTemplates({
  onSelect,
}: {
  onSelect: (template: PulseTemplate) => void;
}) {
  const { mode } = useModeConfig();
  return (
    <div className="space-y-8">
      {PULSE_CATEGORIES.map((cat) => {
        const items = PULSE_TEMPLATES.filter(
          (t) => t.category === cat.id && (!t.modes || t.modes.includes(mode)),
        );
        if (items.length === 0) return null;
        return (
          <section key={cat.id}>
            <Body weight="medium" className="mb-3">
              {cat.label}
            </Body>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-8">
              {items.map((tpl) => (
                <Button
                  key={tpl.id}
                  className="rounded-4xl glass-surface px-4 py-6 cursor-pointer transition-colors flex items-center gap-3 text-left"
                  onClick={() => onSelect(tpl)}
                >
                  <div className="size-10 rounded-2xl flex items-center justify-center text-xl bg-primary-200/60 dark:bg-primary-800/60 shrink-0">
                    {tpl.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Text as="div" weight="medium" className="truncate mb-1">
                      {tpl.title}
                    </Text>
                    <Text as="div" size="xs" tone="subtle" className="line-clamp-2">
                      {tpl.description}
                    </Text>
                  </div>
                </Button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
