import { describe, expect, it } from "vite-plus/test";

import { MethodRegistry } from "./methodRegistry.ts";

describe("MethodRegistry", () => {
  it("stores a value retrievable by get", () => {
    const registry = new MethodRegistry<string, number>();
    registry.register("foo", 42);
    expect(registry.get("foo")).toBe(42);
  });

  it("throws on duplicate key", () => {
    const registry = new MethodRegistry<string, number>();
    registry.register("foo", 42);
    expect(() => registry.register("foo", 99)).toThrow();
  });

  it("has returns true for registered key and false otherwise", () => {
    const registry = new MethodRegistry<string, number>();
    registry.register("foo", 42);
    expect(registry.has("foo")).toBe(true);
    expect(registry.has("bar")).toBe(false);
  });

  it("entries iterates all registered pairs", () => {
    const registry = new MethodRegistry<string, number>();
    registry.register("a", 1);
    registry.register("b", 2);

    const result = new Map(registry.entries());
    expect(result).toEqual(
      new Map([
        ["a", 1],
        ["b", 2],
      ]),
    );
  });
});
