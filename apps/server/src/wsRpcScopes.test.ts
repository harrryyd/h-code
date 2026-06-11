import { assert, describe, it } from "@effect/vitest";

import { missingRpcScopeDeclarations } from "./ws.ts";

describe("WS RPC authorization scopes", () => {
  it("every method served by WsRpcGroup has a declared authorization scope", () => {
    // Regression test: a method missing from RPC_REQUIRED_SCOPE used to throw
    // at request time, surfacing as a connection-level protocol defect that
    // killed the entire WebSocket (and with it every in-flight subscription),
    // leaving the web app in a permanent reconnect loop ("Checking provider
    // status...", empty model picker, unable to send messages).
    assert.deepEqual(
      missingRpcScopeDeclarations(),
      [],
      "Add entries to RPC_REQUIRED_SCOPE in apps/server/src/ws.ts for the listed methods.",
    );
  });
});
