import { describe, expect, it } from "vitest";
import { terminalShellSignals } from "./terminal-shell";

const idle = "\x1b]633;Mains;test;idle\x07";
const busy = "\x1b]633;Mains;test;busy\x07";

describe("private shell prompt signals", () => {
  it("starts unknown, tracks prompt/command transitions and strips only its own markers", () => {
    const signals = terminalShellSignals("test");
    expect(signals.atPrompt).toBeNull();
    expect(signals.consume(`before${idle}prompt`)).toBe("beforeprompt");
    expect(signals.atPrompt).toBe(true);
    expect(signals.consume(`${busy}output`)).toBe("output");
    expect(signals.atPrompt).toBe(false);
    const other = "\x1b]633;Mains;other;idle\x07";
    expect(signals.consume(`\x1b[31merror\x1b[0m${other}`)).toBe(`\x1b[31merror\x1b[0m${other}`);
    expect(signals.atPrompt).toBe(false);
    signals.consume(idle);
    signals.commandSent();
    expect(signals.atPrompt).toBe(false);
  });

  it("handles every chunk boundary without leaking a marker into replay output", () => {
    for (const marker of [idle, busy]) {
      for (let split = 1; split < marker.length; split++) {
        const signals = terminalShellSignals("test");
        const output = signals.consume(`before${marker.slice(0, split)}`) + signals.consume(`${marker.slice(split)}after`);
        expect(output).toBe("beforeafter");
        expect(signals.atPrompt).toBe(marker === idle);
      }
    }
  });

  it("handles several markers in one output event and releases an unrelated partial escape", () => {
    const signals = terminalShellSignals("test");
    expect(signals.consume(`${idle}a${busy}b${idle}c`)).toBe("abc");
    expect(signals.atPrompt).toBe(true);
    expect(signals.consume("\x1b")).toBe("");
    expect(signals.consume("[32mgreen")).toBe("\x1b[32mgreen");
  });
});
