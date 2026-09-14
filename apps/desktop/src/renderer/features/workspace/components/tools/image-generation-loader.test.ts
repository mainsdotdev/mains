import { describe, expect, it } from "vitest";
import { getImageGenerationStage } from "./image-generation-loader";

describe("getImageGenerationStage", () => {
  it("advances through client-side image-generation copy by elapsed time", () => {
    expect(getImageGenerationStage(0)).toBe("Creating image");
    expect(getImageGenerationStage(7_999)).toBe("Creating image");
    expect(getImageGenerationStage(8_000)).toBe("Building the scene");
    expect(getImageGenerationStage(19_999)).toBe("Building the scene");
    expect(getImageGenerationStage(20_000)).toBe("Polishing details");
    expect(getImageGenerationStage(120_000)).toBe("Polishing details");
  });
});
