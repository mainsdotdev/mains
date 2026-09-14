import { describe, expect, it } from "vitest";
import type { PluginListResponse } from "@/lib/redux/api/providersApi";
import { buildPluginLogoMap } from "./use-plugin-logos";

describe("buildPluginLogoMap", () => {
  it("indexes remote app plugins by display name for codex_apps tool slugs", () => {
    const data: PluginListResponse = {
      marketplaces: [
        {
          name: "openai-curated-remote",
          path: "",
          interface: null,
          plugins: [
            {
              id: "app-694546cd042881919bb746a8dc300f38@openai-curated-remote",
              name: "app-694546cd042881919bb746a8dc300f38",
              source: { type: "remote", path: "" },
              installed: true,
              enabled: true,
              installPolicy: "AVAILABLE",
              authPolicy: "ON_INSTALL",
              interface: {
                displayName: "Skyscanner",
                capabilities: [],
                logo: "https://files.openai.com/skyscanner.png",
                screenshots: [],
              },
            },
          ],
        },
      ],
      marketplaceLoadErrors: [],
      remoteSyncError: null,
      featuredPluginIds: [],
    };

    expect(buildPluginLogoMap(data).get("skyscanner")).toMatchObject({
      name: "app-694546cd042881919bb746a8dc300f38",
      displayName: "Skyscanner",
      logo: "https://files.openai.com/skyscanner.png",
    });
  });
});
