"use dom";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import "katex/dist/katex.min.css";
import "./math-markdown-dom.css";

import { katexFontFaces } from "./katex-fonts";

interface MathMarkdownDomProps {
  source: string;
  dark: boolean;
  fontScale: number;
  openUrl: (url: string) => Promise<void>;
  onReady: (height: number) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}

/** One isolated rich-text surface for an assistant message containing TeX. */
export default function MathMarkdownDom({
  source,
  dark,
  fontScale,
  openUrl,
  onReady,
}: MathMarkdownDomProps) {
  const reportedReady = useRef(false);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;

    const reportReady = async () => {
      await document.fonts.ready;
      await nextPaint();
      await nextPaint();
      if (cancelled || reportedReady.current) return;

      reportedReady.current = true;
      const height = Math.ceil(
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      );
      await onReadyRef.current(height);
    };

    void reportReady();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <style>{katexFontFaces}</style>
      <div
        className={dark ? "math-markdown dark" : "math-markdown"}
        style={{ fontSize: `${16 * fontScale}px` }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  if (href) void openUrl(href);
                }}
              >
                {children}
              </a>
            ),
            // Match the native renderer's security posture: Markdown never
            // fetches a remote image merely because an agent wrote its URL.
            img: ({ alt }) => <span className="blocked-image">{alt || "Image"}</span>,
          }}
        >
          {source}
        </ReactMarkdown>
      </div>
    </>
  );
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
