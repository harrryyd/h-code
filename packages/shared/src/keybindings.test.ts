import { describe, expect, it } from "vitest";

import { DEFAULT_KEYBINDINGS } from "./keybindings.ts";

describe("DEFAULT_KEYBINDINGS", () => {
  it("includes todo.toggle bound to mod+l", () => {
    const todoBinding = DEFAULT_KEYBINDINGS.find((rule) => rule.command === "todo.toggle");
    expect(todoBinding).toBeDefined();
    expect(todoBinding!.key).toBe("mod+l");
    expect(todoBinding!.when).toBe("!terminalFocus");
  });
});
