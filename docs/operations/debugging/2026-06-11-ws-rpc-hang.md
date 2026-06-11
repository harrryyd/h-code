# Postmortem: WebSocket RPC Hang — Broken App After Unvalidated Merges

**Date:** 2026-06-10 to 2026-06-11  
**Branch:** `fix/ws-rpc-hang` (10 fix commits on top of 8fc126cf)  
**Repo:** harrryyd/h-code

## User-visible symptoms

After a series of large, unvalidated merge commits, the app was broken:
- **Providers settings** stuck on "Checking provider status — Waiting for the server to report installation and authentication details"
- **Model picker** empty — couldn't select a model
- **Unable to send messages** after creating a project or thread
- **Permanent 5-second reconnect loop** — the WebSocket connection kept dying

## Root cause

Commit **8834e517** (merge of upstream `920d0e44` — "Fix TodoPanel sidebar overflow & migrate CI from Bun to Vite+") introduced a per-method WebSocket RPC authorization scope map (`RPC_REQUIRED_SCOPE` in `apps/server/src/ws.ts`) covering 30 upstream methods. **Eight fork-added methods were missing from the map:**

- `todo.load`, `todo.mutate`
- `projects.list`, `projects.add`, `projects.remove`
- `mcp.listServers`, `mcp.toggleServer`
- `changeRequest.runBatchAgents`

When any of these methods were called, `requiredScopeForMethod()` threw at request time. That throw surfaced as a **connection-level RPC protocol defect** and tore down the entire WebSocket — including all in-flight subscriptions. The web app calls `todo.load` on every boot to populate the todo panel, killing the connection immediately. Hence the permanent reconnect loop and all cascading symptoms.

The HEAD commit `8fc126cf` ("WS RPC hang — nested Effect.gen deadlock") was likely chasing the same symptom under a different (incorrect) theory.

## Previous session (handoff session)

### Diagnosed and fixed

1. **Scope-map fix** (`ab7d7469`): Added the 8 missing entries to `RPC_REQUIRED_SCOPE`, added `missingRpcScopeDeclarations()` boot-time validation (fail fast at startup instead of throwing per-request), and added `wsRpcScopes.test.ts` regression test.

2. **Merge-splice fix** (`241c5bd6`): Merge 8834e517 accidentally spliced ~630 duplicated lines of test code into the middle of a test in `ProviderRegistry.test.ts`. The resulting parse errors made tsgo skip semantic checking of the entire `apps/server` package, **masking ~450 pre-existing type errors** across the codebase.

3. **Test harnesses built** (`091a3cf9`):
   - `apps/server/scratchpad/e2e-smoke.ts` — boots the real server in-process, authenticates, opens a real WebSocket, and exercises 10 RPC methods. Exit 0 = pass. Designed to run unmodified across the 40a6235..HEAD commit range.
   - `apps/server/scratchpad/attach-smoke.ts` — same RPC checks against an already-running server.
   - `e2e-browser-probe.ts` — Playwright headless probe of the real dev pairing flow; asserts `/settings/providers` is NOT stuck on "Checking provider status."

### Verified end-to-end

Headless-browser probe against the real dev stack confirmed:
- Providers populating (Codex authenticated, OpenCode authenticated, Claude "Not found")
- Todos loading
- Single stable WebSocket connection (no reconnect loop)

## This session (continuation)

### Web typecheck repairs (`fc96be3e`)

Fixed 23 remaining `apps/web` typecheck errors from the merge series, including 3 real runtime bugs:
- **`DiffPanel.tsx`**: `isReviewMode` TDZ crash (used before declaration)
- **`ChatView.tsx`**: invalid route `"/thread/$threadId"` (route does not exist)
- **`DiffCommentPanel.tsx`**: invalid `"iso"` time-format argument

Also fixed: `localApi.test.ts` was corrupted by merge damage (did not parse); mock `rpcClient` was missing the `changeRequest` method group.

### Server typecheck repairs (449 → 0 errors across 3 commits)

The merge splice had hidden 449 typecheck errors. All were pre-existing — they existed at the committed HEAD `8fc126cf`. Partitioned and fixed across three commits:

**`e13221dc`** — ~210 errors across orchestration deciders, BackgroundAgentService, ProviderCommandReactor, CodexSessionRuntime, EnvironmentAuth, and review/sourceControl providers. Key fixes:
- Effect v4 API migration: `Effect.catchAll` → `Effect.catch`, `Option.fromNullable` → `Option.fromNullishOr`, `Effect.async` → `Effect.callback`
- `PlannedOrchestrationEvent` construction using proper constructors
- Crypto service dependency threading in decider tests
- `compactThread` stubs on provider adapters

**`a87ef7af`** — 26 errors in `ws.ts`. After the RPC route layer refactor (commit `c3351374` replaced the `WsAppServices` indirection with `WsRpcGroup.toLayer()`), the raw error types of handlers became visible to the RPC framework. Fix:
- Added `EnvironmentAuthorizationError` to fork-added RPC contracts (mcp, todos) — matching the pattern used by all 30 upstream methods
- Converted persistence infrastructure errors (`PersistenceDecodeError | PersistenceSqlError`) to defects via `Effect.orDie` in `changeRequest` handlers that query `getThreadShellById`
- Provided `FileSystem` service in todo handler scope
- Fixed readonly-array vs mutable-array `TodosData` conversion

**`86220f63`** — Remaining 275 errors + 53 test failures across `server.test.ts`, `BackgroundAgentService.test.ts`, `ReviewDraftStore.ts`, `SourceControlProviderRegistry.ts`, `GitHubCli.ts`, and orchestration test fixtures. Key fixes:
- `contextTrimPoints: []` on all thread projection fixtures (new required field from `/compact`)
- `Layer.mock()` for 3 new production services missing from test harnesses
- Missing `getPullRequestReviews`/`createPullRequestReview` stubs for unsupported source control providers
- Removed 14 deprecated `GitVcsDriver` methods from test mocks
- `exactOptionalPropertyTypes` fixes across all touched fixtures

### Mobile fix (`3f8d4551`)

Added `contextTrimPoints: []` to the `threadActivity.test.ts` fixture factory — caught by `vp run typecheck`.

### WS RPC route layer simplification (`c3351374`)

Removed the `WsAppServices` context-based indirection in favor of direct `WsRpcGroup.toLayer(makeWsRpcHandlers(session))`. This eliminated ~170 lines of hand-built RPC context plumbing, debug instrumentation, and the `ws-rpc-context-debug.ts` scratchpad probe. This was the pre-existing uncommitted rework from the handoff session.

### Formatting (`7071606e`)

Applied Prettier auto-formatting from `vp check --fix` across 44 files.

## Verification results

| Gate | Result |
|------|--------|
| `vp check` | 0 errors, 26 pre-existing warnings |
| `vp run typecheck` | 0 failures across all 15 packages |
| Server tests (`apps/server`) | 147 passed, 1 skipped |
| Web tests (`apps/web`) | 105 passed |
| `e2e-smoke.ts` | PASS (all 10 RPC steps) |
| Browser probe | PASS (providers populated, no stuck state) |

## Known issues (not fixed)

### 1. Startup window hang (pre-existing at known-good commit)

`HttpServerLive` (`apps/server/src/server.ts:116`) creates the HTTP socket and listens immediately at boot. `RuntimeServicesLive` (DB migrations, provider discovery, service bootstrapping) takes ~5s to initialize, and `makeRoutesLayer` (router, WS route, API routes) isn't fully attached until those services complete. Requests accepted in this window hang forever with no response. With `node --watch` restarts, this strands browser tabs.

### 2. Todos not isolated to `T3CODE_HOME`

`apps/server/src/todoPersistence.ts:7` hardcodes `Os.homedir() + "/.t3code"` — ignores the `T3CODE_HOME` environment variable. Every other persistence module respects the configured base directory. This means the isolated dev probe was reading and writing the user's real todo file, violating the dev-isolation contract in `AGENTS.md`.

### 3. CLI/dev DB split trap

`t3 auth pairing create` writes tokens to the `userdata/` subdirectory by default, but the dev server (started with `--dev-url`) reads from the `dev/` subdirectory. Tokens minted without `--dev-url` are silently invalid against the dev server. No warning is printed.

### 4. No CI smoke gate

`apps/server/scratchpad/e2e-smoke.ts` exercises the real server end-to-end and caught this regression instantly, but it's not wired into CI. Without it, RPC contract drift between the handler implementations and the contract schemas can silently break the app.

## How to test locally

```bash
# 1. Boot dev server (isolated home dir)
./scripts/dev.sh

# 2. Run in-process e2e smoke (exit 0 = pass)
cd apps/server && node scratchpad/e2e-smoke.ts

# 3. Or test the full browser flow
TOKEN=$(node apps/server/src/bin.ts auth pairing create \
  --base-dir ~/.t3-hcode --dev-url http://localhost:5734 2>/dev/null \
  | grep "^Token:" | awk '{print $2}')
cd apps/web && node scratchpad/e2e-browser-probe.ts \
  "http://localhost:5734/pair#token=$TOKEN"

# 4. Manual check: open http://localhost:5734, pair, go to
#    Settings → Providers — should show statuses, not "Checking provider status"

# 5. Full gates
./node_modules/.bin/vp check
./node_modules/.bin/vp run typecheck
cd apps/server && bun run test
cd apps/web && bun run test
```
