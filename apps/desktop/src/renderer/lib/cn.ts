import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["xt", "t", "xxs", "xs", "s", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"] },
      ],
    },
  },
});

export function cn(
  ...inputs: (ClassValue | ClassDictionary | ClassArray)[]
): string {
  const classes: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === "string") {
      classes.push(input);
    } else if (Array.isArray(input)) {
      const inner = cn(...input);
      if (inner) classes.push(inner);
    } else if (typeof input === "object") {
      for (const key in input) {
        if (input[key]) {
          classes.push(key);
        }
      }
    }
  }

  return twMerge(classes.join(" "));
}

type ClassValue = string | number | boolean | undefined | null;
type ClassDictionary = Record<string, boolean | undefined | null>;
type ClassArray = ClassValue[];
