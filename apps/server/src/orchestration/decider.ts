import {
  ContextTrimPoint,
  EventId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  findThreadById,
  findActiveRefinerThreadForSeededWorkItem,
  findSeededWorkItemOnManagerConsole,
  findManagerConsole,
  findManagerWorkspace,
  listThreadsByProjectId,
  requireManagerConsole,
  requireNonNegativeInteger,
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
  requireTurnNotActive,
} from "./commandInvariants.ts";
import {
  applyRefinementHandoffToSeededWorkItem,
  materializeSeededWorkItems,
} from "./managerSeededWork.ts";
import { projectEvent } from "./projector.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Effect.Effect<
  Omit<OrchestrationEvent, "sequence" | "type" | "payload">,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.randomUUIDv4.pipe(
        Effect.map((eventId) => ({
          eventId: EventId.make(eventId),
          aggregateKind: input.aggregateKind,
          aggregateId: input.aggregateId,
          occurredAt: input.occurredAt,
          commandId: input.commandId,
          causationEventId: null,
          correlationId: input.commandId,
          metadata: input.metadata ?? {},
        })),
      ),
    ),
  );
}

type PlannedOrchestrationEvent = Omit<OrchestrationEvent, "sequence">;

type DecideOrchestrationCommandResult =
  | PlannedOrchestrationEvent
  | ReadonlyArray<PlannedOrchestrationEvent>;

const decideCommandSequence = Effect.fn("decideCommandSequence")(function* ({
  commands,
  readModel,
}: {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedOrchestrationEvent[] = [];

  for (const nextCommand of commands) {
    const decided = yield* decideOrchestrationCommand({
      command: nextCommand,
      readModel: nextReadModel,
    });
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const nextEvent of nextEvents) {
      plannedEvents.push(nextEvent);
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...nextEvent,
        sequence: nextSequence,
      }).pipe(
        Effect.catch(() =>
          Effect.fail(
            new OrchestrationCommandInvariantError({
              commandType: nextCommand.type,
              detail: `Projection error in command sequence.`,
            }),
          ),
        ),
      );
    }
  }

  return plannedEvents;
});

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });

      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          ...(command.managerMetadata !== undefined
            ? { managerMetadata: command.managerMetadata }
            : {}),
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "manager.bootstrap": {
      const existingWorkspace = findManagerWorkspace(readModel);
      if (existingWorkspace !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Manager Workspace '${existingWorkspace.id}' already exists.`,
        });
      }
      const existingConsole = findManagerConsole(readModel);
      if (existingConsole !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Manager Console '${existingConsole.id}' already exists.`,
        });
      }
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });

      return [
        {
          ...withEventBase({
            aggregateKind: "project",
            aggregateId: command.projectId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "project.created",
          payload: {
            projectId: command.projectId,
            title: "Manager Workspace",
            workspaceRoot: command.workspaceRoot,
            managerMetadata: {
              role: "workspace",
            },
            defaultModelSelection: command.modelSelection,
            scripts: [],
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        },
        {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.created",
          payload: {
            threadId: command.threadId,
            projectId: command.projectId,
            title: "Manager Console",
            managerMetadata: {
              role: "console",
            },
            modelSelection: command.modelSelection,
            runtimeMode: command.runtimeMode,
            interactionMode: command.interactionMode,
            branch: null,
            worktreePath: command.workspaceRoot,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        },
      ];
    }

    case "manager.seed-work-items": {
      yield* requireManagerConsole({
        readModel,
        command,
        threadId: command.threadId,
      });
      for (const item of command.items) {
        if (item.targetProjectId !== null) {
          yield* requireProject({
            readModel,
            command,
            projectId: item.targetProjectId,
          });
        }
      }

      const seededWorkItems = materializeSeededWorkItems({
        sourceKind: command.sourceKind,
        sourceLabel: command.sourceLabel,
        items: command.items,
        createdAt: command.createdAt,
      });

      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.seeded-work-items-upserted",
        payload: {
          threadId: command.threadId,
          seededWorkItems,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.seeded-work-item-writeback.request": {
      const managerConsole = yield* requireManagerConsole({
        readModel,
        command,
        threadId: command.threadId,
      });
      const seededWorkItem = managerConsole.seededWorkItems?.find(
        (item) => item.itemId === command.itemId,
      );
      if (!seededWorkItem) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Seeded work item '${command.itemId}' does not exist on Manager Console '${command.threadId}'.`,
        });
      }

      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.seeded-work-item-writeback-requested",
        payload: {
          threadId: command.threadId,
          itemId: seededWorkItem.itemId,
          sourceKind: seededWorkItem.sourceKind,
          sourceLabel: seededWorkItem.sourceLabel,
          title: seededWorkItem.title,
          writebackKind: command.writebackKind,
          body: command.body,
          createdAt: command.createdAt,
        },
      };
    }

    case "manager.refiner-thread.create": {
      yield* requireManagerConsole({
        readModel,
        command,
        threadId: command.managerThreadId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });

      const seededWorkItem = findSeededWorkItemOnManagerConsole(
        readModel,
        command.managerThreadId,
        command.seededWorkItemId,
      );
      if (seededWorkItem === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Seeded work item '${command.seededWorkItemId}' does not exist on Manager Console '${command.managerThreadId}'.`,
        });
      }
      if (seededWorkItem.readiness !== "needs-refinement") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Seeded work item '${command.seededWorkItemId}' is '${seededWorkItem.readiness}' and cannot create a Refiner Thread.`,
        });
      }
      if (seededWorkItem.targetProjectId === null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Seeded work item '${command.seededWorkItemId}' does not target a Project for refinement.`,
        });
      }
      const existingRefinerThread = findActiveRefinerThreadForSeededWorkItem(
        readModel,
        command.managerThreadId,
        command.seededWorkItemId,
      );
      if (existingRefinerThread !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Seeded work item '${command.seededWorkItemId}' already has active Refiner Thread '${existingRefinerThread.id}'.`,
        });
      }

      yield* requireProject({
        readModel,
        command,
        projectId: seededWorkItem.targetProjectId,
      });

      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: seededWorkItem.targetProjectId,
          title: `Refine: ${seededWorkItem.title}`,
          managerMetadata: {
            role: "refiner",
            managerThreadId: command.managerThreadId,
            seededWorkItemId: command.seededWorkItemId,
          },
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "manager.refinement-handoff.record": {
      const refinerThread = yield* requireThread({
        readModel,
        command,
        threadId: command.refinerThreadId,
      });
      if (refinerThread.managerMetadata?.role !== "refiner") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.refinerThreadId}' is not a Refiner Thread.`,
        });
      }
      if (command.acceptanceCriteria.length === 0) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Refinement Handoff requires at least one acceptance criterion.",
        });
      }

      yield* requireProject({
        readModel,
        command,
        projectId: command.targetProjectId,
      });

      const managerThreadId = refinerThread.managerMetadata.managerThreadId;
      const seededWorkItemId = refinerThread.managerMetadata.seededWorkItemId;
      const seededWorkItem = findSeededWorkItemOnManagerConsole(
        readModel,
        managerThreadId,
        seededWorkItemId,
      );
      if (seededWorkItem === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Seeded work item '${seededWorkItemId}' does not exist on Manager Console '${managerThreadId}'.`,
        });
      }

      const managerConsole = findThreadById(readModel, managerThreadId);
      if (managerConsole?.managerMetadata?.role !== "console") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${managerThreadId}' is not the Manager Console for command '${command.type}'.`,
        });
      }

      const nextSeededWorkItem = applyRefinementHandoffToSeededWorkItem({
        seededWorkItem,
        refinementHandoff: {
          refinerThreadId: command.refinerThreadId,
          sourceBody: seededWorkItem.body,
          refinedProblemStatement: command.refinedProblemStatement,
          acceptanceCriteria: command.acceptanceCriteria,
          targetProjectId: command.targetProjectId,
          recordedAt: command.createdAt,
        },
      });
      const seededWorkItems = (managerConsole.seededWorkItems ?? []).map((item) =>
        item.itemId === seededWorkItemId ? nextSeededWorkItem : item,
      );

      return [
        {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: managerThreadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.seeded-work-items-upserted",
          payload: {
            threadId: managerThreadId,
            seededWorkItems,
            updatedAt: command.createdAt,
          },
        },
        ...(nextSeededWorkItem.delegationStatus === "requested"
          ? [
              {
                ...withEventBase({
                  aggregateKind: "thread" as const,
                  aggregateId: managerThreadId,
                  occurredAt: command.createdAt,
                  commandId: command.commandId,
                }),
                type: "thread.activity-appended" as const,
                payload: {
                  threadId: managerThreadId,
                  activity: {
                    id: crypto.randomUUID() as OrchestrationEvent["eventId"],
                    tone: "info" as const,
                    kind: "manager.delegation.requested",
                    summary: `Auto-requested worker delegation for '${seededWorkItem.title}'.`,
                    payload: {
                      seededWorkItemId,
                      refinerThreadId: command.refinerThreadId,
                      targetProjectId: command.targetProjectId,
                    },
                    turnId: null,
                    createdAt: command.createdAt,
                  },
                },
              },
            ]
          : []),
      ];
    }

    case "worker.delegate": {
      const refinerThread = yield* requireThread({
        readModel,
        command,
        threadId: command.refinerThreadId,
      });
      if (refinerThread.managerMetadata?.role !== "refiner") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.refinerThreadId}' is not a Refiner Thread.`,
        });
      }

      const managerThreadId = refinerThread.managerMetadata.managerThreadId;
      const seededWorkItemId = refinerThread.managerMetadata.seededWorkItemId;
      const seededWorkItem = findSeededWorkItemOnManagerConsole(
        readModel,
        managerThreadId,
        seededWorkItemId,
      );
      if (seededWorkItem === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Seeded work item '${seededWorkItemId}' does not exist on Manager Console '${managerThreadId}'.`,
        });
      }
      if (!seededWorkItem.refinementHandoff) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Seeded work item '${seededWorkItemId}' does not have a refinement handoff.`,
        });
      }
      if (seededWorkItem.delegationStatus !== "requested") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Seeded work item '${seededWorkItemId}' delegation status is '${seededWorkItem.delegationStatus}' and cannot create a Worker Thread.`,
        });
      }

      yield* requireProject({
        readModel,
        command,
        projectId: seededWorkItem.refinementHandoff.targetProjectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.workerThreadId,
      });

      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.workerThreadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.created",
        payload: {
          threadId: command.workerThreadId,
          projectId: seededWorkItem.refinementHandoff.targetProjectId,
          title: seededWorkItem.title,
          managerMetadata: {
            role: "worker",
            managerThreadId,
            seededWorkItemId,
            sourceBody: seededWorkItem.refinementHandoff.sourceBody,
            refinedBrief: seededWorkItem.refinementHandoff.refinedProblemStatement,
            acceptanceCriteria: seededWorkItem.refinementHandoff.acceptanceCriteria,
          },
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const activeThreads = listThreadsByProjectId(readModel, command.projectId).filter(
        (thread) => thread.deletedAt === null,
      );
      if (activeThreads.length > 0 && command.force !== true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${command.projectId}' is not empty and cannot be deleted without force=true.`,
        });
      }
      if (activeThreads.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          commands: [
            ...activeThreads.map(
              (thread): Extract<OrchestrationCommand, { type: "thread.delete" }> => ({
                type: "thread.delete",
                commandId: command.commandId,
                threadId: thread.id,
              }),
            ),
            {
              type: "project.delete",
              commandId: command.commandId,
              projectId: command.projectId,
            },
          ],
        });
      }

      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.deleted" as const,
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          ...(command.managerMetadata !== undefined
            ? { managerMetadata: command.managerMetadata }
            : {}),
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.delete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.archive-and-new": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      yield* requireTurnNotActive({ thread, command });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.newThreadId,
      });
      const occurredAt = command.createdAt;
      return [
        {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "thread.archived-and-new-created",
          payload: {
            archivedThreadId: command.threadId,
            newThreadId: command.newThreadId,
            createdAt: occurredAt,
          },
        },
        {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "thread.session-stop-requested",
          payload: {
            threadId: command.threadId,
            createdAt: occurredAt,
          },
        },
      ];
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      return [userMessageEvent, turnStartRequestedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      yield* requireNonNegativeInteger({
        commandType: command.type,
        field: "turnCount",
        value: command.turnCount,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.context.trim": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      yield* requireTurnNotActive({ thread, command });

      const messagesByTurn = new Map<
        string,
        { turnId: string; messages: typeof thread.messages }
      >();
      for (const msg of thread.messages) {
        if (msg.turnId === null) continue;
        const existing = messagesByTurn.get(msg.turnId);
        if (existing) {
          existing.messages.push(msg);
        } else {
          messagesByTurn.set(msg.turnId, { turnId: msg.turnId, messages: [msg] });
        }
      }

      const orderedTurns = [...messagesByTurn.values()].toSorted((a, b) => {
        const aFirst = a.messages.reduce(
          (earliest, m) => (m.createdAt < earliest ? m.createdAt : earliest),
          a.messages[0]!.createdAt,
        );
        const bFirst = b.messages.reduce(
          (earliest, m) => (m.createdAt < earliest ? m.createdAt : earliest),
          b.messages[0]!.createdAt,
        );
        return aFirst.localeCompare(bFirst);
      });

      const totalTurns = orderedTurns.length;
      const keepN = command.keepLastNTurns ?? 0;

      const survivingTurnIds = new Set<string>();
      if (keepN > 0 && totalTurns > 0) {
        const keepCount = Math.min(keepN, totalTurns);
        for (let i = totalTurns - keepCount; i < totalTurns; i++) {
          survivingTurnIds.add(orderedTurns[i]!.turnId);
        }
      }

      let beforeEntryId = "";
      let prunedMessageCount = 0;
      const prunedTurnIds: TurnId[] = [];

      for (const turn of orderedTurns) {
        if (survivingTurnIds.has(turn.turnId)) {
          if (beforeEntryId === "") {
            beforeEntryId = turn.messages[0]?.id ?? "";
          }
        } else {
          prunedTurnIds.push(TurnId.make(turn.turnId));
          prunedMessageCount += turn.messages.length;
        }
      }

      const unkeyedMessages = thread.messages.filter((m) => m.turnId === null);
      prunedMessageCount += unkeyedMessages.length;

      const occurredAt = yield* nowIso;
      const trimPointId = EventId.make(crypto.randomUUID());
      const trimPoint: ContextTrimPoint = {
        id: trimPointId,
        createdAt: occurredAt,
        beforeEntryId,
        prunedMessageCount,
        prunedTurnIds,
      };

      return [
        {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "thread.trim-point-created",
          payload: {
            threadId: command.threadId,
            trimPoint,
          },
        },
        {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "thread.session-stop-requested",
          payload: {
            threadId: command.threadId,
            createdAt: occurredAt,
          },
        },
      ];
    }

    case "thread.session.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        })),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        })),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
    }

    case "worker.escalate": {
      const workerThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (workerThread.managerMetadata?.role !== "worker") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.threadId}' is not a Worker Thread.`,
        });
      }

      const managerThreadId = workerThread.managerMetadata.managerThreadId;
      if (managerThreadId === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Worker thread '${command.threadId}' is missing a manager thread reference.`,
        });
      }
      const managerConsole = yield* requireManagerConsole({
        readModel,
        command,
        threadId: managerThreadId,
      });

      const existingQueueItems = managerConsole.managerQueueItems ?? [];
      const alreadyEscalated = existingQueueItems.some(
        (item) => item.itemId === command.escalationId,
      );
      if (alreadyEscalated) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Escalation '${command.escalationId}' already exists on Manager Console '${managerThreadId}'.`,
        });
      }

      const newQueueItem = {
        itemId: command.escalationId,
        escalationThreadId: command.threadId,
        category: command.category,
        summary: command.summary,
        detail: command.detail,
        status: "pending" as const,
        createdAt: command.createdAt,
        addressedAt: null as null,
        dismissedAt: null as null,
      };

      const managerQueueItems = [...existingQueueItems, newQueueItem];

      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: managerThreadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.manager-queue-items-upserted",
        payload: {
          threadId: managerThreadId,
          managerQueueItems,
          updatedAt: command.createdAt,
        },
      };
    }

    case "manager.resolve-queue-item": {
      const managerConsole = yield* requireManagerConsole({
        readModel,
        command,
        threadId: command.threadId,
      });

      const existingQueueItems = managerConsole.managerQueueItems ?? [];
      const queueItemIndex = existingQueueItems.findIndex((item) => item.itemId === command.itemId);
      if (queueItemIndex === -1) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Queue item '${command.itemId}' not found on Manager Console '${command.threadId}'.`,
        });
      }

      const queueItem = existingQueueItems[queueItemIndex]!;
      if (queueItem.status !== "pending") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Queue item '${command.itemId}' cannot be resolved because it is already '${queueItem.status}'.`,
        });
      }

      // Capture before yield* boundary so narrowing is preserved
      const escalatedThreadId = queueItem.escalationThreadId;
      const queueItemCategory = queueItem.category;
      const workerThread = yield* requireThread({
        readModel,
        command,
        threadId: escalatedThreadId,
      });
      if (workerThread.managerMetadata?.role !== "worker") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${escalatedThreadId}' is not a Worker Thread.`,
        });
      }

      const updatedItem = {
        ...queueItem,
        status: "addressed" as const,
        addressedAt: command.createdAt,
      };

      const updatedQueueItems = [
        ...existingQueueItems.slice(0, queueItemIndex),
        updatedItem as typeof queueItem,
        ...existingQueueItems.slice(queueItemIndex + 1),
      ];

      return [
        {
          ...withEventBase({
            aggregateKind: "thread" as const,
            aggregateId: managerConsole.id,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.manager-queue-items-upserted" as const,
          payload: {
            threadId: managerConsole.id,
            managerQueueItems: updatedQueueItems,
            updatedAt: command.createdAt,
          },
        },
        {
          ...withEventBase({
            aggregateKind: "thread" as const,
            aggregateId: queueItem.escalationThreadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.activity-appended" as const,
          payload: {
            threadId: escalatedThreadId,
            activity: {
              id: crypto.randomUUID() as OrchestrationEvent["eventId"],
              tone: "info" as const,
              kind: "manager.queue-item.resolved",
              summary: command.instruction,
              payload: {
                queueItemId: command.itemId,
                category: queueItemCategory,
              },
              turnId: null,
              createdAt: command.createdAt,
            },
          },
        },
      ];
    }

    case "manager.dismiss-queue-item": {
      const managerConsole = yield* requireManagerConsole({
        readModel,
        command,
        threadId: command.threadId,
      });

      const existingQueueItems = managerConsole.managerQueueItems ?? [];
      const queueItemIndex = existingQueueItems.findIndex((item) => item.itemId === command.itemId);
      if (queueItemIndex === -1) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Queue item '${command.itemId}' not found on Manager Console '${command.threadId}'.`,
        });
      }

      const queueItem = existingQueueItems[queueItemIndex]!;
      if (queueItem.status !== "pending") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Queue item '${command.itemId}' cannot be dismissed because it is already '${queueItem.status}'.`,
        });
      }

      const dismissedItem = {
        ...queueItem,
        status: "dismissed" as const,
        dismissedAt: command.createdAt,
      };

      const updatedQueueItems = [
        ...existingQueueItems.slice(0, queueItemIndex),
        dismissedItem as typeof queueItem,
        ...existingQueueItems.slice(queueItemIndex + 1),
      ];

      return {
        ...withEventBase({
          aggregateKind: "thread" as const,
          aggregateId: managerConsole.id,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.manager-queue-items-upserted" as const,
        payload: {
          threadId: managerConsole.id,
          managerQueueItems: updatedQueueItems,
          updatedAt: command.createdAt,
        },
      };
    }

    // NOTE: thread.context.summarize (issue #87) must also guard against
    // active turns using requireTurnNotActive when the command is implemented.
    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
