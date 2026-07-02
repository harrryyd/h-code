import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { describe, expect, it } from "vite-plus/test";

import { RpcMethodRegistry } from "./rpcMethodRegistry.ts";

const TestPingRpc = Rpc.make("test.ping", { success: Schema.String });
const TestEchoRpc = Rpc.make("test.echo", { payload: Schema.Struct({ msg: Schema.String }) });

describe("RpcMethodRegistry", () => {
  it("register stores entry retrievable via getGroup, handlers, and getScopeMap", () => {
    const registry = new RpcMethodRegistry();
    const handler = (_input: unknown) => "pong";

    registry.register("test.ping", TestPingRpc, "orchestration:read" as const, handler);

    const group = registry.getGroup();
    expect(group.requests.has("test.ping")).toBe(true);

    const handlers = registry.handlers();
    expect(handlers["test.ping"]).toBe(handler);

    const scopeMap = registry.getScopeMap();
    expect(scopeMap.get("test.ping")).toBe("orchestration:read");
  });

  it("throws on re-registration of same method name", () => {
    const registry = new RpcMethodRegistry();
    registry.register("test.ping", TestPingRpc, "orchestration:read" as const, () => "pong");
    expect(() =>
      registry.register("test.ping", TestPingRpc, "orchestration:read" as const, () => "pong2"),
    ).toThrow();
  });

  it("getScopeMap returns entries for all registered methods", () => {
    const registry = new RpcMethodRegistry();
    registry.register("test.ping", TestPingRpc, "orchestration:read" as const, () => "pong");
    registry.register("test.echo", TestEchoRpc, "orchestration:operate" as const, () => "echo");

    const scopeMap = registry.getScopeMap();
    expect(scopeMap.size).toBe(2);
    expect(scopeMap.get("test.ping")).toBe("orchestration:read");
    expect(scopeMap.get("test.echo")).toBe("orchestration:operate");
  });

  it("handlers returns record keyed by method name", () => {
    const registry = new RpcMethodRegistry();
    const pingHandler = () => "pong";
    const echoHandler = () => "echo";

    registry.register("test.ping", TestPingRpc, "orchestration:read" as const, pingHandler);
    registry.register("test.echo", TestEchoRpc, "orchestration:operate" as const, echoHandler);

    const handlers = registry.handlers();
    expect(handlers["test.ping"]).toBe(pingHandler);
    expect(handlers["test.echo"]).toBe(echoHandler);
  });

  it("getGroup lazily builds RpcGroup from all registered schemas", () => {
    const registry = new RpcMethodRegistry();
    registry.register("test.ping", TestPingRpc, "orchestration:read" as const, () => "pong");
    registry.register("test.echo", TestEchoRpc, "orchestration:operate" as const, () => "echo");

    const group = registry.getGroup();
    expect(group.requests.size).toBe(2);
    expect(group.requests.has("test.ping")).toBe(true);
    expect(group.requests.has("test.echo")).toBe(true);
  });
});
