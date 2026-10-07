import type { Element, Root } from "hast";

const LITERAL_TAGS = new Set(["pre", "code", "math", "svg"]);

/** Stable word spans fade only as words arrive, rather than fading an entire
 * paragraph again on every chunk. Run before KaTeX and leave code/math alone. */
export function rehypeStreamingText() {
  return (tree: Root) => {
    function visit(parent: Root | Element): void {
      if (parent.type === "element" && LITERAL_TAGS.has(parent.tagName)) return;
      for (let index = 0; index < parent.children.length; index++) {
        const child = parent.children[index];
        if (child.type === "element") {
          visit(child);
        } else if (child.type === "text" && /\S/.test(child.value)) {
          // Structural whitespace must remain text, especially under tables
          // where a span is invalid and prevents react-markdown's cleanup.
          const words: Element[] = (child.value.match(/\S+\s*|\s+/g) ?? []).map((value) => ({
            type: "element",
            tagName: "span",
            properties: { className: ["stream-word"] },
            children: [{ type: "text", value }],
          }));
          parent.children.splice(index, 1, ...words);
          index += words.length - 1;
        }
      }
    }
    visit(tree);
  };
}
