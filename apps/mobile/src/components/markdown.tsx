import { Fragment, type ReactNode } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import Animated, {
  Easing,
  useReducedMotion,
  withTiming,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";

import { parseMarkdown, type Block, type Inline, type ListItem } from "@/lib/markdown";
import { prepareMathMarkdown } from "@/lib/math-markdown";
import { colors, motion, radius, spacing, useBrandColors } from "@/theme";

import MathMarkdown from "./math-markdown";
import { SFSymbol } from "./sf-symbol";
import { ThemedText } from "./themed-text";

/**
 * Agent prose, rendered onto the app's own type ramp.
 *
 * The desktop hands assistant text to `react-markdown` and lets a Tailwind
 * `prose` class style it; here each block maps to a `ThemedText` variant
 * instead, so a message sits on the same ramp as the rest of the app rather
 * than importing a second set of type decisions.
 */
export function Markdown({
  source,
  animateTail = false,
}: {
  source: string;
  /** Fade only the word currently being revealed by a live response. */
  animateTail?: boolean;
}) {
  const preparedMath = prepareMathMarkdown(source);
  if (preparedMath.hasMath) {
    return <MathMarkdown source={preparedMath.source} />;
  }

  const blocks = parseMarkdown(source);
  const tailNode = animateTail ? lastInlineLeafOfLastBlock(blocks) : null;
  return <BlockList blocks={blocks} tailNode={tailNode} />;
}

type InlineTextLeaf = Extract<Inline, { type: "text" | "code" }>;

function lastInlineLeaf(nodes: Inline[]): InlineTextLeaf | null {
  const node = nodes[nodes.length - 1];
  if (!node) return null;
  switch (node.type) {
    case "text":
    case "code":
      return node;
    case "strong":
    case "em":
    case "strike":
    case "link":
      return lastInlineLeaf(node.children);
  }
}

function lastInlineLeafOfLastBlock(blocks: Block[]): InlineTextLeaf | null {
  const block = blocks[blocks.length - 1];
  if (!block) return null;
  switch (block.type) {
    case "heading":
    case "paragraph":
      return lastInlineLeaf(block.inline);
    case "list":
      return lastInlineLeafOfLastBlock(block.items[block.items.length - 1]?.blocks ?? []);
    case "quote":
      return lastInlineLeafOfLastBlock(block.blocks);
    case "table": {
      const finalRow = block.rows[block.rows.length - 1] ?? block.header;
      return lastInlineLeaf(finalRow[finalRow.length - 1] ?? []);
    }
    case "code":
    case "rule":
      return null;
  }
}

function BlockList({ blocks, tailNode }: { blocks: Block[]; tailNode: InlineTextLeaf | null }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} tailNode={tailNode} />
      ))}
    </View>
  );
}

/**
 * Agent prose sits one step below `body`: a transcript is read at a glance and
 * scrolled, and 17pt turns a normal answer into several screens.
 */
const PROSE = "prose" as const;

/** Heading level → a step on the ramp. Levels past four all read as level four. */
const HEADING_VARIANTS = ["title3", "headline", "callout", "subhead"] as const;

function BlockView({ block, tailNode }: { block: Block; tailNode: InlineTextLeaf | null }) {
  switch (block.type) {
    case "heading": {
      const variant = HEADING_VARIANTS[Math.min(block.level, 4) - 1];
      return (
        <ThemedText
          variant={variant}
          selectable
          style={{ color: colors.label, fontWeight: "700", marginTop: spacing.xs }}
        >
          <InlineRun nodes={block.inline} tailNode={tailNode} />
        </ThemedText>
      );
    }

    case "paragraph":
      return (
        <ThemedText variant={PROSE} selectable>
          <InlineRun nodes={block.inline} tailNode={tailNode} />
        </ThemedText>
      );

    case "list":
      return (
        <View style={{ gap: spacing.xs }}>
          {block.items.map((item, i) => (
            <ListRow
              key={i}
              item={item}
              marker={block.ordered ? `${block.start + i}.` : "•"}
              tailNode={tailNode}
            />
          ))}
        </View>
      );

    case "code":
      return <CodeBlock text={block.text} />;

    case "quote":
      return (
        <View
          style={{
            borderLeftWidth: 3,
            borderLeftColor: colors.separator,
            paddingLeft: spacing.ms,
            gap: spacing.sm,
          }}
        >
          <BlockList blocks={block.blocks} tailNode={tailNode} />
        </View>
      );

    case "table":
      return <Table header={block.header} rows={block.rows} tailNode={tailNode} />;

    case "rule":
      return <View style={{ height: 1, backgroundColor: colors.separator, marginVertical: spacing.xs }} />;
  }
}

/** A list item: its marker in a fixed gutter, its blocks beside it. */
function ListRow({
  item,
  marker,
  tailNode,
}: {
  item: ListItem;
  marker: string;
  tailNode: InlineTextLeaf | null;
}) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      <View style={{ minWidth: 18, alignItems: "flex-end", paddingTop: item.checked === undefined ? 0 : 3 }}>
        {item.checked === undefined ? (
          <ThemedText variant={PROSE} style={{ color: colors.secondaryLabel }}>
            {marker}
          </ThemedText>
        ) : (
          <SFSymbol
            name={item.checked ? "checkmark.square.fill" : "square"}
            size={15}
            tint={item.checked ? colors.systemGreen : colors.tertiaryLabel}
          />
        )}
      </View>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <BlockList blocks={item.blocks} tailNode={tailNode} />
      </View>
    </View>
  );
}

/** A fenced block: monospaced, scrolled sideways so indentation survives. */
function CodeBlock({ text }: { text: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.secondarySystemBackground,
        borderRadius: radius.md,
        borderCurve: "continuous",
        paddingVertical: spacing.sm,
        overflow: "hidden",
      }}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ paddingHorizontal: spacing.ms }}>
          {text.split("\n").map((line, i) => (
            <ThemedText key={i} variant="mono" selectable style={{ color: colors.label }}>
              {line || " "}
            </ThemedText>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** GFM table. Columns keep a floor width and the whole grid scrolls sideways. */
function Table({
  header,
  rows,
  tailNode,
}: {
  header: Inline[][];
  rows: Inline[][][];
  tailNode: InlineTextLeaf | null;
}) {
  const columns = Math.max(header.length, ...rows.map((r) => r.length), 1);

  const cells = (row: Inline[][], head: boolean) => (
    <View style={{ flexDirection: "row" }}>
      {Array.from({ length: columns }, (_, c) => (
        <View
          key={c}
          style={{
            minWidth: 110,
            flex: 1,
            paddingVertical: spacing.xs + 2,
            paddingRight: spacing.ms,
          }}
        >
          <ThemedText
            variant="footnote"
            selectable
            style={{ color: colors.label, fontWeight: head ? "600" : "400" }}
          >
            <InlineRun nodes={row[c] ?? []} tailNode={tailNode} />
          </ThemedText>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.separator }}>
          {cells(header, true)}
        </View>
        {rows.map((row, i) => (
          <View
            key={i}
            style={{
              borderBottomWidth: i === rows.length - 1 ? 0 : 1,
              borderBottomColor: colors.separator,
            }}
          >
            {cells(row, false)}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * Inline runs, as nested `Text`.
 *
 * Everything below the block level has to stay inside one `Text` tree — a
 * `View` mid-sentence would break the line box — so emphasis, code and links
 * are text styles. Each node sets only its *delta* (weight, slant, color) and
 * never a size: RN inherits the rest, which is what lets a bold run inside an
 * h1 stay h1-sized instead of snapping back to body.
 */
function InlineRun({
  nodes,
  tailNode,
}: {
  nodes: Inline[];
  tailNode: InlineTextLeaf | null;
}): ReactNode {
  return nodes.map((node, i) => <InlineNode key={i} node={node} tailNode={tailNode} />);
}

function InlineNode({ node, tailNode }: { node: Inline; tailNode: InlineTextLeaf | null }) {
  const brand = useBrandColors();

  switch (node.type) {
    case "text":
      return node === tailNode ? <StreamingTailText text={node.text} /> : <Fragment>{node.text}</Fragment>;

    case "strong":
      return (
        <Text style={{ fontWeight: "700" }}>
          <InlineRun nodes={node.children} tailNode={tailNode} />
        </Text>
      );

    case "em":
      return (
        <Text style={{ fontStyle: "italic" }}>
          <InlineRun nodes={node.children} tailNode={tailNode} />
        </Text>
      );

    case "strike":
      return (
        <Text style={{ textDecorationLine: "line-through", color: colors.secondaryLabel }}>
          <InlineRun nodes={node.children} tailNode={tailNode} />
        </Text>
      );

    case "code":
      // No background: iOS paints a nested Text's background across the rest of
      // the line when the span wraps, which leaves a slab hanging off the end of
      // every wrapped code span. The face change carries the distinction alone.
      return (
        <Text style={{ fontFamily: "Menlo", color: colors.label }}>
          {node === tailNode ? <StreamingTailText text={node.text} /> : node.text}
        </Text>
      );

    case "link":
      return (
        <Text
          style={{ color: brand.accent }}
          onPress={() => {
            void Linking.openURL(node.href).catch(() => {});
          }}
        >
          <InlineRun nodes={node.children} tailNode={tailNode} />
        </Text>
      );
  }
}

/** A quiet tail: enough contrast to feel fluid, without making prose pulse. */
const STREAM_TAIL_ENTER: EntryExitAnimationFunction = () => {
  "worklet";
  const timing = {
    duration: motion.fast,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  };
  return {
    initialValues: {
      opacity: 0.24,
      transform: [{ translateY: 2 }],
    },
    animations: {
      opacity: withTiming(1, timing),
      transform: [{ translateY: withTiming(0, timing) }],
    },
  };
};

/** Keep very long unbroken strings (URLs/CJK) from fading as one large slab. */
function splitStreamingTail(text: string): [prefix: string, tail: string] {
  const match = /\S+\s*$/.exec(text);
  if (!match) return [text, ""];
  const word = match[0];
  const tail = Array.from(word).slice(-20).join("");
  return [text.slice(0, text.length - tail.length), tail];
}

function StreamingTailText({ text }: { text: string }) {
  const reduceMotion = useReducedMotion();
  const [prefix, tail] = splitStreamingTail(text);
  if (!tail) return <Fragment>{text}</Fragment>;

  return (
    <Fragment>
      {prefix}
      <Animated.Text key={text} entering={reduceMotion ? undefined : STREAM_TAIL_ENTER}>
        {tail}
      </Animated.Text>
    </Fragment>
  );
}
