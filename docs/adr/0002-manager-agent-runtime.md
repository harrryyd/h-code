# Manager Agent Runtime — LLM-driven orchestration decisions

The Manager Console gets an AI agent that autonomously processes its inbox (seeded work, Worker Escalations) and makes orchestration decisions. The agent uses the provider system like any other Thread — getting a configurable provider (Codex/Claude/OpenCode), receiving turns, and interacting via a CLI through its bash tool.

## Decisions

- **Turn initiation is event-driven.** `thread.seeded-work-items-upserted`, `thread.manager-queue-items-upserted`, and `manager.manager-console-message-sent` trigger Autonomous Turns. No polling.
- **Fresh context each turn.** Each turn gets a reconstructed system prompt from persisted workspace state (`ManagerRuntime.reconstructRuntimeContext()`). No conversation memory between turns. This avoids drift and keeps turns deterministic.
- **Serialized with re-check.** Only one turn runs at a time. If an event fires mid-turn, a dirty flag triggers a follow-up turn with the latest state.
- **Tiered autonomy.** The Manager Agent auto-executes classification, queue dismissal/resolution, Refiner Thread creation, and preference updates. Worker delegation requires human approval via a structured Proposed Action in chat.
- **Queue discipline is FIFO.** The agent processes queue items in arrival order. No LLM-driven reordering.
- **CLI-driven execution.** The agent interacts with the orchestration system by running `foreman` commands through its provider's bash tool. A wrapper script in the Manager Workspace forwards commands to an HTTP endpoint on the server. This avoids custom provider tooling and keeps agent actions visible in the conversation log.
- **Separate modes.** Human-initiated turns are conversational (no CLI access). Event-triggered turns are CLI-only (no conversational preamble). The system prompt changes between modes.
- **Module lives in `apps/server/src/manager/`.** Clean separation from the generic orchestration layer.

## Considered Options

- **Long-running session**: Rejected — deterministic fresh context per turn avoids conversation drift, hallucinated state, and unbounded context growth.
- **Structured JSON output**: Rejected — CLI via bash tool is more natural for LLMs, provider-agnostic, and makes agent actions human-readable in the conversation history.
- **Provider-native tools**: Rejected — would require per-adapter instrumentation. CLI via bash tool works uniformly across all providers.
- **Polling-based turns**: Rejected — event-driven is more responsive and wastes fewer provider tokens on no-op turns.

## Status

proposed
