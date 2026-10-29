import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

const mocks = {
  "react-native": `export const Platform = { get OS() { return process.env.EXPO_OS; } };
    export const StyleSheet = { absoluteFill: {} };
    export const ScrollView = "ScrollView";
    export const useColorScheme = () => "light";`,
  "expo-router/stack": `export const Stack = Object.assign(() => null, { Screen: "Stack.Screen" });`,
  "react-native-drawer-layout": `export const useDrawerProgress = () => ({ value: 0 });`,
  "react-native-reanimated": `export default { View: "Animated.View" };
    export const interpolate = () => 0; export const useAnimatedStyle = (fn) => fn();`,
  "@/features/ai-data-consent": `export const AiDataConsentProvider = "AiDataConsentProvider";`,
  "@/theme": `export const useThemeColors = () => ({ systemBackground: "native:surface", sheetBackground: "native:sheet", label: "native:label" });
    export const shadows = {}; export const spacing = { xxl: 48, md: 16 };
    export const useBrandColors = () => ({ accent: "blue" });`,
  "react-native-safe-area-context": `export const useSafeAreaInsets = () => ({ bottom: 34 });`,
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(mocks, specifier)) return {
      url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true,
    };
    if (specifier === "@/components/ui") return {
      url: new URL("../src/components/ui/native-sheet-options.ts", import.meta.url).href, shortCircuit: true,
    };
    if (specifier === "./sheet-rows" && context.parentURL.endsWith("/sheet-scroll-view.tsx")) return {
      url: "data:text/javascript,export const sheetContentStyle = { padding: 16 };", shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.includes("/src/app/(main)/_layout.tsx") || url.endsWith("/sheet-scroll-view.tsx")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});

function screens(node, found = new Map()) {
  if (!node || typeof node !== "object") return found;
  if (node.type === "Stack.Screen") found.set(node.props.name, node.props.options);
  for (const child of [node.props?.children].flat(Infinity)) screens(child, found);
  return found;
}

const { default: MainLayout } = await import("../src/app/(main)/_layout.tsx");

test("every Android form sheet has an opaque surface, including permissions and subagents", () => {
  process.env.EXPO_OS = "android";
  const routes = screens(MainLayout());
  for (const name of ["target", "model", "run-options", "subagents", "ai-data-consent", "outputs"]) {
    const options = routes.get(name);
    assert.equal(options.presentation, "formSheet", name);
    assert.equal(options.contentStyle.backgroundColor, "native:sheet", name);
    assert.ok(options.sheetAllowedDetents.length <= 3, name);
  }
  assert.equal(routes.get("image/[artifactId]").presentation, "transparentModal");
});

test("iOS sheets retain Liquid Glass and their existing height stops", () => {
  process.env.EXPO_OS = "ios";
  const routes = screens(MainLayout());
  for (const name of ["target", "model", "run-options", "subagents", "ai-data-consent"]) {
    assert.equal(routes.get(name).contentStyle.backgroundColor, "transparent", name);
    assert.equal(routes.get(name).sheetGrabberVisible, true, name);
  }
  assert.deepEqual(routes.get("target").sheetAllowedDetents, [0.5, 1]);
  assert.deepEqual(routes.get("run-options").sheetAllowedDetents, [0.62, 1]);
});

test("Android sheet content fills its detent, supports nested scroll and clears the navigation bar", async () => {
  process.env.EXPO_OS = "android";
  const { SheetScrollView } = await import("../src/components/ui/sheet-scroll-view.tsx");
  const { props } = SheetScrollView({ children: "Sheet contents" });
  assert.equal(props.nestedScrollEnabled, true);
  assert.equal(props.style[0].flex, 1);
  assert.equal(Object.assign({}, ...props.contentContainerStyle).paddingBottom, 50);
  assert.equal(props.children, "Sheet contents");
});
