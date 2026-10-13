// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ServiceTierSelect } from "./service-tier-select";
import { CompactComposerControls } from "./compact-composer-controls";

afterEach(cleanup);
const options = [{ id: "default", name: "Standard" }, { id: "fast", name: "Fast" },
  { id: "ultrafast", name: "Ultrafast", description: "Higher usage" }];

describe("model speed controls", () => {
  it("selects Ultrafast and can explicitly restore Standard", () => {
    const onChange = vi.fn();
    const view = render(<ServiceTierSelect value="default" options={options} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Speed: Standard" }).textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Speed: Standard" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Ultrafast/ }));
    expect(onChange).toHaveBeenLastCalledWith("ultrafast");
    view.rerender(<ServiceTierSelect value="ultrafast" options={options} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Speed: Ultrafast" }).textContent).toBe("Ultrafast");
    fireEvent.click(screen.getByRole("button", { name: "Speed: Ultrafast" }));
    expect(screen.getByRole("menuitemradio", { name: /Ultrafast/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Standard" }));
    expect(onChange).toHaveBeenLastCalledWith("default");
  });

  it("uses the same advertised options in the compact composer", () => {
    const onServiceTierChange = vi.fn();
    const props = { variant: "codex" as const, model: "GPT 6.1 Sol", models: [], onModelChange: vi.fn(), isLoadingModels: false,
      thinkingMode: false, effortLevel: "", onEffortLevelChange: vi.fn(), onThinkingModeToggle: vi.fn(),
      fastMode: false, supportsFastMode: true, onFastModeToggle: vi.fn(),
      serviceTier: "default", serviceTiers: options, onServiceTierChange };
    render(<CompactComposerControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /GPT 6.1 Sol/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Ultrafast/ }));
    expect(onServiceTierChange).toHaveBeenCalledWith("ultrafast");
    expect(props.onFastModeToggle).not.toHaveBeenCalled();
  });

  it("does not offer Ultrafast when the model omits it", () => {
    render(<ServiceTierSelect value="fast" options={options.slice(0, 2)} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Speed: Fast" }));
    expect(screen.queryByRole("menuitemradio", { name: /Ultrafast/ })).toBeNull();
  });
});
