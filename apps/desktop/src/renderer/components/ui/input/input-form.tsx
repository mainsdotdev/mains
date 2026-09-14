import { forwardRef, useCallback, useEffect, useRef } from "react";
import { useIsMobile, isWeb } from "@/lib/platform";
import Text from "../text";

interface InputFormProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}

export const InputForm = forwardRef<HTMLTextAreaElement, InputFormProps>(
  function InputForm(
    { query, onQueryChange, onSubmit, placeholder },
    ref,
  ) {
    const internalRef = useRef<HTMLTextAreaElement | null>(null);
    // Keyboard-only hint — hide on touch/mobile and in the browser.
    const showFocusHint = !useIsMobile() && !isWeb;

    const setRefs = useCallback(
      (node: HTMLTextAreaElement | null) => {
        internalRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.RefObject<HTMLTextAreaElement | null>).current = node;
        }
      },
      [ref],
    );

    const autoResize = useCallback(() => {
      const el = internalRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, []);

    useEffect(() => {
      autoResize();
    }, [query, autoResize]);

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        aria-label="Feed input form"
        className="relative"
      >
        <textarea
          ref={setRefs}
          value={query}
          rows={1}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          className="rounded-2xl w-full pl-5 pr-20 pt-4 text-sm placeholder:text-sm outline-none resize-none overflow-hidden
          dark:text-primary-300 text-primary-700 placeholder:text-primary-500 dark:placeholder:text-primary-500"
        />
        {showFocusHint && (
          <Text
            as="kbd"
            size="xxs"
            tone="subtle"
            className="absolute cursor-default right-4 top-4 px-1.5 py-0.5 font-sans"
          >
            ⌘ P to focus
          </Text>
        )}
      </form>
    );
  },
);
