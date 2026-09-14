const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// KaTeX fonts are explicit DOM-component assets; Metro does not classify WOFF2
// as an asset by default, so static requires cannot otherwise bundle them.
config.resolver.assetExts = [...config.resolver.assetExts, "woff2"];

// The @mains/* packages are file:-linked from outside the app root. There
// are no npm workspaces here (each app keeps its own node_modules), so Expo's
// monorepo auto-detection doesn't see them — Metro must watch their source.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../../packages")];

module.exports = config;
