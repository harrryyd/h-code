# T3 Code Fork UX

This context covers the user's navigation and workspace-management experience in the application. It defines the language for projects, threads, grouping, and PR-linked sidebar affordances so future changes use consistent terms.

## Language

**Project**:
A workspace entry that owns threads and points at a concrete working directory.
_Avoid_: Repo, folder, checkout

**Thread**:
A conversational work item within a Project.
_Avoid_: Chat, session

**Current Thread**:
The Thread that is actively open in the main chat view.
_Avoid_: Selected thread, focused thread

**Thread Workspace Mode**:
The workspace strategy used for a new Thread, either Local Checkout or New Worktree.
_Avoid_: Checkout mode, env mode

**Project Thread Default**:
The default Thread Workspace Mode used when creating a new Thread in a specific Project.
_Avoid_: Project env mode, project checkout preference

**Logical Project Grouping**:
An automatic rule that determines when multiple Project entries should be presented as the same Project in the sidebar.
_Avoid_: Manual group, folder

**Manual Sidebar Group**:
A user-defined, local-only container used to organize Projects in the sidebar.
_Avoid_: Project grouping, repository grouping

**Project Picker Flow**:
The keyboard-first flow that opens `New thread in...`, lets the user choose a Project, and then creates a Thread in that Project.
_Avoid_: Selected project shortcut

**Focus Chat Shortcut**:
A keyboard shortcut that moves focus to the composer for the Current Thread.
_Avoid_: Focus thread, focus window

**Change Request Badge**:
A sidebar thread indicator that shows Change Request state and glanceable metadata for the Thread's linked Change Request.
_Avoid_: PR icon, badge

**Server-Persisted User Preference**:
A user-specific setting stored by the local server in `userdata/settings.json`.
_Avoid_: Project metadata, browser-only setting

## Relationships

- A **Project** contains many **Threads**
- A **Current Thread** is exactly one active **Thread**
- A **Project Thread Default** belongs to one **Project**
- A **Project Thread Default** selects one **Thread Workspace Mode**
- A **Project Thread Default** is a **Server-Persisted User Preference**
- A **Manual Sidebar Group** contains many **Projects**
- A **Project** belongs to at most one **Manual Sidebar Group**
- A **Project Picker Flow** chooses exactly one **Project**
- A **Focus Chat Shortcut** targets the **Current Thread**
- A **Logical Project Grouping** can combine multiple physical **Projects** into one sidebar presentation
- A **Change Request Badge** belongs to a **Thread** when that Thread is linked to a Change Request

## Example dialogue

> **Dev:** "If I create a new Thread from a Project with no Current Thread, should the Project Thread Default still decide whether it uses Local Checkout or New Worktree?"
> **Domain expert:** "Yes. The Project Thread Default belongs to the Project, not to the Current Thread."

## Flagged ambiguities

- "group" was used to mean both **Logical Project Grouping** and **Manual Sidebar Group** — resolved: these are distinct concepts.
- "selected project" was used to describe keyboard-driven creation without an active thread — resolved: use **Project Picker Flow** for this interaction instead of implying a separate sidebar selection model.
- "change request badge" and "PR badge" were used interchangeably — resolved: use **Change Request Badge** as the canonical term.
- "project picker flow" was ambiguous — resolved: it refers to the existing `New thread in...` interaction, ideally with its own shortcut.
