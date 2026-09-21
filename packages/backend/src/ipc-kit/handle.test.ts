import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handle } from "./handle";

describe("handle", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("wraps a resolved value in ok()", async () => {
    const wrapped = handle(async (n: number) => n * 2);
    expect(await wrapped(null, 21)).toEqual({ success: true, data: 42 });
  });

  it("drops the IPC context argument", async () => {
    const fn = vi.fn().mockResolvedValue("x");
    await handle(fn)({ sender: "electron-event" }, "a", "b");
    expect(fn).toHaveBeenCalledWith("a", "b");
  });

  it("wraps a throw in fail() with the message", async () => {
    const wrapped = handle(async () => {
      throw new Error("boom");
    });
    expect(await wrapped(null)).toEqual({ success: false, error: "boom" });
  });

  // Absence is a state the app handles (a workspace folder deleted under it, a
  // file removed between listing and reading). Logging it as an error buried the
  // real defects, so it logs one quiet line instead — the caller still fails.
  describe("expected absences", () => {
    const absences = [
      ["ENOENT errno", Object.assign(new Error("stat failed"), { code: "ENOENT" })],
      ["ENOTDIR errno", Object.assign(new Error("bad path"), { code: "ENOTDIR" })],
      ["mapped message", new Error("Directory does not exist")],
      ["fs phrasing", new Error("no such file or directory")],
      [
        "workspace run-start guard",
        new Error(
          '"Ghost" points at a folder that no longer exists: /repos/gone. ' +
            "Move it back, or delete the workspace.",
        ),
      ],
    ] as const;

    for (const [label, error] of absences) {
      it(`warns without a stack for ${label}`, async () => {
        const result = await handle(async () => {
          throw error;
        })(null);

        expect(result).toEqual({ success: false, error: error.message });
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        // The message, not the error object — an errno dump is what made these
        // read as defects.
        expect(warnSpy.mock.calls[0]).toEqual([
          `[ipc] handler failed: ${error.message}`,
        ]);
      });
    }

    it("still logs a real failure as an error, with the object", async () => {
      const error = new Error("undefined is not a function");
      await handle(async () => {
        throw error;
      })(null);

      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith("[ipc] handler failed:", error);
    });

    it("treats a non-Error throw as unexpected", async () => {
      const result = await handle(async () => {
        throw "does not exist";
      })(null);

      expect(result).toEqual({ success: false, error: "does not exist" });
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
