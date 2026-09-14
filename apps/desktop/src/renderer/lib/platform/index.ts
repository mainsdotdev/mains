export { isElectron, isWeb } from "./platform";
export { capabilities, type Capabilities } from "./capabilities";
export { useCapabilities } from "./use-capabilities";
export { useIsMobile } from "./use-breakpoint";

// Note: web-bootstrap.ts has import-time side effects (installs the window.api
// shim + transport in web mode); it is imported directly by main.tsx, NOT via
// this barrel, so importing platform helpers stays side-effect-free.
