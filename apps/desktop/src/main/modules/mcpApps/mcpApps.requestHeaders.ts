/** Present the embedded Chromium browser to vendor CDNs, which often reject Electron UAs. */
export function mcpAppBrowserHeaders(
  headers: Record<string, string>,
  appName: string,
): Record<string, string> {
  const result = { ...headers };
  const products = new Set(["electron", appName.toLowerCase()]);
  for (const [key, value] of Object.entries(result)) {
    if (key.toLowerCase() === "user-agent") {
      result[key] = value.split(" ").filter((part) => !products.has(part.split("/")[0].toLowerCase())).join(" ");
    } else if (key.toLowerCase() === "sec-ch-ua") {
      result[key] = value.split(",").filter((brand) =>
        !products.has((brand.trim().match(/^"([^"]+)"/)?.[1] ?? "").toLowerCase())).join(",");
    }
  }
  return result;
}
