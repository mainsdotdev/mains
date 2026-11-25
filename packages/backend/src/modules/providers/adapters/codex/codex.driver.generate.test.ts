import fs from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexDriver } from "./codex.driver";
import { spawnProvider, killProviderProcess } from "../provider-process";
vi.mock("../provider-process", () => ({ spawnProvider: vi.fn(), killProviderProcess: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
function processFixture() {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
    vi.mocked(spawnProvider).mockReturnValue(child as unknown as ReturnType<typeof spawnProvider>);
    return child;
}
describe("Codex isolated one-shot generation", () => {
    it("uses the chosen model/effort in an empty read-only directory with work tools disabled", async () => {
        const child = processFixture();
        const driver = createCodexDriver({ binary: "fixture-codex" });
        const promise = driver.generateText!("profile", { model: "chosen-model", effort: "high", isolated: true, system: "Write only the welcome" });
        const [, args, options] = vi.mocked(spawnProvider).mock.calls[0];
        const argv = args as string[];
        expect(argv).toContain("chosen-model");
        expect(argv).toContain('model_reasoning_effort="high"');
        expect(argv).toContain("read-only");
        expect(argv).toContain("--ignore-user-config");
        expect(argv).toContain('web_search="disabled"');
        for (const feature of ["shell_tool", "unified_exec", "multi_agent", "apps", "plugins", "hooks", "computer_use", "image_generation"])
            expect(argv).toContain(`features.${feature}=false`);
        const cwd = String(options?.cwd);
        expect(fs.readdirSync(cwd)).toEqual([]);
        const output = argv[argv.indexOf("--output-last-message") + 1];
        fs.writeFileSync(output, "welcome");
        child.emit("close", 0);
        expect(await promise).toBe("welcome");
        expect(fs.existsSync(cwd)).toBe(false);
        await driver.shutdown?.();
    });
    it("kills and cleans up an interrupted generation instead of accepting late output", async () => {
        const child = processFixture(), controller = new AbortController();
        const driver = createCodexDriver({ binary: "fixture-codex" });
        const promise = driver.generateText!("profile", { isolated: true, signal: controller.signal });
        const rejected = expect(promise).rejects.toThrow("canceled");
        const cwd = String(vi.mocked(spawnProvider).mock.calls[0][2]?.cwd);
        controller.abort();
        child.emit("close", 0);
        await rejected;
        expect(killProviderProcess).toHaveBeenCalledWith(child);
        expect(fs.existsSync(cwd)).toBe(false);
        await driver.shutdown?.();
    });
});
