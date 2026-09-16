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

// The inspector proxy rejects debugger sockets without an Origin, and VS Code /
// Cursor's js-debug (which Expo Tools drives) sends none, so "Attach to app"
// fails. Expo CLI then drops any socket whose Origin host:port isn't exactly
// the dev server's (127.0.0.1:8081), so the Origin is taken from the Host the
// client addressed — js-debug sends `bundlerHost:bundlerPort` from launch.json.
// Browsers always send Origin, so only Origin-less clients are touched.
const { Server: WebSocketServer } = require(
  require.resolve("ws", { paths: [require.resolve("@react-native/dev-middleware")] }),
);
const handleUpgrade = WebSocketServer.prototype.handleUpgrade;
WebSocketServer.prototype.handleUpgrade = function (req, ...rest) {
  if (!req.headers.origin && req.headers.host && req.url?.startsWith("/inspector/debug")) {
    req.headers.origin = `http://${req.headers.host}`;
  }
  return handleUpgrade.call(this, req, ...rest);
};

module.exports = config;
