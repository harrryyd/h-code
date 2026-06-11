# AGENTS.md

## Running the Dev Server

This repo shares port ranges and the `~/.t3` state directory with a separately-running T3 Code instance. Running `bun run dev` without isolation will corrupt the other instance's database and state.

**Always run dev with an isolated home directory:**

```bash
./scripts/dev.sh
```

Or manually:

```bash
T3CODE_HOME=~/.t3-hcode bun run dev
```

The script auto-derives a unique `T3CODE_HOME` per worktree/path, so multiple worktrees can run simultaneously without conflict.

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Running Tests

- Use `bun run test` from the repo root for package-wide test runs.
- Do not pass test file paths to the root `bun run test` command. The root script goes through Turbo, and Turbo interprets extra arguments as task names.
- To run a single test file, run `bun run test <path-to-test-file>` from the owning package directory such as `apps/web`, `apps/server`, `packages/contracts`, or `packages/shared`.
- Run web test files from `apps/web` so the app-local Vitest config and path aliases such as `~/*` are applied.

### Test suites

| Suite                   | Package                   | Command                                                      | Coverage                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests              | `apps/server`             | `bun run test` (from `apps/server`)                          | 147 test files — persistence, auth, orchestration deciders, provider registry, WS RPC scopes                                                                                                                                                                                            |
| Unit tests              | `apps/web`                | `bun run test` (from `apps/web`)                             | 105 test files — component logic, hooks, store, sidebar, chat composer, local API                                                                                                                                                                                                       |
| Unit tests              | `packages/contracts`      | `bun run test` (from `packages/contracts`)                   | 12 test files — schema round-trips, RPC contract types                                                                                                                                                                                                                                  |
| Unit tests              | `packages/shared`         | `bun run test` (from `packages/shared`)                      | 29 test files — todo store, keybindings, git utilities                                                                                                                                                                                                                                  |
| Unit tests              | `packages/client-runtime` | `bun run test` (from `packages/client-runtime`)              | 24 test files — WS RPC protocol, thread detail reducer, remote API                                                                                                                                                                                                                      |
| WS RPC scope regression | `apps/server`             | `bun run test src/wsRpcScopes.test.ts`                       | Asserts every `WsRpcGroup` method has a declared authorization scope in `RPC_REQUIRED_SCOPE`. Missing entries cause connection-level protocol defects.                                                                                                                                  |
| E2E smoke               | `apps/server`             | `node scratchpad/e2e-smoke.ts`                               | Boots the real server in-process (temp `baseDir`, desktop bootstrap token), authenticates, opens a real `/ws` connection, and exercises `getConfig`, `todo.load`, `subscribeServerConfig`, `project.create`, `thread.create`, `thread.turn.start`, and `subscribeShell`. Exit 0 = pass. |
| Attach smoke            | `apps/server`             | `node scratchpad/attach-smoke.ts <serverUrl> <pairingToken>` | Same RPC checks as e2e-smoke against an already-running server.                                                                                                                                                                                                                         |
| Browser probe           | `apps/web`                | `node scratchpad/e2e-browser-probe.ts "<pairingUrl>"`        | Playwright headless probe of the real dev pairing flow. Navigates to `/settings/providers`, asserts no stuck "Checking provider status" text, and dumps console/network/WS-frame diagnostics. Requires `playwright` installed.                                                          |

E2E smoke harnesses exercise the full WebSocket RPC stack end-to-end. They catch contract-implementation drift that unit tests miss (e.g. a method absent from `RPC_REQUIRED_SCOPE` tears down the entire WebSocket, but unit tests of individual deciders or services pass). Consider adding a smoke gate to CI so "merged without booting" cannot recur.

Mint pairing tokens for the dev DB with:

```bash
node apps/server/src/bin.ts auth pairing create --base-dir <T3CODE_HOME> --dev-url http://localhost:<webPort>
```

Note: `--dev-url` selects the `dev/` state subdirectory; omit it to write to `userdata/`. The CLI and dev server must agree on the subdirectory or tokens will be silently invalid.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Agent skills

### Issue tracker

Issues for this repo are tracked in GitHub Issues for `harrryyd/h-code`. See `docs/agents/issue-tracker.md`.

### Triage labels

This repo uses the default triage label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo is configured as a single-context repo with a root `CONTEXT.md` and root `docs/adr/` when present. See `docs/agents/domain.md`.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.
