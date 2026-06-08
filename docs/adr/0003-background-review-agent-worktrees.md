# Background Review Agent — per-agent temp worktrees

When a user requests an AI response on a Review Comment within a Change Request Review, a Background Review Agent is spawned. Multiple agents may run concurrently (one per comment). We chose to isolate each agent in its own temporary worktree rather than running them sequentially or sharing the main worktree.

## Decisions

- **Per-agent temp worktrees.** Each Background Review Agent gets a short-lived worktree created off the Change Request branch. Agents run in parallel without stepping on each other's working directories.
- **Direct push to PR branch.** Each agent commits and pushes to the Change Request branch as soon as its work is complete, rather than accumulating changes locally. This keeps the PR in sync with the local state.
- **Isolated branches.** Each agent pushes to the Change Request branch directly. If two agents edit the same file, Git resolves the merge on push as it would for any concurrent contributor.

## Considered Options

- **Sequential queue (one agent at a time):** Rejected — while simpler, it blocks the user from requesting AI responses on multiple comments simultaneously, defeating the interactive review experience.
- **Shared worktree with git branches:** Rejected — two agents cannot share a single worktree directory and switch branches independently without corrupting each other's working state.

## Status

proposed
