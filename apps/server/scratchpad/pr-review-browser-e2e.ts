/**
 * PR Review Browser E2E — boots the REAL server in-process, clones a real
 * GitHub repo, fetches a PR, exercises the full review flow via WS RPC, then
 * opens a headless browser to click "Request AI" on a comment and waits for
 * the agent response to appear in the frontend.
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
 *  10. browser      — open headless browser, navigate to thread+diff view
 *  11. click        — click "Request AI response" button on the comment
 *  12. wait         — wait for agent response to appear in the DOM
 *  13. verify       — capture response text and status
 *  14. cleanup      — interrupt server, delete temp dirs
 *
 * Usage:
 *   T3_TEST_PR_REPO=harrryyd/h-code-test T3_TEST_PR_NUMBER=1 node scratchpad/pr-review-browser-e2e.ts
 *
 * Requires:
 *   - gh CLI authenticated (`gh auth status`)
 *   - opencode installed and on PATH
 *   - playwright browsers installed (`npx playwright install chromium`)
 *   - web app pre-built (`cd apps/web && bun run build`)
 *
 * The web app must be built before running this test. The server serves the
 * built static files from apps/web/dist/ to provide the frontend in the browser.
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
import { chromium } from "playwright";
import * as child_process from "node:child_process";
import * as Fs from "node:fs/promises";
import * as Net from "node:net";
import * as Os from "node:os";
import * as PathMod from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveServerPaths,
  ensureServerDirectories,
  ServerConfig,
  type ServerConfigShape,
} from "../src/config.ts";
import { runServer } from "../src/server.ts";

const BOOTSTRAP_TOKEN = "e2e-pr-review-browser-bootstrap-token";
const STEP_TIMEOUT_SECONDS = 30;
const BOOT_TIMEOUT_SECONDS = 45;
const AGENT_TIMEOUT_SECONDS = 600; // 10 minutes for real agent run
const BROWSER_NAV_TIMEOUT_SECONDS = 60;
const BROWSER_ELEMENT_TIMEOUT_SECONDS = 15;
const BROWSER_AGENT_WAIT_SECONDS = 610;

// Pre-compute the web app dist directory at module load time so Node resolves
// it relative to this file's location before we enter the Effect runtime.
const WEB_DIST_DIR = PathMod.resolve(
  PathMod.dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);

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

function parseCookieNameValue(
  cookieStr: string,
): { name: string; value: string } {
  const eqIdx = cookieStr.indexOf("=");
  return {
    name: cookieStr.slice(0, eqIdx),
    value: cookieStr.slice(eqIdx + 1),
  };
}

const program = Effect.gen(function* () {
  // ——————— Validate env vars ———————
  const repo = process.env.T3_TEST_PR_REPO;
  const prNumberStr = process.env.T3_TEST_PR_NUMBER;
  if (!repo || !prNumberStr) {
    yield* Effect.die(
      new Error(
        "Set T3_TEST_PR_REPO=owner/repo and T3_TEST_PR_NUMBER=<n> environment variables.\n" +
          "Example: T3_TEST_PR_REPO=harrryyd/h-code-test T3_TEST_PR_NUMBER=1 node scratchpad/pr-review-browser-e2e.ts",
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
    Fs.mkdtemp(PathMod.join(Os.tmpdir(), "t3-pr-review-browser-e2e-")),
  );
  const cloneUrl = `https://github.com/${repo}.git`;
  yield* step(
    "clone: git clone",
    Effect.tryPromise(() => shellRun(`git clone "${cloneUrl}" "${tmpDir}"`, Os.tmpdir())),
  );

  // Push a temp branch so we can interact with it as a PR head
  const tempBranch = `t3-e2e-browser-${id("pr")}`;
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
        const srv = Net.createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
          const address = srv.address() as any;
          srv.close(() => resolve(address.port));
        });
      }),
  );
  const baseDir = yield* Effect.promise(() =>
    Fs.mkdtemp(PathMod.join(Os.tmpdir(), "t3-pr-review-browser-base-")),
  );
  const derivedPaths = yield* deriveServerPaths(baseDir, undefined);
  yield* ensureServerDirectories(derivedPaths);

  // Resolve the web app dist directory relative to this script
  // Pre-computed at module load time
  const webDistDir = WEB_DIST_DIR;

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
    otlpServiceName: "t3-server-pr-review-browser-e2e",
    mode: "desktop",
    port,
    host: "127.0.0.1",
    cwd: process.cwd(),
    baseDir,
    ...derivedPaths,
    staticDir: webDistDir,
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
      if (Exit.isSuccess(result) && result.value.status === 200) return "serving";
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
  const cookieFull = yield* step("auth: bootstrap credential -> session cookie", authenticate);
  if (cookieFull === undefined) return;
  const cookie = parseCookieNameValue(cookieFull);

  const issueWsCredential = Effect.gen(function* () {
    const result = yield* fetchJson(httpUrl("/api/auth/websocket-ticket"), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieFull },
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

  // ——————— Steps 4-9: WS RPC setup ———————
  const wsSetupResult = yield* Effect.scoped(
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
              title: "e2e pr review browser project",
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
              title: "e2e pr review browser thread",
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
          if (threadPrepResult === undefined) return undefined;
          const worktreePath: string =
            threadPrepResult.worktreePath ?? threadPrepResult.branch;

          // Step 7: get PR diff and pick a file+line to comment on
          const prDiff = yield* step(
            "diff: changeRequest.getPrDiff",
            client["changeRequest.getPrDiff"]({ threadId, prNumber }),
            {
              describe: (r: any) =>
                `prHeadSHA=${r?.prHeadSHA?.slice(0, 8)}... diff=${r?.diff?.length ?? 0} bytes`,
            },
          );
          if (prDiff === undefined) return undefined;

          const diffStr: string = prDiff.diff;
          const fileMatch = diffStr.match(/^\+\+\+ b\/(.+)$/m);
          const hunkMatch = diffStr.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          const commentFile = fileMatch ? fileMatch[1]! : "README.md";
          const commentLine = hunkMatch ? parseInt(hunkMatch[1]!, 10) : undefined;
          const prHeadSHA: string = prDiff.prHeadSHA;

          // Step 8: create a review comment
          const commentId = id("comment");
          const commentBody = `e2e-browser smoke test comment — please ignore.`;
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

          return { threadId, commentId, commentBody, commentFile, worktreePath, tmpDir, port };
        }),
      ),
      Effect.provide(wsProtocolLayer(wsUrl, cookieFull)),
    ),
  );
  if (wsSetupResult === undefined) return;
  const {
    threadId,
    commentId,
    commentBody,
    commentFile,
    worktreePath,
    tmpDir: _tmpDir2,
    port: _port2,
  } = wsSetupResult;

  // ——————— Read environmentId ———————
  const readEnvironmentId = Effect.promise(() =>
    Fs.readFile(derivedPaths.environmentIdPath, "utf-8"),
  ).pipe(Effect.map((s) => s.trim()));
  const environmentId = yield* step(
    "env: read environment-id",
    readEnvironmentId,
    { describe: (envId: string) => `${envId.slice(0, 8)}...` },
  );
  if (environmentId === undefined) return;

  // ——————— Step 10-12: Browser interaction ———————
  const browserUrl = `http://127.0.0.1:${port}/${environmentId}/${threadId}?diff=1`;
  console.log(`\n  [browser] Navigating to: ${browserUrl}\n`);

  const browserResult = yield* step(
    "browser: click Request AI and wait for response",
    Effect.gen(function* () {
      // Launch browser inside the Effect generator via promise bridge
      const result = yield* Effect.promise(async () => {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        await context.addCookies([
          {
            name: cookie.name,
            value: cookie.value,
            domain: "127.0.0.1",
            path: "/",
          },
        ]);

        const page = await context.newPage();
        const consoleMsgs: string[] = [];
        const wsEvents: string[] = [];
        page.on("console", (msg) => {
          consoleMsgs.push(`[${msg.type()}] ${msg.text().slice(0, 200)}`);
        });
        page.on("pageerror", (err) => {
          consoleMsgs.push(`[pageerror] ${err.message}`);
        });
        page.on("websocket", (ws) => {
          wsEvents.push(`[ws open] ${ws.url()}`);
          ws.on("close", () => wsEvents.push(`[ws close] ${ws.url()}`));
          ws.on("socketerror", (err) => wsEvents.push(`[ws error] ${ws.url()} ${err}`));
          ws.on("framereceived", (payload) => {
            const text = typeof payload.payload === "string" ? payload.payload : "binary";
            wsEvents.push(`[ws recv] ${text.slice(0, 200)}`);
          });
          ws.on("framesent", (payload) => {
            const text = typeof payload.payload === "string" ? payload.payload : "binary";
            wsEvents.push(`[ws send] ${text.slice(0, 200)}`);
          });
        });

        try {
          // Navigate with ?diff=1. TanStack Router may re-encode, but the
          // first parse should succeed and open the panel.
          console.log("  [browser] Navigating...");
          await page.goto(browserUrl, {
            waitUntil: "domcontentloaded",
            timeout: BROWSER_NAV_TIMEOUT_SECONDS * 1000,
          });
          console.log(`  [browser] URL: ${page.url()}`);

          await page.screenshot({
            path: "/tmp/pr-review-browser-e2e-after-nav.png",
            fullPage: true,
          });

          // Wait for the app shell to render
          await page.waitForSelector("#root > *", { timeout: 15000 });
          console.log("  [browser] App shell rendered");

          // Give WS time to connect and data to load
          await page.waitForTimeout(8000);
          console.log(`  [browser] URL after wait: ${page.url()}`);

          // Take another screenshot
          await page.screenshot({
            path: "/tmp/pr-review-browser-e2e-after-load.png",
            fullPage: true,
          });

          // Dump full body text for debugging
          const bodyTextAfterWait = await page.evaluate(() =>
            document.body.innerText.slice(0, 3000),
          );
          console.log(`  [browser] Body text after wait:\n${bodyTextAfterWait}`);
// Try multiple selectors for the diff panel content
          console.log("  [browser] Looking for diff panel...");

          // First check if the DiffPanel shell is present
          const diffSelectors = [
            '[aria-label="PR diff"]',
            '[aria-label="Checkpoint diff"]',
            ".diff-comment-panel",
          ];
          let panelFound = false;
          for (const sel of diffSelectors) {
            try {
              await page.waitForSelector(sel, { timeout: 5000 });
              console.log(`  [browser] Found selector: ${sel}`);
              panelFound = true;
              break;
            } catch {
              // try next
            }
          }

          if (!panelFound) {
            const bodyText = await page.evaluate(() =>
              document.body.innerText.slice(0, 5000),
            );
            const url = page.url();
            console.log(`  [browser] Page URL: ${url}`);
            console.log(`  [browser] Console messages: ${consoleMsgs.slice(0, 10).join(" | ")}`);
            console.log(`  [browser] Body text:\n${bodyText}`);
            await page.screenshot({
              path: "/tmp/pr-review-browser-e2e-no-panel.png",
              fullPage: true,
            });
            return {
              ok: false,
              detail: `Diff panel not found (no PR diff or Checkpoint diff toggle). Console: ${consoleMsgs.slice(0, 5).join("; ")}`,
              agentResponse: null,
            };
          }

          // Switch to PR review mode
          console.log("  [browser] Switching to PR review mode...");
          try {
            await page.click('[aria-label="PR diff"]', { timeout: 5000 });
            console.log("  [browser] Clicked PR diff toggle");
            await page.waitForTimeout(1000);
          } catch {
            console.log("  [browser] PR diff toggle not found or not clickable");
          }

          // Enter PR number
          try {
            const prInput = page.locator('[aria-label="PR number"]');
            await prInput.waitFor({ timeout: 5000 });
            await prInput.fill(String(prNumber));
            console.log(`  [browser] Entered PR number: ${prNumber}`);
            await page.waitForTimeout(2000);
          } catch {
            console.log("  [browser] Could not enter PR number");
          }

          // Wait for the diff comment panel to render
          console.log("  [browser] Waiting for diff comment panel...");
          try {
            await page.waitForSelector(".diff-comment-panel", {
              timeout: 30000,
            });
            console.log("  [browser] Diff comment panel found!");
          } catch {
            // Dump full page state for debugging
            const bodyText = await page.evaluate(() =>
              document.body.innerText.slice(0, 5000),
            );
            const url = page.url();
            console.log(`  [browser] Page URL: ${url}`);
            console.log(`  [browser] Console messages: ${consoleMsgs.slice(0, 10).join(" | ")}`);
            console.log(`  [browser] Body text:\n${bodyText}`);
            await page.screenshot({
              path: "/tmp/pr-review-browser-e2e-no-panel.png",
              fullPage: true,
            });
            return {
              ok: false,
              detail: `Diff comment panel not found after switching to PR mode. Console: ${consoleMsgs.slice(0, 5).join("; ")}`,
              agentResponse: null,
            };
          }

          // Give React a moment to finish hydration / WS connection
          await page.waitForTimeout(3000);

          // Take a pre-click screenshot
          await page.screenshot({
            path: "/tmp/pr-review-browser-e2e-pre-click.png",
            fullPage: true,
          });

// Look for the "Request AI" button on the comment
          console.log("  [browser] Looking for 'Request AI' button...");
          // Try both the file-level comment button and the inline annotation button
          const requestAiBtn = page.locator(
            'button[title="Request AI response"], button[title="Request AI"]',
          );

          let btnCount = 0;
          try {
            btnCount = await requestAiBtn.count();
          } catch {
            btnCount = 0;
          }
          console.log(`  [browser] Found ${btnCount} 'Request AI' button(s)`);

          if (btnCount === 0) {
            const bodyText = await page.evaluate(() =>
              document.body.innerText.slice(0, 3000),
            );
            console.log(`  [browser] Page body text (first 3k chars):\n${bodyText}`);
            console.log(`  [browser] Console: ${consoleMsgs.slice(-10).join(" | ")}`);
            await page.screenshot({
              path: "/tmp/pr-review-browser-e2e-no-button.png",
              fullPage: true,
            });
            return {
              ok: false,
              detail: `Request AI button not found. Console: ${consoleMsgs.slice(0, 5).join("; ")}`,
              agentResponse: null,
            };
          }

          // Try dismissing any toast notifications that might block interaction
          try {
            const dismissBtn = page.locator('[data-slot="toast-close"]');
            const dismissCount = await dismissBtn.count();
            if (dismissCount > 0) {
              await dismissBtn.first().click({ timeout: 3000 });
              console.log("  [browser] Dismissed toast notification");
              await page.waitForTimeout(500);
            }
          } catch {
            // No dismiss button found, continue
          }

          // Click the first "Request AI" button
          console.log("  [browser] Clicking 'Request AI' button...");
          await requestAiBtn.first().click({ timeout: 5000 });
          console.log("  [browser] Clicked. Waiting for agent response...");

          // Take a screenshot right after clicking
          await page.screenshot({
            path: "/tmp/pr-review-browser-e2e-post-click.png",
            fullPage: true,
          });

          // Wait for the agent to respond — look for "Done" status, error, or any agent response
          let agentResult = "unknown";
          let responseText = "";
          const start = Date.now();

          try {
            // First, wait briefly for the button to disappear (agent starting)
            await page.waitForFunction(
              () => {
                const text = document.body.innerText;
                return (
                  !text.includes("Request AI") ||
                  text.includes("Done") ||
                  text.includes("Failed") ||
                  text.includes("AI Response") ||
                  text.includes("Agent is working") ||
                  text.includes("loader") // spinner icon
                );
              },
              null as any,
              { timeout: 30000 },
            );

            // Now wait for the final result with a long timeout
            console.log("  [browser] Agent started, waiting for completion...");
            page.setDefaultTimeout(45000);
            await page.waitForFunction(
              () => {
                const text = document.body.innerText;
                return (
                  text.includes("Done") ||
                  text.includes("Failed") ||
                  /Agent process failed or timed out/i.test(text) ||
                  /AI Response/.test(text) ||
                  /Background agent error/i.test(text)
                );
              },
            );
            page.setDefaultTimeout(30000);

            const bodyText = await page.evaluate(() => document.body.innerText);

            if (bodyText.includes("Done")) {
              agentResult = "completed";
            } else if (/Agent process failed or timed out/i.test(bodyText)) {
              agentResult = "error";
            } else if (/Background agent error/i.test(bodyText)) {
              agentResult = "error";
            } else if (bodyText.includes("Failed")) {
              agentResult = "failed";
            } else if (bodyText.includes("AI Response")) {
              agentResult = "has_response";
            }

            // Extract the AI response portion
            const aiResponseIdx = bodyText.indexOf("AI Response");
            if (aiResponseIdx >= 0) {
              responseText = bodyText.slice(aiResponseIdx, aiResponseIdx + 2000);
            } else {
              const commentIdx = bodyText.indexOf(commentBody);
              if (commentIdx >= 0) {
                responseText = bodyText.slice(commentIdx, commentIdx + 2000);
              } else {
                responseText = bodyText.slice(0, 2000);
              }
            }
          } catch (waitErr: any) {
            const elapsed = Date.now() - start;
            agentResult = "timeout";

            try {
              const bodyText = await page.evaluate(() =>
                document.body.innerText.slice(0, 5000),
              );
              responseText = bodyText;

              if (bodyText.includes("Agent is working")) {
                agentResult = "still_running";
              } else if (bodyText.includes("Done")) {
                agentResult = "completed";
              } else if (bodyText.includes("Failed")) {
                agentResult = "failed";
              } else if (bodyText.includes("AI Response")) {
                agentResult = "has_response";
              }
            } catch {
              responseText = `Failed to read page: ${waitErr.message}`;
            }

            console.log(
              `  [browser] Wait error after ${elapsed}ms: ${waitErr.message?.slice(0, 200)}`,
            );
            console.log(
              `  [browser] Status: ${agentResult}, Console msgs: ${consoleMsgs.slice(-5).join(" | ") || "(none)"}`,
            );
            console.log(
              `  [browser] WS events (last 5): ${wsEvents.slice(-5).join(" | ") || "(none)"}`,
            );
            console.log(
              `  [browser] Body (first 1k):\n${responseText.slice(0, 1000)}`,
            );
          }

          // Take final screenshot
          const screenshotPath =
            agentResult === "completed" || agentResult === "still_running"
              ? "/tmp/pr-review-browser-e2e-success.png"
              : "/tmp/pr-review-browser-e2e-failure.png";
          await page.screenshot({ path: screenshotPath, fullPage: true });

          const ok = agentResult === "completed" || agentResult === "still_running";

          return {
            ok,
            detail: `status=${agentResult}, responseLength=${responseText.length}, screenshots at /tmp/pr-review-browser-e2e-*.png`,
            agentResponse: responseText,
            agentResult,
          };
        } finally {
          await browser.close();
        }
      });

      if (!result.ok) {
        yield* Effect.fail(
          new StepFailure(
            `Browser test failed: ${result.detail}\nResponse: ${result.agentResponse?.slice(0, 500) ?? "none"}`,
          ),
        );
      }
      return result;
    }),
    {
      timeoutSeconds: 90, // debug: short timeout
      describe: (r: any) => r.detail,
    },
  );

  console.log(
    `\n  [browser] Agent response:\n  ${(browserResult?.agentResponse ?? "N/A").slice(0, 500)}`,
  );

  // ——————— Cleanup ———————
  yield* step(
    "cleanup: delete temp branch",
    Effect.tryPromise(() =>
      shellRun(
        `git push origin --delete ${tempBranch} 2>/dev/null || true`,
        wsSetupResult.tmpDir,
      ),
    ),
    { describe: () => "done" },
  );

  yield* Fiber.interrupt(serverFiber);
}).pipe(
  Effect.onExit((exit) =>
    Effect.sync(() => {
      const failed = results.filter((r) => !r.ok);
      console.log("\n========== PR REVIEW BROWSER E2E RESULTS ==========");
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
      console.log("===================================================");
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
