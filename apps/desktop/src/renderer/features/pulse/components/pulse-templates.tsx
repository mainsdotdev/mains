import { Body, Button, Caption, Text } from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { iconColorClass } from "@/lib/icon-registry";
import { cn } from "@/lib/cn";
import { formatSchedule } from "../lib/format-schedule";
import { PULSE_CATEGORIES, type PulseTemplate } from "../templates";

/** Renders the templates it is given (already mode- and search-filtered), grouped by category. */
export function PulseTemplates({
  templates,
  onSelect,
}: {
  templates: PulseTemplate[];
  onSelect: (template: PulseTemplate) => void;
}) {
  const groups = PULSE_CATEGORIES.map((cat) => ({
    ...cat,
    items: templates.filter((t) => t.category === cat.id),
  })).filter((group) => group.items.length > 0);

  if (groups.length === 0) return null;

  return (
    <section>
      <Body weight="medium" className="mb-4 px-1">
        Suggestions
      </Body>

      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.id}>
            <Text
              as="h3"
              size="xs"
              tone="faint"
              weight="medium"
              className="mb-1 px-3"
            >
              {group.label}
            </Text>
            <ul>
              {group.items.map((tpl) => (
                <li key={tpl.id}>
                  <TemplateRow template={tpl} onSelect={() => onSelect(tpl)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function TemplateRow({
  template,
  onSelect,
}: {
  template: PulseTemplate;
  onSelect: () => void;
}) {
  const Icon = template.icon;
  const schedule = formatSchedule({
    frequency: template.defaultFrequency,
    hour: template.defaultHour,
    minute: template.defaultMinute,
    dayOfWeek: template.defaultDayOfWeek,
  });

  return (
    <Button
      onClick={onSelect}
      className="group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-primary-200/40 dark:hover:bg-primary-800/40 focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      {/* The plus takes the icon's place on hover/focus — same slot, crossfaded. */}
      <span aria-hidden className="relative size-4 shrink-0">
        <Icon
          className={cn(
            "absolute inset-0 size-4 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0",
            iconColorClass(template.tint),
          )}
        />
        <Plus className="absolute inset-0 size-4 text-primary-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-primary-200" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <Text as="span" className="truncate">
            {template.title}
          </Text>
          <Caption as="span" tone="faint" className="shrink-0 whitespace-nowrap">
            {schedule}
          </Caption>
        </span>
        <Caption as="span" tone="subtle" className="mt-0.5 block">
          {template.description}
        </Caption>
      </span>
    </Button>
  );
}
