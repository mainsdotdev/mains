// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { isBrowserChatInteractiveTarget } from "./browser-chat-pointer";

afterEach(() => { document.body.replaceChildren(); });

describe("browser chat pointer hit testing", () => {
  it("passes transparent space through and captures the chat and portaled menus", () => {
    const root = document.createElement("div");
    root.id = "root";
    const stage = document.createElement("div");
    const surface = document.createElement("div");
    surface.dataset.browserChatSurface = "";
    const button = document.createElement("button");
    surface.append(button);
    stage.append(surface);
    root.append(stage);
    document.body.append(root);

    const menu = document.createElement("div");
    const option = document.createElement("button");
    menu.append(option);
    document.body.append(menu);

    expect(isBrowserChatInteractiveTarget(document.body, document)).toBe(false);
    expect(isBrowserChatInteractiveTarget(stage, document)).toBe(false);
    expect(isBrowserChatInteractiveTarget(button, document)).toBe(true);
    expect(isBrowserChatInteractiveTarget(option, document)).toBe(true);
  });
});
