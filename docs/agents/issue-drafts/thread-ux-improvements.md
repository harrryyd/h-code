# Issue Drafts: Thread UX Improvements

## 1. Persist project thread defaults in server settings

## What to build

Add server-persisted user preferences for `Project Thread Default` in `userdata/settings.json`, keyed to the physical Project identity. Support three states per Project: `inherit global`, `local checkout`, and `new worktree`.

This slice should make the preference available end-to-end so other flows can reliably resolve the effective `Thread Workspace Mode` for a chosen Project using project override first and global default second.

## Acceptance criteria

- [ ] A Project can have a server-persisted `Project Thread Default` keyed by physical project identity.
- [ ] The preference supports exactly `inherit global`, `local checkout`, and `new worktree`.
- [ ] The effective thread workspace mode resolves as project override first, then global default.
- [ ] The preference survives local server restarts via `userdata/settings.json`.
- [ ] Automated tests cover persistence and resolution behavior.

## Blocked by

None - can start immediately.

---

## 2. Add manual sidebar groups and project preferences UI

## What to build

Add `Manual Sidebar Groups` as server-persisted user preferences and expose project-scoped controls in the frontend. A user should be able to open project preferences from the sidebar, set that Project's `Project Thread Default`, assign the Project to a `Manual Sidebar Group`, and create a new group during that same flow.

The sidebar should render named `Manual Sidebar Groups` above the existing project list behavior. Group order is manual; Project order within a group should continue to follow the existing automatic sort behavior. Groups should support user-defined names, empty-state persistence, and collapse state persistence.

## Acceptance criteria

- [ ] `Manual Sidebar Groups` are stored as server-persisted user preferences in `userdata/settings.json`.
- [ ] A Project can belong to at most one `Manual Sidebar Group`, or remain in implicit `Ungrouped`.
- [ ] The sidebar renders named groups in manual order, with project ordering inside each group still following current sort behavior.
- [ ] Groups can be created, renamed, reordered, collapsed, and left empty.
- [ ] Project preferences UI allows editing `Project Thread Default` and group assignment together.
- [ ] Project group assignment can create a new group inline during the same flow.
- [ ] First iteration uses menu/dialog management rather than drag-and-drop.
- [ ] Automated tests cover persistence and sidebar rendering behavior.

## Blocked by

- Depends on: Persist project thread defaults in server settings

---

## 3. Add keyboard shortcuts for focus chat, rename current thread, and project picker flow

## What to build

Add three keyboard improvements for desktop use: a `Focus Chat Shortcut` that focuses the composer for the `Current Thread`, a rename shortcut that opens inline rename for the current thread and selects the full title, and a dedicated shortcut for the existing `Project Picker Flow` (`New thread in...`).

The `Focus Chat Shortcut` should work from normal app surfaces except when a modal or dialog is actively capturing input. The rename shortcut should operate on the `Current Thread` and reuse the existing inline rename behavior once the thread exists.

## Acceptance criteria

- [ ] A `Focus Chat Shortcut` focuses the composer for the `Current Thread` and places the caret at the end of existing draft content.
- [ ] A rename-current-thread shortcut opens inline rename in the sidebar and selects the full thread title.
- [ ] A dedicated shortcut opens the existing `New thread in...` project picker flow.
- [ ] Shortcut handling respects dialog/modal capture so global commands do not interfere with active modal input.
- [ ] Automated tests cover shortcut routing and focus behavior.

## Blocked by

None - can start immediately.

---

## 4. Make new-thread flows respect project thread defaults

## What to build

Update all new-thread entry points so they resolve the chosen Project's effective `Project Thread Default` before creating the thread. This includes the sidebar new-thread action and the `Project Picker Flow` (`New thread in...`).

When a Project has `inherit global`, the flow should continue to use the global default. When a Project has an explicit override, the flow should consistently use that `Thread Workspace Mode`.

## Acceptance criteria

- [ ] The sidebar new-thread action uses the effective `Project Thread Default` for the chosen Project.
- [ ] The `Project Picker Flow` (`New thread in...`) uses the effective `Project Thread Default` for the chosen Project.
- [ ] `inherit global` continues to use the current global default behavior.
- [ ] Explicit project overrides take precedence over the global default in all supported new-thread flows.
- [ ] Automated tests cover both overridden and inherited behavior.

## Blocked by

- Depends on: Persist project thread defaults in server settings

---

## 5. Enrich the change request badge with PR number and open-label metadata

## What to build

Extend the `Change Request Badge` in the sidebar so it provides glanceable PR identity as well as state. The compact visible form should keep state coloring, show the pull request number as `#number`, and for open change requests show up to two labels with approximate but recognizably close label colors plus `+N` overflow.

Merged and closed change requests should still show status and `#number`, but hide labels to keep older threads compact.

## Acceptance criteria

- [ ] The sidebar `Change Request Badge` shows PR state using visible color and displays `#number`.
- [ ] Open change requests show up to two labels inline with overflow summary when more labels exist.
- [ ] Label colors are approximate but recognizably close to provider colors.
- [ ] Closed and merged change requests keep status and `#number` visible but hide labels.
- [ ] Existing change request state behavior remains intact.
- [ ] Automated tests cover rendering for open, closed, merged, labeled, and unlabeled cases.

## Blocked by

None - can start immediately.
