import { assert, describe, it } from "@effect/vitest";

import { missingRpcScopeDeclarations } from "./ws.ts";

describe("WS RPC authorization scopes", () => {
  it("declares a scope for every WsRpcGroup method", () => {
    assert.deepEqual(
      missingRpcScopeDeclarations(),
      [],
      "Add a RPC_REQUIRED_SCOPE entry for every listed method.",
    );
  });
});
