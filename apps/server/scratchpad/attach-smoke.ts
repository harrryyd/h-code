/**
 * Attach-mode smoke: exercises an ALREADY-RUNNING server over the network.
 * Auth via a pairing token, then WS RPC round-trips.
 *
 * Usage: node scratchpad/attach-smoke.ts <httpBaseUrl> <pairingToken>
 *   e.g. node scratchpad/attach-smoke.ts http://localhost:13773 RABLQH52KMED
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import { WsRpcGroup } from "@t3tools/contracts";

const baseUrl = process.argv[2];
const pairingToken = process.argv[3];
if (!baseUrl || !pairingToken) {
  console.error("usage: node attach-smoke.ts <httpBaseUrl> <pairingToken>");
  process.exit(2);
}

interface StepResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
}
const results: StepResult[] = [];

const step = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
  options?: { timeoutSeconds?: number; describe?: (value: A) => string },
): Effect.Effect<A | undefined, never, R> =>
  Effect.gen(function* () {
    const timeoutSeconds = options?.timeoutSeconds ?? 15;
    const start = Date.now();
    const exit = yield* Effect.exit(
      effect.pipe(Effect.timeoutOption(Duration.seconds(timeoutSeconds))),
    );
    const ms = Date.now() - start;
    if (Exit.isSuccess(exit)) {
      if (Option.isNone(exit.value)) {
        results.push({ name, ok: false, detail: `HANG — no response after ${timeoutSeconds}s`, ms });
        return undefined;
      }
      const value = exit.value.value;
      results.push({ name, ok: true, detail: options?.describe ? options.describe(value) : "ok", ms });
      return value;
    }
    results.push({ name, ok: false, detail: Cause.pretty(exit.cause).split("\n").slice(0, 8).join("\n"), ms });
    return undefined;
  });

const fetchJson = (url: string, init?: RequestInit) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), ...init });
      const text = await response.text();
      let body: any = null;
      try {
        body = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: response.status, body, setCookie: response.headers.get("set-cookie") };
    },
    catch: (cause) => new Error(`fetch ${url} failed: ${cause}`),
  });

const wsProtocolLayer = (wsUrl: string, cookie: string | null) => {
  const ctor = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl: string, protocols?: string | string[]) =>
      new NodeSocket.NodeWS.WebSocket(
        socketUrl,
        protocols,
        cookie ? { headers: { cookie } } : undefined,
      ) as unknown as globalThis.WebSocket,
  );
  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(wsUrl).pipe(Layer.provide(ctor))),
    Layer.provide(RpcSerialization.layerJson),
  );
};

const program = Effect.gen(function* () {
  const auth = yield* step(
    "auth: pairing token -> session cookie",
    Effect.gen(function* () {
      for (const path of ["/api/auth/browser-session", "/api/auth/bootstrap"]) {
        const result = yield* fetchJson(`${baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credential: pairingToken }),
        });
        if (result.status === 404) continue;
        if (result.status !== 200 || !result.setCookie) {
          return yield* Effect.fail(new Error(`POST ${path} -> ${result.status} ${JSON.stringify(result.body)}`));
        }
        return { path, cookie: result.setCookie.split(";")[0]! };
      }
      return yield* Effect.fail(new Error("no auth endpoint responded"));
    }),
    { describe: (a) => `via ${a.path}` },
  );
  if (!auth) return;

  const ticket = yield* step(
    "ws-ticket",
    Effect.gen(function* () {
      const candidates = [
        { path: "/api/auth/websocket-ticket", field: "ticket", param: "wsTicket" },
        { path: "/api/auth/ws-token", field: "token", param: "wsToken" },
      ] as const;
      for (const candidate of candidates) {
        const result = yield* fetchJson(`${baseUrl}${candidate.path}`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: auth.cookie },
          body: JSON.stringify({}),
        });
        if (result.status === 404) continue;
        const value = result.body?.[candidate.field];
        if (result.status !== 200 || typeof value !== "string") {
          return yield* Effect.fail(new Error(`POST ${candidate.path} -> ${result.status} ${JSON.stringify(result.body)}`));
        }
        return { ...candidate, value };
      }
      return yield* Effect.fail(new Error("no ws credential endpoint responded"));
    }),
    { describe: (c) => `via ${c.path}` },
  );
  if (!ticket) return;

  const wsBase = baseUrl.replace(/^http/, "ws");
  const wsUrl = `${wsBase}/ws?${ticket.param}=${encodeURIComponent(ticket.value)}`;

  yield* Effect.scoped(
    RpcClient.make(WsRpcGroup).pipe(
      Effect.flatMap((rpcClient) =>
        Effect.gen(function* () {
          const client = rpcClient as any;
          yield* step(
            "getConfig",
            client["server.getConfig"]({}),
            {
              describe: (cfg: any) =>
                `providers=[${(cfg?.providers ?? [])
                  .map((p: any) => `${p.instanceId}:${p.status}`)
                  .join(", ")}]`,
            },
          );
          yield* step(
            "subscribeServerConfig snapshot",
            client["subscribeServerConfig"]({}).pipe(Stream.take(1), Stream.runCollect),
            {
              describe: (events: any) => `first=${Array.from(events as Iterable<any>)[0]?.type ?? "?"}`,
            },
          );
          yield* step(
            "subscribeShell snapshot",
            client["orchestration.subscribeShell"]({}).pipe(Stream.take(1), Stream.runCollect),
            { describe: () => "ok" },
          );
        }),
      ),
      Effect.provide(wsProtocolLayer(wsUrl, auth.cookie)),
    ),
  );
}).pipe(
  Effect.onExit((exit) =>
    Effect.sync(() => {
      console.log("\n===== ATTACH SMOKE RESULTS =====");
      for (const r of results) {
        console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.ms}ms)`);
        if (!r.ok || r.detail !== "ok") console.log(`      ${r.detail.split("\n").join("\n      ")}`);
      }
      if (Exit.isFailure(exit)) console.log(`PROGRAM FAILURE:\n${Cause.pretty(exit.cause)}`);
      const pass = results.length > 0 && results.every((r) => r.ok) && Exit.isSuccess(exit);
      console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
      process.exit(pass ? 0 : 1);
    }),
  ),
);

NodeRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer))));
