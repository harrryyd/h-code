import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LogLevel from "effect/LogLevel";
import * as Option from "effect/Option";

import { ServerConfig } from "../src/config.ts";
import { resolveServerConfig, type CliServerFlags } from "../src/cli/config.ts";
import { SeededWorkItemWritebackLive } from "../src/orchestration/Layers/SeededWorkItemWriteback.ts";
import { debugWsRuntimeLayer } from "../src/server.ts";
import { debugBuildWsRpcContext } from "../src/ws.ts";

const cliRuntimeLayer = Layer.mergeAll(
  NodeServices.layer,
  NetService.layer,
  SeededWorkItemWritebackLive,
);

const flags: CliServerFlags = {
  mode: Option.none(),
  port: Option.none(),
  host: Option.none(),
  baseDir: Option.none(),
  cwd: Option.some(process.cwd()),
  devUrl: Option.none(),
  noBrowser: Option.some(true),
  bootstrapFd: Option.none(),
  autoBootstrapProjectFromCwd: Option.some(false),
  logWebSocketEvents: Option.some(true),
  tailscaleServeEnabled: Option.none(),
  tailscaleServePort: Option.none(),
};

const session = {
  sessionId: "debug-session",
  subject: "debug-subject",
  method: "browser-session-cookie",
  scopes: [],
} as const;

const program = Effect.gen(function* () {
  const config = yield* resolveServerConfig(flags, Option.some(LogLevel.Debug));
  yield* Effect.logDebug("[DEBUG-ws-rpc-harness] config resolved", {
    cwd: config.cwd,
    baseDir: config.baseDir,
    port: config.port,
  });

  const runtimeContext = yield* Layer.build(
    debugWsRuntimeLayer.pipe(Layer.provide(Layer.succeed(ServerConfig, config))),
  ).pipe(
    Effect.scoped,
    Effect.timeoutOption(Duration.seconds(3)),
  );

  if (Option.isNone(runtimeContext)) {
    yield* Effect.logError("[DEBUG-ws-rpc-harness] runtime layer build timed out", {
      sessionId: session.sessionId,
    });
    return;
  }

  yield* Effect.logInfo("[DEBUG-ws-rpc-harness] runtime layer built", {
    sessionId: session.sessionId,
  });

  const result = yield* debugBuildWsRpcContext(session).pipe(
    Effect.provide(runtimeContext.value),
    Effect.timeoutOption(Duration.seconds(3)),
  );

  if (Option.isNone(result)) {
    yield* Effect.logError("[DEBUG-ws-rpc-harness] ws rpc context build timed out", {
      sessionId: session.sessionId,
    });
    return;
  }

  yield* Effect.logInfo("[DEBUG-ws-rpc-harness] ws rpc context built", {
    sessionId: session.sessionId,
  });
}).pipe(Effect.provide(cliRuntimeLayer));

NodeRuntime.runMain(program);
