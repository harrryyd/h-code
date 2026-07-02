/**
 * E2E smoke harness that boots the real server in-process and exercises the
 * WebSocket RPC paths the web app depends on.
 *
 * Usage (from apps/server):
 *   node scratchpad/e2e-smoke.ts
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as NetService from "@t3tools/shared/Net";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import { WsRpcGroup } from "@t3tools/contracts";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  deriveServerPaths,
  ensureServerDirectories,
  ServerConfig,
  type ServerConfigShape,
} from "../src/config.ts";
import { runServer } from "../src/server.ts";

const BOOTSTRAP_TOKEN = "e2e-smoke-bootstrap-token";
const STEP_TIMEOUT_SECONDS = 20;
const BOOT_TIMEOUT_SECONDS = 45;

const findFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as NodeNet.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });

interface StepResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
}

const results: StepResult[] = [];

class StepFailure extends Error {}

const step = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
  options?: { timeoutSeconds?: number; describe?: (value: A) => string },
): Effect.Effect<A | undefined, never, R> =>
  Effect.gen(function* () {
    const timeoutSeconds = options?.timeoutSeconds ?? STEP_TIMEOUT_SECONDS;
    const start = Date.now();
    const exit = yield* Effect.exit(
      effect.pipe(Effect.timeoutOption(Duration.seconds(timeoutSeconds))),
    );
    const ms = Date.now() - start;
    if (Exit.isSuccess(exit)) {
      if (Option.isNone(exit.value)) {
        results.push({
          name,
          ok: false,
          detail: `HANG - no response after ${timeoutSeconds}s`,
          ms,
        });
        return undefined;
      }
      const value = exit.value.value;
      results.push({
        name,
        ok: true,
        detail: options?.describe ? options.describe(value) : "ok",
        ms,
      });
      return value;
    }
    const detail = Cause.pretty(exit.cause).split("\n").slice(0, 12).join("\n");
    results.push({ name, ok: false, detail, ms });
    return undefined;
  });

const fetchJson = (
  url: string,
  init?: RequestInit,
): Effect.Effect<{ status: number; body: unknown; setCookie: string | null }, Error> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Number(process.env.SMOKE_FETCH_TIMEOUT_MS ?? "5000")),
        ...init,
      });
      const text = await response.text();
      let body: unknown = null;
      try {
        body = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return {
        status: response.status,
        body,
        setCookie: response.headers.get("set-cookie"),
      };
    },
    catch: (cause) => new Error(`fetch ${url} failed: ${cause}`),
  });

const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const wsProtocolLayer = (wsUrl: string, cookie: string | null) => {
  const webSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl: string, protocols?: string | string[]) =>
      new NodeSocket.NodeWS.WebSocket(
        socketUrl,
        protocols,
        cookie ? { headers: { cookie } } : undefined,
      ) as unknown as globalThis.WebSocket,
  );
  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(wsUrl).pipe(Layer.provide(webSocketConstructorLayer))),
    Layer.provide(RpcSerialization.layerJson),
  );
};

const program = Effect.gen(function* () {
  const port = yield* Effect.promise(findFreePort);
  const baseDir = yield* Effect.promise(() =>
    NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-e2e-smoke-")),
  );
  const workspaceRoot = yield* Effect.promise(() =>
    NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-e2e-smoke-workspace-")),
  );
  const derivedPaths = yield* deriveServerPaths(baseDir, undefined);
  yield* ensureServerDirectories(derivedPaths);
  const logLevel = (process.env.SMOKE_LOG_LEVEL ?? "Warn") as ServerConfigShape["logLevel"];
  const config: ServerConfigShape = {
    logLevel,
    traceMinLevel: logLevel,
    traceTimingEnabled: false,
    traceBatchWindowMs: 200,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 2,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 10_000,
    otlpServiceName: "t3-server-e2e-smoke",
    mode: "desktop",
    port,
    host: "127.0.0.1",
    cwd: workspaceRoot,
    baseDir,
    ...derivedPaths,
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    startupPresentation: "browser",
    desktopBootstrapToken: BOOTSTRAP_TOKEN,
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  };

  const serverFiber = yield* Effect.forkDetach(
    runServer.pipe(Effect.provideService(ServerConfig, config)),
  );

  const httpUrl = (pathname: string) => `http://127.0.0.1:${port}${pathname}`;
  const bootStart = Date.now();
  const pollUntilServing = Effect.gen(function* () {
    let attempts = 0;
    const delayMs = Number(process.env.SMOKE_FIRST_REQUEST_DELAY_MS ?? "0");
    if (delayMs > 0) {
      yield* Effect.sleep(Duration.millis(delayMs));
    }
    for (;;) {
      const result = yield* Effect.exit(fetchJson(httpUrl("/api/auth/session")));
      if (Exit.isSuccess(result) && result.value.status === 200) {
        return result.value.body;
      }
      attempts += 1;
      if (process.env.SMOKE_TRACE_BOOT === "1") {
        console.log(
          `[smoke] +${Date.now() - bootStart}ms attempt ${attempts}: ${
            Exit.isSuccess(result)
              ? `status=${result.value.status}`
              : Cause.pretty(result.cause).split("\n")[0]
          }`,
        );
      }
      yield* Effect.sleep(Duration.millis(250));
    }
  });

  const waitForBoot = Effect.raceFirst(
    pollUntilServing,
    Fiber.await(serverFiber).pipe(
      Effect.flatMap((exit) =>
        Effect.die(
          new Error(
            `server fiber exited during boot: ${Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "success"}`,
          ),
        ),
      ),
    ),
  );

  const bootBody = yield* step("boot: server serves /api/auth/session", waitForBoot, {
    timeoutSeconds: BOOT_TIMEOUT_SECONDS,
    describe: (body: any) => `policy=${body?.auth?.policy ?? "?"}`,
  });
  if (bootBody === undefined) {
    return;
  }

  const authenticate = Effect.gen(function* () {
    for (const path of ["/api/auth/browser-session", "/api/auth/bootstrap"]) {
      const result = yield* fetchJson(httpUrl(path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: BOOTSTRAP_TOKEN }),
      });
      if (result.status === 404) {
        continue;
      }
      if (result.status !== 200 || !result.setCookie) {
        return yield* Effect.fail(
          new StepFailure(
            `POST ${path} -> ${result.status} ${JSON.stringify(result.body)} (cookie=${result.setCookie})`,
          ),
        );
      }
      return { path, cookie: result.setCookie.split(";")[0]! };
    }
    return yield* Effect.fail(new StepFailure("no auth bootstrap endpoint responded"));
  });

  const auth = yield* step("auth: bootstrap credential -> session cookie", authenticate, {
    describe: (value) => `via ${value.path}`,
  });
  if (auth === undefined) {
    return;
  }

  const issueWsCredential = Effect.gen(function* () {
    const candidates = [
      { path: "/api/auth/websocket-ticket", field: "ticket", param: "wsTicket" },
      { path: "/api/auth/ws-token", field: "token", param: "wsToken" },
    ] as const;
    for (const candidate of candidates) {
      const result = yield* fetchJson(httpUrl(candidate.path), {
        method: "POST",
        headers: { "content-type": "application/json", cookie: auth.cookie },
        body: JSON.stringify({}),
      });
      if (result.status === 404) {
        continue;
      }
      const value = (result.body as Record<string, unknown> | null)?.[candidate.field];
      if (result.status !== 200 || typeof value !== "string") {
        return yield* Effect.fail(
          new StepFailure(
            `POST ${candidate.path} -> ${result.status} ${JSON.stringify(result.body)}`,
          ),
        );
      }
      return { ...candidate, value };
    }
    return yield* Effect.fail(new StepFailure("no ws credential endpoint responded"));
  });

  const wsCredential = yield* step("ws-ticket: issue WebSocket credential", issueWsCredential, {
    describe: (value) => `via ${value.path}`,
  });
  if (wsCredential === undefined) {
    return;
  }

  const wsUrl = `ws://127.0.0.1:${port}/ws?${wsCredential.param}=${encodeURIComponent(wsCredential.value)}`;

  yield* Effect.scoped(
    RpcClient.make(WsRpcGroup).pipe(
      Effect.flatMap((rpcClient) =>
        Effect.gen(function* () {
          const client = rpcClient as any;
          const serverConfig = yield* step(
            "getConfig: server.getConfig round-trip",
            client["server.getConfig"]({}),
            {
              describe: (cfg: any) =>
                `providers=[${(cfg?.providers ?? [])
                  .map(
                    (provider: any) =>
                      `${provider.instanceId}:${provider.status}:models=${provider.models?.length ?? 0}`,
                  )
                  .join(", ")}]`,
            },
          );

          yield* step(
            "subscribe: subscribeServerConfig emits snapshot",
            client["subscribeServerConfig"]({}).pipe(Stream.take(1), Stream.runCollect),
            {
              describe: (events: any) => {
                const first = Array.from(events as Iterable<any>)[0];
                return `first event type=${first?.type ?? "?"} providers=${first?.config?.providers?.length ?? "?"}`;
              },
            },
          );

          const projectId = id("project");
          const threadId = id("thread");
          const now = () => new Date().toISOString();

          yield* step(
            "project: dispatch project.create",
            client["orchestration.dispatchCommand"]({
              type: "project.create",
              commandId: id("cmd"),
              projectId,
              title: "e2e smoke project",
              workspaceRoot,
              createdAt: now(),
            }),
            { describe: (value: any) => `sequence=${value?.sequence}` },
          );

          const providers: any[] = (serverConfig as any)?.providers ?? [];
          const usable = providers.find(
            (provider) =>
              provider.installed &&
              provider.status === "ready" &&
              (provider.models?.length ?? 0) > 0,
          );
          const firstModel = usable?.models?.[0];
          const modelSelection = usable
            ? {
                instanceId: usable.instanceId,
                model:
                  typeof firstModel === "string"
                    ? firstModel
                    : (firstModel?.slug ?? firstModel?.id ?? firstModel?.model),
              }
            : { instanceId: "codex", model: "gpt-5.1-codex" };

          yield* step(
            "thread: dispatch thread.create",
            client["orchestration.dispatchCommand"]({
              type: "thread.create",
              commandId: id("cmd"),
              threadId,
              projectId,
              title: "e2e smoke thread",
              modelSelection,
              runtimeMode: "approval-required",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdAt: now(),
            }),
            {
              describe: (value: any) =>
                `sequence=${value?.sequence} model=${modelSelection.instanceId}/${modelSelection.model}`,
            },
          );

          yield* step(
            "send: dispatch thread.turn.start",
            client["orchestration.dispatchCommand"]({
              type: "thread.turn.start",
              commandId: id("cmd"),
              threadId,
              message: {
                messageId: id("message"),
                role: "user",
                text: "e2e smoke: reply with one word",
                attachments: [],
              },
              runtimeMode: "approval-required",
              interactionMode: "default",
              createdAt: now(),
            }),
            { describe: (value: any) => `sequence=${value?.sequence}` },
          );

          yield* step(
            "shell: subscribeShell snapshot includes project+thread",
            client["orchestration.subscribeShell"]({}).pipe(Stream.take(1), Stream.runCollect),
            {
              describe: (events: any) => {
                const first = Array.from(events as Iterable<any>)[0];
                const snapshot = first?.snapshot ?? first;
                const projects = snapshot?.projects?.length ?? "?";
                const threads = snapshot?.threads?.length ?? "?";
                return `projects=${projects} threads=${threads}`;
              },
            },
          );
        }),
      ),
      Effect.provide(wsProtocolLayer(wsUrl, auth.cookie)),
    ),
  );

  yield* Fiber.interrupt(serverFiber);
}).pipe(
  Effect.onExit((exit) =>
    Effect.sync(() => {
      const failed = results.filter((result) => !result.ok);
      console.log("\n========== E2E SMOKE RESULTS ==========");
      for (const result of results) {
        console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}  (${result.ms}ms)`);
        if (!result.ok || result.detail !== "ok") {
          console.log(`      ${result.detail.split("\n").join("\n      ")}`);
        }
      }
      if (Exit.isFailure(exit)) {
        console.log("PROGRAM FAILURE:");
        console.log(Cause.pretty(exit.cause));
      }
      console.log("=======================================");
      const pass = failed.length === 0 && results.length > 0 && Exit.isSuccess(exit);
      console.log(
        pass
          ? "RESULT: PASS"
          : `RESULT: FAIL (${failed.length} failed step(s), ${results.length} recorded)`,
      );
      process.exit(pass ? 0 : 1);
    }),
  ),
);

NodeRuntime.runMain(
  program.pipe(Effect.provide(NodeServices.layer), Effect.provide(NetService.layer)),
);
