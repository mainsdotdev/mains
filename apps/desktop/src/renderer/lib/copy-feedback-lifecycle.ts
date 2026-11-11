export type CopyStatus = "idle" | "copied" | "error";

/** Native writes start in the user gesture; only the latest intent owns feedback. */
export function createCopyFeedbackLifecycle(options: {
  write(text: string): Promise<void>;
  publish(status: CopyStatus): void;
  duration(): number;
  success(text: string): void;
  error(error: Error): void;
}) {
  let active = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const retire = () => { generation++; clearTimeout(timer); timer = undefined; };

  return {
    async copy(text: string): Promise<boolean> {
      if (!active) return false;
      if (!text) { console.warn("useCopyToClipboard: Empty text provided"); return false; }
      retire();
      const attempt = generation;
      const current = () => active && attempt === generation;
      let error: Error | undefined;
      try { await options.write(text); }
      catch (cause) { error = cause instanceof Error ? cause : new Error(String(cause)); }
      if (current()) {
        options.publish(error ? "error" : "copied");
        try {
          if (error) { console.error("Failed to copy:", error.message); options.error(error); }
          else options.success(text);
        } catch (cause) { console.error("Copy feedback failed:", cause); }
        if (current()) timer = setTimeout(() => { if (current()) options.publish("idle"); }, options.duration());
      }
      return !error;
    },
    reset() { retire(); if (active) options.publish("idle"); },
    dispose() { active = false; retire(); },
  };
}
