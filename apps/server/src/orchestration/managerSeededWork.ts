import type {
  ManagerSeededWorkItem,
  ManagerSeededWorkItemInput,
  RefinementHandoff,
  SeededWorkSourceKind,
  WorkReadiness,
} from "@t3tools/contracts";

function classifySeededWorkItem(input: ManagerSeededWorkItemInput): {
  readonly readiness: WorkReadiness;
  readonly readinessReason: string;
} {
  if (input.delegationIntent === "human-owned") {
    return {
      readiness: "human-owned",
      readinessReason: "The item is explicitly reserved for the human operator.",
    };
  }

  if (input.targetProjectId === null) {
    return {
      readiness: "blocked-on-context",
      readinessReason: "Delegation Intake requires a target Project before work can be routed.",
    };
  }

  if (input.acceptanceCriteria.length === 0) {
    return {
      readiness: "needs-refinement",
      readinessReason: "Delegation Intake needs acceptance criteria before worker delegation.",
    };
  }

  return {
    readiness: "ready-for-worker",
    readinessReason: "Delegation Intake found a target Project and explicit acceptance criteria.",
  };
}

export function applyRefinementHandoffToSeededWorkItem(input: {
  readonly seededWorkItem: ManagerSeededWorkItem;
  readonly refinementHandoff: RefinementHandoff;
}): ManagerSeededWorkItem {
  const classification = classifySeededWorkItem({
    itemId: input.seededWorkItem.itemId,
    title: input.seededWorkItem.title,
    body: input.refinementHandoff.refinedProblemStatement,
    delegationIntent: input.seededWorkItem.delegationIntent,
    targetProjectId: input.refinementHandoff.targetProjectId,
    acceptanceCriteria: input.refinementHandoff.acceptanceCriteria,
  });
  const delegationRequestedAt =
    classification.readiness === "ready-for-worker"
      ? (input.seededWorkItem.delegationRequestedAt ?? input.refinementHandoff.recordedAt)
      : null;

  return {
    ...input.seededWorkItem,
    body: input.refinementHandoff.refinedProblemStatement,
    acceptanceCriteria: input.refinementHandoff.acceptanceCriteria,
    targetProjectId: input.refinementHandoff.targetProjectId,
    refinementHandoff: input.refinementHandoff,
    readiness: classification.readiness,
    readinessReason: classification.readinessReason,
    delegationStatus: classification.readiness === "ready-for-worker" ? "requested" : "idle",
    delegationRequestedAt,
    updatedAt: input.refinementHandoff.recordedAt,
  };
}

export function materializeSeededWorkItems(input: {
  readonly sourceKind: SeededWorkSourceKind;
  readonly sourceLabel: string;
  readonly items: ReadonlyArray<ManagerSeededWorkItemInput>;
  readonly createdAt: string;
}): ReadonlyArray<ManagerSeededWorkItem> {
  return input.items.map((item) => {
    const classification = classifySeededWorkItem(item);
    return {
      ...item,
      sourceKind: input.sourceKind,
      sourceLabel: input.sourceLabel,
      readiness: classification.readiness,
      readinessReason: classification.readinessReason,
      delegationStatus: "idle",
      delegationRequestedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
  });
}
