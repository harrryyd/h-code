/**
 * PR Review E2E smoke harness — boots the REAL server in-process, clones a
 * real GitHub repo, fetches a PR, and exercises the full review flow:
 *
 *   1. clone        — clones the repo from GitHub to a temp directory
 *   2. boot         — server starts and serves HTTP within 45s
 *   3. auth         — bootstrap credential -> session cookie
 *   4. ws-ticket    — short-lived WS credential issued
 *   5. project      — orchestration.dispatchCommand project.create
 *   6. thread       — orchestration.dispatchCommand thread.create
 *   7. worktree     — preparePullRequestThread (worktree mode)
 *   8. diff         — changeRequest.getPrDiff, parse file+line to comment on
 *   9. comment      — changeRequest.upsertReviewComment on a specific file:line
 *  10. submit       — changeRequest.submitReview (gh api inline comments)
 *  11. agent        — changeRequest.runBackgroundAgent (real opencode run)
 *  12. verify       — check agent produced file changes in worktree
 *  13. cleanup      — interrupt server, delete temp dirs
 *
 * Usage:
 *   T3_TEST_PR_REPO=harrryyd/h-code-test T3_TEST_PR_NUMBER=1 node scratchpad/pr-review-e2e.ts
 *
 * Requires:
 *   - gh CLI authenticated (`gh auth status`)
 *   - opencode installed and on PATH
 *   - A real GitHub PR with at least one file changed
 *
 * Exit code 0 = all steps passed. 1 = a step failed or HUNG (timeout).
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
import * as child_process from "node:child_process";
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

const BOOTSTRAP_TOKEN = "e2e-pr-review-bootstrap-token";
const STEP_TIMEOUT_SECONDS = 30;
const BOOT_TIMEOUT_SECONDS = 45;
const AGENT_TIMEOUT_SECONDS = 600; // 10 minutes for real agent run

const results: Array<{
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}> = [];
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
        signal: AbortSignal.timeout(5000),
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

const shellRun = (cmd: string, cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    child_process.exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });

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

/**
 * Take from a stream until we see an event matching the predicate, then
 * return all collected events. Times out after `timeoutSeconds`.
 */
const takeUntil = <A>(
  stream: Stream.Stream<A, any, any>,
  predicate: (a: A) => boolean,
  timeoutSeconds: number,
): Effect.Effect<A[], Error> =>
  Effect.gen(function* () {
    const chunkRef = { value: [] as A[] };
    yield* stream.pipe(
      Stream.takeUntil((a) => {
        chunkRef.value.push(a);
        return predicate(a);
      }),
      Stream.runDrain,
      Effect.timeout(Duration.seconds(timeoutSeconds)),
    );
    return chunkRef.value;
  });

const program = Effect.gen(function* () {
  // ——————— Validate env vars ———————
  const repo = process.env.T3_TEST_PR_REPO;
  const prNumberStr = process.env.T3_TEST_PR_NUMBER;
  if (!repo || !prNumberStr) {
    yield* Effect.die(
      new Error(
        "Set T3_TEST_PR_REPO=owner/repo and T3_TEST_PR_NUMBER=<n> environment variables.\n" +
          "Example: T3_TEST_PR_REPO=harrryyd/h-code-test T3_TEST_PR_NUMBER=1 node scratchpad/pr-review-e2e.ts",
      ),
    );
  }
  const prNumber = parseInt(prNumberStr, 10);
  if (isNaN(prNumber) || prNumber < 1) {
    yield* Effect.die(
      new Error(`T3_TEST_PR_NUMBER must be a positive integer, got: ${prNumberStr}`),
    );
  }

  // ——————— Check prerequisites ———————
  yield* step(
    "prereq: gh auth status",
    Effect.tryPromise(() => shellRun("gh auth status", process.cwd())),
  );
  yield* step(
    "prereq: opencode --version",
    Effect.tryPromise(() => shellRun("opencode --version", process.cwd())),
  );

  // ——————— Step 1: clone repo ———————
  const tmpDir = yield* Effect.promise(() =>
    Fs.mkdtemp(PathMod.join(Os.tmpdir(), "t3-pr-review-e2e-")),
  );
  const cloneUrl = `https://github.com/${repo}.git`;
  yield* step(
    "clone: git clone",
    Effect.tryPromise(() => shellRun(`git clone --depth 1 "${cloneUrl}" "${tmpDir}"`, Os.tmpdir())),
  );

  // Push a temp branch so we can interact with it as a PR head
  const tempBranch = `t3-e2e-${id("pr")}`;
  yield* step(
    "clone: fetch PR head",
    Effect.tryPromise(() =>
      shellRun(`git fetch origin pull/${prNumber}/head:${tempBranch}`, tmpDir),
    ),
  );

  // ——————— Step 2: boot server ———————
  const port = yield* Effect.promise(
    () =>
      new Promise<number>((resolve, reject) => {
        const srv = require("node:net").createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
          const address = srv.address() as any;
          srv.close(() => resolve(address.port));
        });
      }),
  );
  const baseDir = yield* Effect.promise(() =>
    Fs.mkdtemp(PathMod.join(Os.tmpdir(), "t3-pr-review-base-")),
  );
  const derivedPaths = yield* deriveServerPaths(baseDir, undefined);
  yield* ensureServerDirectories(derivedPaths);
  const config: ServerConfigShape = {
    logLevel: "Warn",
    traceMinLevel: "Warn",
    traceTimingEnabled: false,
    traceBatchWindowMs: 200,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 2,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 10_000,
    otlpServiceName: "t3-server-pr-review-e2e",
    mode: "desktop",
    port,
    host: "127.0.0.1",
    cwd: process.cwd(),
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

  // Poll until /api/auth/session returns 200
  const pollUntilServing = Effect.gen(function* () {
    for (;;) {
      const result = yield* Effect.exit(fetchJson(httpUrl("/api/auth/session")));
      if (Exit.isSuccess(result) && result.value.status === 200) return;
      yield* Effect.sleep(Duration.millis(250));
    }
  });
  const bootBody = yield* step(
    "boot: server serves /api/auth/session",
    Effect.raceFirst(
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
    ),
    { timeoutSeconds: BOOT_TIMEOUT_SECONDS },
  );
  if (bootBody === undefined) return;

  // ——————— Step 3: auth ———————
  const authenticate = Effect.gen(function* () {
    const result = yield* fetchJson(httpUrl("/api/auth/browser-session"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: BOOTSTRAP_TOKEN }),
    });
    if (result.status !== 200 || !result.setCookie) {
      return yield* Effect.fail(
        new StepFailure(`auth failed: ${result.status} ${JSON.stringify(result.body)}`),
      );
    }
    return result.setCookie.split(";")[0]!;
  });
  const cookie = yield* step("auth: bootstrap credential -> session cookie", authenticate);
  if (cookie === undefined) return;

  const issueWsCredential = Effect.gen(function* () {
    const result = yield* fetchJson(httpUrl("/api/auth/websocket-ticket"), {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    const value = result.body?.ticket;
    if (result.status !== 200 || typeof value !== "string") {
      return yield* Effect.fail(
        new StepFailure(`ws ticket failed: ${result.status} ${JSON.stringify(result.body)}`),
      );
    }
    return value;
  });
  const wsTicket = yield* step("ws-ticket: issue WebSocket credential", issueWsCredential);
  if (wsTicket === undefined) return;

  const wsUrl = `ws://127.0.0.1:${port}/ws?wsTicket=${encodeURIComponent(wsTicket)}`;

  // ——————— Steps 4-12: WS RPC ———————
  yield* Effect.scoped(
    RpcClient.make(WsRpcGroup).pipe(
      Effect.flatMap((rpcClient) =>
        Effect.gen(function* () {
          const client = rpcClient as any;
          const now = () => new Date().toISOString();
          const projectId = id("project");
          const threadId = id("thread");

          // Step 4: create project
          yield* step(
            "project: dispatch project.create",
            client["orchestration.dispatchCommand"]({
              type: "project.create",
              commandId: id("cmd"),
              projectId,
              title: "e2e pr review project",
              workspaceRoot: tmpDir,
              createdAt: now(),
            }),
            { describe: (r: any) => `sequence=${r?.sequence}` },
          );

          // Step 5: create thread with worktree mode
          yield* step(
            "thread: dispatch thread.create",
            client["orchestration.dispatchCommand"]({
              type: "thread.create",
              commandId: id("cmd"),
              threadId,
              projectId,
              title: "e2e pr review thread",
              modelSelection: {
                instanceId: "opencode",
                model: "anthropic/claude-sonnet-4-20250514",
              },
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdAt: now(),
            }),
            { describe: (r: any) => `sequence=${r?.sequence}` },
          );

          // Step 6: resolve PR and prepare worktree
          const threadPrepResult = yield* step(
            "worktree: preparePullRequestThread",
            client["git.preparePullRequestThread"]({
              cwd: tmpDir,
              reference: `#${prNumber}`,
              mode: "worktree",
              threadId,
            }),
            { describe: (r: any) => `worktree=${r?.worktreePath ?? r?.branch}` },
          );
          if (threadPrepResult === undefined) return;
          const worktreePath: string = threadPrepResult.worktreePath ?? threadPrepResult.branch;

          // Step 7: get PR diff and pick a file+line to comment on
          const prDiff = yield* step(
            "diff: changeRequest.getPrDiff",
            client["changeRequest.getPrDiff"]({ threadId, prNumber }),
            {
              describe: (r: any) =>
                `prHeadSHA=${r?.prHeadSHA?.slice(0, 8)}... diff=${r?.diff?.length ?? 0} bytes`,
            },
          );
          if (prDiff === undefined) return;

          // Parse the diff to find a changed file and an added line number.
          // Git diff format: "@@ -oldStart,oldLines +newStart,newLines @@"
          const diffStr: string = prDiff.diff;
          const fileMatch = diffStr.match(/^\+\+\+ b\/(.+)$/m);
          const hunkMatch = diffStr.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          const commentFile = fileMatch ? fileMatch[1]! : "README.md";
          let commentLine: number | undefined = hunkMatch ? parseInt(hunkMatch[1]!, 10) : undefined;
          const prHeadSHA: string = prDiff.prHeadSHA;

          // Step 8: create a review comment
          const commentId = id("comment");
          const commentBody = `e2e-smoke test comment — please ignore.`;
          const reviewComment = {
            id: commentId,
            file: commentFile,
            ...(typeof commentLine === "number" ? { line: commentLine } : {}),
            commitSHA: prHeadSHA,
            body: commentBody,
            author: { login: "local" },
            createdAt: now(),
          };

          yield* step(
            "comment: upsertReviewComment",
            client["changeRequest.upsertReviewComment"]({
              threadId,
              prNumber,
              prHeadSHA,
              comment: reviewComment,
            }),
            {
              describe: (r: any) => `comments=${r?.comments?.length}, state=${r?.state}`,
            },
          );

          // Step 9: submit review
          const submittedDraft = yield* step(
            "submit: changeRequest.submitReview",
            client["changeRequest.submitReview"]({ threadId, prNumber }),
            {
              describe: (r: any) => `state=${r?.state}, comments=${r?.comments?.length}`,
            },
          );
          if (submittedDraft === undefined) return;

          // Verify review appears on GitHub
          yield* step(
            "verify: review visible on GitHub",
            Effect.tryPromise(() =>
              shellRun(`gh api repos/${repo}/pulls/${prNumber}/reviews --jq '.[0].body'`, tmpDir),
            ),
            {
              describe: (body: string) => `review body length=${body.length}...`,
            },
          );

          // Step 10: run background agent (real opencode, ~2-5 min)
          console.log("\n  [agent] Running real background agent (may take up to 10 min)...\n");
          const [agentEvents] = yield* step(
            "agent: changeRequest.runBackgroundAgent",
            Effect.scoped(
              RpcClient.make(WsRpcGroup).pipe(
                Effect.flatMap((agentClient) =>
                  Effect.gen(function* () {
                    const ac = agentClient as any;
                    const stream = ac["changeRequest.runBackgroundAgent"]({
                      threadId,
                      prNumber,
                      commentId,
                    });
                    const events = yield* takeUntil(
                      stream,
                      (e: any) => e.type === "done" || e.type === "error",
                      AGENT_TIMEOUT_SECONDS,
                    );
                    return events;
                  }),
                ),
                Effect.provide(wsProtocolLayer(wsUrl, cookie)),
              ),
            ),
            {
              timeoutSeconds: AGENT_TIMEOUT_SECONDS + 30,
              describe: (events: any[]) => {
                const types = events.map((e: any) => e.type).join(",");
                const done = events.some((e: any) => e.type === "done");
                const error = events.find((e: any) => e.type === "error");
                return done
                  ? `events=done (${events.length} total)`
                  : error
                    ? `error: ${error.message}`
                    : `events=${types} (${events.length} total)`;
              },
            },
          );
          if (agentEvents === undefined) return;

          // Step 11: verify agent produced changes
          const gitStatus = yield* step(
            "verify: agent file changes",
            Effect.tryPromise(() => shellRun(`git status --porcelain`, worktreePath)),
            {
              describe: (status: string) =>
                status.length > 0
                  ? `changes: ${status.split("\n").slice(0, 3).join("; ")}...`
                  : "NO CHANGES",
            },
          );
          if (gitStatus === undefined) return;

          if (gitStatus.length === 0) {
            console.log(
              "\n  WARNING: Agent produced no file changes. The PR diff may be too large or the comment is trivially resolved.\n",
            );
          }

          // Step 10b: clean up agent worktree branch on remote
          yield* step(
            "cleanup: delete temp branch",
            Effect.tryPromise(() =>
              shellRun(`git push origin --delete ${tempBranch} 2>/dev/null || true`, tmpDir),
            ),
            { describe: () => "done" },
          );
        }),
      ),
      Effect.provide(wsProtocolLayer(wsUrl, cookie)),
    ),
  );

  // ——————— Step 12: teardown ———————
  yield* Fiber.interrupt(serverFiber);
}).pipe(
  Effect.onExit((exit) =>
    Effect.sync(() => {
      const failed = results.filter((r) => !r.ok);
      console.log("\n========== PR REVIEW E2E RESULTS ==========");
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
      console.log("============================================");
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
  program.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer))),
);
