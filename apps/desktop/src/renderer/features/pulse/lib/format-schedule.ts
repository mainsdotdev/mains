import type { PulseFrequency } from "@/lib/redux/api/pulseApi";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatTime(hour: number, minute: number): string {
  const m = minute.toString().padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m} ${period}`;
}

export function formatSchedule(args: {
  frequency: PulseFrequency;
  hour: number;
  minute: number;
  dayOfWeek?: number | null;
  short?: boolean;
}): string {
  const { frequency, hour, minute, dayOfWeek, short } = args;
  const time = formatTime(hour, minute);

  switch (frequency) {
    case "hourly":
      return "Every hour";
    case "daily":
      return `Daily at ${time}`;
    case "weekdays":
      return `Weekdays at ${time}`;
    case "weekly": {
      const day = dayOfWeek ?? 1;
      const dayName = (short ? DAY_NAMES_SHORT : DAY_NAMES)[day] ?? "Mon";
      return short
        ? `${dayName} ${time}`
        : `Weekly on ${dayName} at ${time}`;
    }
  }
}

export const FREQUENCY_OPTIONS: { value: PulseFrequency; label: string }[] = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
];

export const WEEK_DAYS: { value: number; label: string; short: string }[] = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];
