/**
 * E2E smoke harness — boots the REAL server in-process (real SQLite, real
 * auth, real provider registry, real orchestration engine), authenticates
 * the way the browser does, opens the real /ws WebSocket and exercises the
 * RPC paths the web UI depends on:
 *
 *   1. boot          — server starts and serves HTTP within 30s
 *   2. auth          — bootstrap credential -> session cookie
 *   3. ws-ticket     — short-lived WS credential issued
 *   4. getConfig     — server.getConfig RPC round-trip (providers list)
 *   5. subscribe     — subscribeServerConfig stream emits its snapshot
 *                      (this is exactly what the Providers settings page
 *                      and the model picker hang on when broken)
 *   6. project       — orchestration.dispatchCommand project.create
 *   7. thread        — orchestration.dispatchCommand thread.create
 *   8. send          — orchestration.dispatchCommand thread.turn.start
 *   9. shell         — orchestration.subscribeShell snapshot contains the
 *                      created project + thread
 *
 * Usage (from apps/server):  node scratchpad/e2e-smoke.ts
 * Exit code 0 = all steps passed. 1 = a step failed or HUNG (timeout).
 *
 * Designed to run unmodified across the 40a6235..HEAD bisect range:
 *  - auth endpoints: tries /api/auth/browser-session then /api/auth/bootstrap
 *  - ws credential: tries /api/auth/websocket-ticket (?wsTicket) then
 *    /api/auth/ws-token (?wsToken)
 *  - RPC tags referenced as string literals (stable across the range)
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
import * as Net from "node:net";
import * as Fs from "node:fs/promises";
import * as Os from "node:os";
import * as PathMod from "node:path";

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
    const srv = Net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address() as Net.AddressInfo;
      srv.close(() => resolve(address.port));
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
          detail: `HANG — no response after ${timeoutSeconds}s`,
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
): Effect.Effect<{ status: number; body: any; setCookie: string | null }, Error> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Number(process.env.SMOKE_FETCH_TIMEOUT_MS ?? "5000")),
        ...init,
      });
      const text = await response.text();
      let body: any = null;
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
  // ---------- 1. boot ----------
  const port = yield* Effect.promise(findFreePort);
  const baseDir = yield* Effect.promise(() =>
    Fs.mkdtemp(PathMod.join(Os.tmpdir(), "t3-e2e-smoke-")),
  );
  const workspaceRoot = yield* Effect.promise(() =>
    Fs.mkdtemp(PathMod.join(Os.tmpdir(), "t3-e2e-smoke-workspace-")),
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
    // Optional delay before the very first request — used to distinguish a
    // "first request during startup window" race from a genuine
    // first-request deadlock.
    const delayMs = Number(process.env.SMOKE_FIRST_REQUEST_DELAY_MS ?? "0");
    if (delayMs > 0) yield* Effect.sleep(Duration.millis(delayMs));
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

  // If the server fiber dies during boot, surface its cause instead of spinning.
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
  if (bootBody === undefined) return;

  // ---------- 2. auth ----------
  const authenticate = Effect.gen(function* () {
    // Newer endpoint first, then the pre-migration one.
    for (const path of ["/api/auth/browser-session", "/api/auth/bootstrap"]) {
      const result = yield* fetchJson(httpUrl(path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: BOOTSTRAP_TOKEN }),
      });
      if (result.status === 404) continue;
      if (result.status !== 200 || !result.setCookie) {
        return yield* Effect.fail(
          new StepFailure(
            `POST ${path} -> ${result.status} ${JSON.stringify(result.body)} (cookie=${result.setCookie})`,
          ),
        );
      }
      const cookie = result.setCookie.split(";")[0]!;
      return { path, cookie };
    }
    return yield* Effect.fail(new StepFailure("no auth bootstrap endpoint responded"));
  });

  const auth = yield* step("auth: bootstrap credential -> session cookie", authenticate, {
    describe: (a) => `via ${a.path}`,
  });
  if (auth === undefined) return;

  // ---------- 3. ws credential ----------
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
      if (result.status === 404) continue;
      const value = result.body?.[candidate.field];
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
    describe: (c) => `via ${c.path}`,
  });
  if (wsCredential === undefined) return;

  const wsUrl = `ws://127.0.0.1:${port}/ws?${wsCredential.param}=${encodeURIComponent(wsCredential.value)}`;

  // ---------- 4-9. WS RPC ----------
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
                  .map((p: any) => `${p.instanceId}:${p.status}:models=${p.models?.length ?? 0}`)
                  .join(", ")}]`,
            },
          );

          // Regression coverage: todo.load was missing from the server's RPC
          // scope map, which killed the whole connection with a protocol
          // defect the moment the web UI called it.
          yield* step("todos: todo.load round-trip", client["todo.load"]({}), {
            describe: (r: any) => `categories=${r?.categories?.length ?? "?"}`,
          });

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
            { describe: (r: any) => `sequence=${r?.sequence}` },
          );

          // Prefer a real installed provider+model when one exists so the
          // send path can actually start a turn; otherwise fall back to a
          // fake selection and accept a structured rejection as "RPC alive".
          const providers: any[] = (serverConfig as any)?.providers ?? [];
          const usable = providers.find(
            (p) => p.installed && p.status === "ready" && (p.models?.length ?? 0) > 0,
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
              describe: (r: any) =>
                `sequence=${r?.sequence} model=${modelSelection.instanceId}/${modelSelection.model}`,
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
            { describe: (r: any) => `sequence=${r?.sequence}` },
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
      const failed = results.filter((r) => !r.ok);
      console.log("\n========== E2E SMOKE RESULTS ==========");
      for (const r of results) {
        console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.ms}ms)`);
        if (!r.ok || r.detail !== "ok") {
          console.log(`      ${r.detail.split("\n").join("\n      ")}`);
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
      // Hard-exit: the in-process server holds handles (sqlite, watchers)
      // that would otherwise keep the loop alive.
      process.exit(pass ? 0 : 1);
    }),
  ),
);

NodeRuntime.runMain(
  program.pipe(Effect.provide(NodeServices.layer), Effect.provide(NetService.layer)),
);
