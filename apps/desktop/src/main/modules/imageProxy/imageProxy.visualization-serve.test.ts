import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { signLocalVisualizationPath } from "./imageProxy.signing";
import {
  serveLocalVisualization,
  VISUALIZATION_CSP,
} from "./imageProxy.visualization-serve";

const tempDirs: string[] = [];

function writeFragment(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-viz-serve-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "visualization.html");
  fs.writeFileSync(filePath, contents);
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("serveLocalVisualization", () => {
  it("wraps a signed fragment with the host bridge and restrictive CSP", async () => {
    const filePath = writeFragment(
      '<section id="viz"><button class="btn btn-primary">Run</button></section>',
    );

    const response = await serveLocalVisualization(
      new URL(signLocalVisualizationPath(filePath)),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(
      VISUALIZATION_CSP,
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'none'",
    );
    expect(html).toContain('id="mains-visualization-root"');
    expect(html).toContain('id="viz"');
    expect(html).toContain('Object.defineProperty(window, "openai"');
    expect(html).toContain(':root[data-theme="dark"] body');
    expect(html).toContain(':root[data-theme="light"] body');
    expect(html).not.toMatch(
      /:root(?:\[data-theme="(?:dark|light)"\])?\s*\{[^}]*color-scheme:/,
    );
  });

  it("rejects full HTML documents instead of nesting privileged markup", async () => {
    const filePath = writeFragment(
      "<!doctype html><html><body>not a fragment</body></html>",
    );

    const response = await serveLocalVisualization(
      new URL(signLocalVisualizationPath(filePath)),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toBe("Expected an HTML fragment");
  });

  it("rejects unsigned requests", async () => {
    const filePath = writeFragment("<div>safe fragment</div>");
    const response = await serveLocalVisualization(
      new URL(`mains-visualize://view/?path=${encodeURIComponent(filePath)}`),
    );
    expect(response.status).toBe(403);
  });
});
