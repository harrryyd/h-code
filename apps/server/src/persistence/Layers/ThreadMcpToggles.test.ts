import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ThreadMcpToggleRepository } from "../Services/ThreadMcpToggles.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ThreadMcpToggleRepositoryLive } from "./ThreadMcpToggles.ts";

const layer = it.layer(
  ThreadMcpToggleRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ThreadMcpToggleRepository", (it) => {
  it.effect("supports upsert, list, and delete CRUD flows", () =>
    Effect.gen(function* () {
      const repository = yield* ThreadMcpToggleRepository;
      const threadId = ThreadId.make("thread-mcp-crud");
      const providerKind = ProviderDriverKind.make("claudeAgent");

      yield* repository.upsert({
        threadId,
        providerKind,
        mcpServerName: "filesystem",
        enabled: true,
        updatedAt: "2026-05-25T00:00:00.000Z",
      });
      yield* repository.upsert({
        threadId,
        providerKind,
        mcpServerName: "filesystem",
        enabled: false,
        updatedAt: "2026-05-25T00:01:00.000Z",
      });
      yield* repository.upsert({
        threadId,
        providerKind,
        mcpServerName: "github",
        enabled: true,
        updatedAt: "2026-05-25T00:02:00.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.deepStrictEqual(rows, [
        {
          threadId,
          providerKind,
          mcpServerName: "filesystem",
          enabled: false,
          updatedAt: "2026-05-25T00:01:00.000Z",
        },
        {
          threadId,
          providerKind,
          mcpServerName: "github",
          enabled: true,
          updatedAt: "2026-05-25T00:02:00.000Z",
        },
      ]);

      yield* repository.deleteAllForThread({ threadId });
      assert.deepStrictEqual(yield* repository.listByThreadId({ threadId }), []);
    }),
  );
});
