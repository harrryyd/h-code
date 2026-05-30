# T3 Code Fork UX

This context covers the user's navigation and workspace-management experience in the application. It defines the language for projects, threads, grouping, and PR-linked sidebar affordances so future changes use consistent terms.

## Language

**Project**:
A workspace entry that owns threads and points at a concrete working directory.
_Avoid_: Repo, folder, checkout

**Thread**:
A conversational work item within a Project.
_Avoid_: Chat, session

**Manager Console**:
The single persistent conversation used to coordinate work across one or more Worker Threads, potentially across multiple Projects.
_Avoid_: Supervisor chat, orchestration session, manager thread

**Manager Workspace**:
The dedicated filesystem workspace that owns the Manager Console and its persistent context, separate from any specific Project checkout.
_Avoid_: Home project, root repo

**Worker Thread**:
A first-class Thread created to execute delegated work on behalf of the Manager Console within a specific Project.
_Avoid_: Child session, background task

**Refiner Thread**:
A first-class Thread created by the Manager Console to refine a seeded work item with the human inside a specific Project before delegation, typically using `grill-with-docs`.
_Avoid_: Planning chat, intake note

**Worker Escalation**:
A structured event emitted from a Worker Thread to signal that the Manager Console must review, answer, or route something.
_Avoid_: Heuristic alert, transcript scan hit

**Manager Queue Item**:
A linked coordination item created in the Manager Console from a Worker Escalation.
_Avoid_: Bead, inbox row, notification

**Refinement Handoff**:
The manager-side update that records a Refiner Thread's outcome back onto the originating work item so delegation can continue, including the refined problem statement, acceptance criteria, and target Project.
_Avoid_: Thread closeout, planning summary

**Manager Queue Discipline**:
The rule used to choose which Manager Queue Item the Manager Console handles next.
_Avoid_: Scheduling policy, priority system

**Delegation Intake**:
The manager-side pass that reviews seeded work items before any Worker Thread is created.
_Avoid_: Auto-spawn, blind dispatch

**Work Readiness**:
The classification of a seeded work item based on whether it is ready for delegation, needs refinement, or should stay with the human.
_Avoid_: Priority, estimate

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

**Delegation Badge**:
A sidebar thread indicator that marks a Worker Thread as delegated from the Manager Console.
_Avoid_: Agent badge, child badge

**Manager Inbox**:
A distinct sidebar section that contains the Manager Console separately from Project-owned Threads.
_Avoid_: Supervisor project, orchestration group

**Server-Persisted User Preference**:
A user-specific setting stored by the local server in `userdata/settings.json`.
_Avoid_: Project metadata, browser-only setting

## Relationships

- A **Project** contains many **Threads**
- A **Manager Console** can coordinate many **Worker Threads**
- A **Manager Console** belongs to the **Manager Workspace**
- A **Manager Workspace** contains exactly one **Manager Console**
- A **Manager Console** contains many **Manager Queue Items**
- A **Manager Console** uses one **Manager Queue Discipline**
- A **Manager Console** performs **Delegation Intake** on seeded work items
- A **Manager Console** can create many **Refiner Threads**
- A **Worker Thread** belongs to exactly one **Project**
- A **Worker Thread** can belong to at most one **Manager Console**
- A **Worker Thread** can emit many **Worker Escalations**
- A **Worker Escalation** creates exactly one **Manager Queue Item**
- A **Refiner Thread** belongs to the **Manager Console**
- A **Refiner Thread** belongs to exactly one **Project**
- A **Refiner Thread** produces one **Refinement Handoff**
- A seeded work item has one **Work Readiness**
- A **Current Thread** is exactly one active **Thread**
- A **Project Thread Default** belongs to one **Project**
- A **Project Thread Default** selects one **Thread Workspace Mode**
- A **Project Thread Default** is a **Server-Persisted User Preference**
- A **Manager Inbox** contains the **Manager Console**
- A **Manager Inbox** presents the **Manager Console** from the **Manager Workspace**
- A **Manual Sidebar Group** contains many **Projects**
- A **Project** belongs to at most one **Manual Sidebar Group**
- A **Project Picker Flow** chooses exactly one **Project**
- A **Focus Chat Shortcut** targets the **Current Thread**
- A **Logical Project Grouping** can combine multiple physical **Projects** into one sidebar presentation
- A **Change Request Badge** belongs to a **Thread** when that Thread is linked to a Change Request
- A **Delegation Badge** belongs to a **Worker Thread**

## Example dialogue

> **Dev:** "If I create a new Thread from a Project with no Current Thread, should the Project Thread Default still decide whether it uses Local Checkout or New Worktree?"
> **Domain expert:** "Yes. The Project Thread Default belongs to the Project, not to the Current Thread."

## Flagged ambiguities

- "group" was used to mean both **Logical Project Grouping** and **Manual Sidebar Group** — resolved: these are distinct concepts.
- "selected project" was used to describe keyboard-driven creation without an active thread — resolved: use **Project Picker Flow** for this interaction instead of implying a separate sidebar selection model.
- "change request badge" and "PR badge" were used interchangeably — resolved: use **Change Request Badge** as the canonical term.
- "project picker flow" was ambiguous — resolved: it refers to the existing `New thread in...` interaction, ideally with its own shortcut.
- "manager session", "supervisor chat", and "manager thread" were used interchangeably — resolved: use **Manager Console** for the single coordinating conversation and **Worker Thread** for delegated execution conversations.
- "home project" and "manager home thread" were ambiguous — resolved: use **Manager Workspace** for the dedicated filesystem workspace that owns the **Manager Console** and its persistent context.
- "blocker detection" and "question detection" were described as possible transcript scanning — resolved: use explicit **Worker Escalations** that create linked **Manager Queue Items**.
- "priority" and "category" were at risk of being conflated — resolved: v1 uses FIFO **Manager Queue Discipline** while still categorizing **Manager Queue Items** by type.
- "starting work" was at risk of meaning both classification and delegation — resolved: use **Delegation Intake** for the pre-spawn classification pass and **Work Readiness** for the resulting state.
- "needs-refinement" was initially treated as a Manager Console-only state — resolved: it can spawn a dedicated **Refiner Thread** that returns a **Refinement Handoff** before worker delegation.
- "refinement workspace" was ambiguous — resolved: a **Refiner Thread** is project-specific because it uses repo-local context such as `CONTEXT.md` and ADRs.
- "refinement output" was at risk of becoming a full implementation spec — resolved: the minimum **Refinement Handoff** centers on refined problem statement, behavioral or functional acceptance criteria, and target **Project**, without forcing file-path-level guidance.
