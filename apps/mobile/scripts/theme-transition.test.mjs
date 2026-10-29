import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import React from "react";
import { act, create } from "react-test-renderer";
import ts from "typescript";
import { semanticPalette } from "../src/theme/semantic-palette.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
process.env.EXPO_OS = "android";
let scheme = "light";
const listeners = new Set();
globalThis.__mainsThemeTest = {
  subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot: () => scheme,
  // Fabric resolves an Android resource color when the prop is applied.
  // Identical props on an existing view are not reapplied by a theme event.
  resolve: (color) => color?.resource_paths
    ? semanticPalette[color.initialScheme][color.resource_paths[0].replace("@color/mains_", "").replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())]
    : color,
};
const nativeMock = `import React, { useSyncExternalStore } from "react";
  const state = globalThis.__mainsThemeTest;
  export const useColorScheme = () => useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  export const Platform = { OS: "android", select: values => values.android ?? values.default };
  export const PlatformColor = (...resource_paths) => ({ resource_paths, initialScheme: state.getSnapshot() });
  export const DynamicColorIOS = () => { throw new Error("iOS API on Android"); };
  const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {};
  const host = name => ({ style, children, ...props }) => {
    const resolved = Object.fromEntries(Object.entries(flatten(style)).map(([key, value]) => [key, state.resolve(value)]));
    return React.createElement(name, { ...props, style: resolved }, children);
  };
  export const View = host("View"); export const Text = host("Text");
  export const Pressable = host("Pressable"); export const Switch = host("Switch");
  export const StyleSheet = { create: value => value, hairlineWidth: 1 };`;
const mocks = {
  "react-native": nativeMock,
  "expo-router": `export const useRouter = () => ({ back() {}, push() {} });
    export const Color = { get ios() { throw new Error("iOS colors on Android"); }, android: { dynamic: {} } };`,
  "expo-router/stack": `import React from "react";
    export const Stack = Object.assign(props => React.createElement("Stack", props), { Screen: "Stack.Screen" });`,
  "react-native-drawer-layout": `export const useDrawerProgress = () => ({ value: 0 });`,
  "react-native-reanimated": `import { View } from "react-native";
    export default { View }; export const interpolate = () => 0;
    export const useAnimatedStyle = fn => fn();`,
  "@/features/ai-data-consent": `export const AiDataConsentProvider = ({ children }) => children;`,
};
const require = createRequire(import.meta.url);
const reactPaths = Object.fromEntries(["react", "react/jsx-runtime"].map((name) => [name, pathToFileURL(require.resolve(name)).href]));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" || specifier === "react/jsx-runtime") return {
      url: reactPaths[specifier], shortCircuit: true,
    };
    if (Object.hasOwn(mocks, specifier)) return {
      url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true,
    };
    if (specifier === "./sf-symbol" || specifier === "@/components/ui") return {
      url: "data:text/javascript," + encodeURIComponent(`export const SFSymbol = () => null;
        export { ThemedText } from ${JSON.stringify(new URL("../src/components/ui/themed-text.tsx", import.meta.url).href)};
        export { nativeSheetOptions } from ${JSON.stringify(new URL("../src/components/ui/native-sheet-options.ts", import.meta.url).href)};`),
      shortCircuit: true,
    };
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
      for (const suffix of [".ts", ".tsx", "/index.ts"]) {
        const url = new URL(base.href + suffix);
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const base = new URL(specifier, context.parentURL);
      for (const suffix of [".ts", ".tsx"]) {
        const url = new URL(base.href + suffix);
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});

const { Card } = await import("../src/components/ui/sheet-rows.tsx");
const { ThemedText } = await import("../src/components/ui/themed-text.tsx");
const { DesktopOutputNotice } = await import("../src/features/runs/components/outputs/output-file-card.tsx");
const change = async (next) => act(() => { scheme = next; for (const listener of listeners) listener(); });

test("an already mounted settings card and its text repaint on light → dark → light without remounting", async () => {
  scheme = "light";
  let mounts = 0;
  function Content() {
    React.useEffect(() => { mounts++; }, []);
    return React.createElement(ThemedText, null, "Settings row");
  }
  let renderer;
  await act(() => { renderer = create(React.createElement(Card, null, React.createElement(Content))); });
  try {
    assert.equal(renderer.root.findByType("View").props.style.backgroundColor, "#F7F7F8");
    await change("dark");
    assert.equal(renderer.root.findByType("View").props.style.backgroundColor, "#1C1C1E");
    assert.equal(renderer.root.findByType("Text").props.style.color, "#F2F2F7");
    assert.equal(mounts, 1);
    await change("light");
    assert.equal(renderer.root.findByType("View").props.style.backgroundColor, "#F7F7F8");
    assert.equal(renderer.root.findByType("Text").props.style.color, "#1C1C1E");
  } finally { await act(() => renderer.unmount()); }
});

test("file cards using StyleSheet colors repaint when the appearance changes", async () => {
  scheme = "light";
  let renderer;
  await act(() => { renderer = create(React.createElement(DesktopOutputNotice, { name: "report.html" })); });
  try {
    assert.equal(renderer.root.findAllByType("View")[0].props.style.backgroundColor, "#E5E5EA");
    await change("dark");
    assert.equal(renderer.root.findAllByType("View")[0].props.style.backgroundColor, "#2C2C2E");
  } finally { await act(() => renderer.unmount()); }
});

test("the mounted Android stack updates header and sheet props along with its content", async () => {
  scheme = "light";
  const { default: MainLayout } = await import("../src/app/(main)/_layout.tsx");
  let renderer;
  await act(() => { renderer = create(React.createElement(MainLayout)); });
  try {
    const stack = () => renderer.root.findByType("Stack");
    assert.equal(stack().props.screenOptions.headerTitleStyle.color, "#1C1C1E");
    await change("dark");
    assert.equal(stack().props.screenOptions.headerTitleStyle.color, "#F2F2F7");
    assert.equal(stack().props.screenOptions.headerStyle.backgroundColor, "#000000");
    const options = renderer.root.findAllByType("Stack.Screen").find(screen => screen.props.name === "run-options").props.options;
    assert.equal(options.contentStyle.backgroundColor, "#1C1C1E");
  } finally { await act(() => renderer.unmount()); }
});
