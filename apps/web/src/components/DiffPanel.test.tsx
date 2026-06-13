import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const noop = () => {};

beforeAll(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: noop,
    removeItem: noop,
    clear: noop,
  });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    addEventListener: noop,
    removeEventListener: noop,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    },
    cancelAnimationFrame: noop,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      offsetHeight: 0,
    },
  });
});

vi.mock("@pierre/diffs/worker/worker.js?worker", () => ({
  default: class {},
}));

function MockFileDiff(props: {
  fileDiff?: { name?: string; prevName?: string };
  renderHeaderPrefix?: () => ReactNode;
  renderHeaderMetadata?: () => ReactNode;
  options?: Record<string, unknown>;
}) {
  return (
    <div data-testid="file-diff">
      {props.renderHeaderPrefix?.()}
      <span data-title="true">{props.fileDiff?.name ?? props.fileDiff?.prevName ?? "diff"}</span>
      {props.renderHeaderMetadata?.()}
    </div>
  );
}

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: MockFileDiff,
  Virtualizer: ({ children }: { children: ReactNode }) => (
    <div data-testid="virtualizer">{children}</div>
  ),
  WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useWorkerPool: () => ({
    getDiffRenderOptions: () => ({}),
    setDiffRenderOptions: noop,
  }),
}));

function buildVcsStatusResult(overrides: Record<string, unknown> = {}) {
  return {
    isRepo: true,
    sourceControlProvider: { provider: "github" },
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feat/test-branch",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  };
}

function buildTurnDiffSummary(overrides: Record<string, unknown> = {}) {
  return {
    turnId: "turn-1",
    completedAt: "2025-06-01T12:00:00Z",
    files: [] as readonly never[],
    ...overrides,
  };
}

const EMPTY_REVIEW_COMMENTS = {
  reviewDraft: null,
  comments: [] as readonly never[],
  draftPending: false,
  draftError: null,
  editingComment: null,
  savePending: false,
  saveError: null,
  submitting: false,
  submitError: null,
  startEditing: vi.fn(),
  cancelEditing: vi.fn(),
  saveComment: vi.fn(),
  deleteComment: vi.fn(),
  submitReview: vi.fn(),
  submitReviewWithBatchAgents: vi.fn(),
  runBackgroundAgent: vi.fn(),
  agentEvents: new Map(),
  agentRunning: new Set(),
  refreshDraft: vi.fn(),
};

function setupBaseMocks(overrides: {
  mockThread?: Record<string, unknown> | null;
  diffSearch?: Record<string, unknown>;
}) {
  const mockThread = overrides.mockThread ?? null;
  let useStoreCallIdx = 0;

  vi.doMock("../store", () => ({
    useStore: vi.fn(() => {
      useStoreCallIdx++;
      return useStoreCallIdx === 1 ? mockThread : null;
    }),
    selectProjectByRef: noop,
  }));
  vi.doMock("../storeSelectors", () => ({
    createThreadSelectorByRef: () => () => mockThread,
  }));
  vi.doMock("../hooks/useTheme", () => ({
    useTheme: () => ({ resolvedTheme: "light" as const }),
  }));
  vi.doMock("../hooks/useSettings", () => ({
    useSettings: () => ({
      diffWordWrap: true,
      diffIgnoreWhitespace: false,
      timestampFormat: "locale",
    }),
  }));
  vi.doMock("../hooks/useTurnDiffSummaries", () => ({
    useTurnDiffSummaries: () => ({
      turnDiffSummaries: mockThread ? [buildTurnDiffSummary()] : [],
      inferredCheckpointTurnCountByTurnId: new Map(),
    }),
  }));
  vi.doMock("../hooks/useReviewComments", () => ({
    useReviewComments: () => EMPTY_REVIEW_COMMENTS,
  }));
  vi.doMock("../lib/vcsStatusState", () => ({
    useVcsStatus: () => ({
      data: buildVcsStatusResult(),
      error: null,
      cause: null,
      isPending: false,
    }),
  }));
  vi.doMock("../lib/checkpointDiffState", () => ({
    useCheckpointDiff: () => ({ data: null, error: null, isPending: false }),
    invalidateCheckpointDiffs: vi.fn(),
  }));
  vi.doMock("../editorPreferences", () => ({
    openInPreferredEditor: vi.fn(),
  }));
  vi.doMock("../localApi", () => ({ readLocalApi: () => undefined }));
  vi.doMock("../environmentApi", () => ({ readEnvironmentApi: () => undefined }));

  vi.doMock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
    useParams: () =>
      mockThread
        ? { environmentId: "env-1", threadId: "thread-1" }
        : null,
    useSearch: () => overrides.diffSearch ?? { diff: "1" },
  }));
}

async function renderDiffPanel() {
  const { default: DiffPanel } = await import("./DiffPanel");
  return renderToStaticMarkup(<DiffPanel />);
}

// ── Tests ──

describe("DiffPanel — no thread", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows placeholder when no thread is active", async () => {
    setupBaseMocks({ mockThread: null });
    const markup = await renderDiffPanel();
    expect(markup).toContain("Select a thread to inspect turn diffs.");
  });
});

describe("DiffPanel — no git repo", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows unavailable when project is not a git repo", async () => {
    setupBaseMocks({
      mockThread: { projectId: "project-1", runtimeMode: "full-access", worktreePath: "/tmp/test" },
    });
    // Override VCS status mock to report no git repo
    vi.doMock("../lib/vcsStatusState", () => ({
      useVcsStatus: () => ({
        data: buildVcsStatusResult({ isRepo: false }),
        error: null,
        cause: null,
        isPending: false,
      }),
    }));

    const markup = await renderDiffPanel();
    expect(markup).toContain("Turn diffs are unavailable");
    expect(markup).toContain("not a git repository");
  });
});

describe("DiffPanel — checkpoint mode", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows 'No completed turns yet' when summaries are empty", async () => {
    const mockThread = {
      projectId: "project-1",
      runtimeMode: "full-access",
      worktreePath: "/tmp/test",
    };
    setupBaseMocks({ mockThread });
    vi.doMock("../hooks/useTurnDiffSummaries", () => ({
      useTurnDiffSummaries: () => ({
        turnDiffSummaries: [],
        inferredCheckpointTurnCountByTurnId: new Map(),
      }),
    }));

    const markup = await renderDiffPanel();
    expect(markup).toContain("No completed turns yet.");
  });

  it("renders toggle group with both checkpoint and PR items", async () => {
    const mockThread = {
      projectId: "project-1",
      runtimeMode: "full-access",
      worktreePath: "/tmp/test",
    };
    setupBaseMocks({ mockThread });
    vi.doMock("../lib/checkpointDiffState", () => ({
      useCheckpointDiff: () => ({
        data: {
          diff: "diff --git a/test.ts b/test.ts\nnew file mode 100644\nindex 000..111\n",
        },
        error: null,
        isPending: false,
      }),
      invalidateCheckpointDiffs: vi.fn(),
    }));

    const markup = await renderDiffPanel();
    expect(markup).toContain('aria-label="Checkpoint diff"');
    expect(markup).toContain('aria-label="PR diff"');
  });

  it("renders stacked/split render mode toggle", async () => {
    const mockThread = {
      projectId: "project-1",
      runtimeMode: "full-access",
      worktreePath: "/tmp/test",
    };
    setupBaseMocks({ mockThread });
    vi.doMock("../lib/checkpointDiffState", () => ({
      useCheckpointDiff: () => ({
        data: {
          diff: "diff --git a/test.ts b/test.ts\nnew file mode 100644\nindex 000..111\n",
        },
        error: null,
        isPending: false,
      }),
      invalidateCheckpointDiffs: vi.fn(),
    }));

    const markup = await renderDiffPanel();
    expect(markup).toContain('aria-label="Stacked diff view"');
    expect(markup).toContain('aria-label="Split diff view"');
  });

  it("renders word wrap and whitespace toggles", async () => {
    const mockThread = {
      projectId: "project-1",
      runtimeMode: "full-access",
      worktreePath: "/tmp/test",
    };
    setupBaseMocks({ mockThread });
    vi.doMock("../lib/checkpointDiffState", () => ({
      useCheckpointDiff: () => ({
        data: {
          diff: "diff --git a/test.ts b/test.ts\nnew file mode 100644\nindex 000..111\n",
        },
        error: null,
        isPending: false,
      }),
      invalidateCheckpointDiffs: vi.fn(),
    }));

    const markup = await renderDiffPanel();
    expect(markup).toContain('aria-label="Disable diff line wrapping"');
    expect(markup).toContain('aria-label="Hide whitespace changes"');
  });

  it("renders file diffs inside Virtualizer with checkpoint data", async () => {
    const mockThread = {
      projectId: "project-1",
      runtimeMode: "full-access",
      worktreePath: "/tmp/test",
    };
    setupBaseMocks({ mockThread });
    vi.doMock("../lib/checkpointDiffState", () => ({
      useCheckpointDiff: () => ({
        data: {
          diff: "diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,4 @@\n+new line\n",
        },
        error: null,
        isPending: false,
      }),
      invalidateCheckpointDiffs: vi.fn(),
    }));

    const markup = await renderDiffPanel();
    expect(markup).toContain('data-testid="virtualizer"');
    expect(markup).toContain('data-testid="file-diff"');
    expect(markup).toContain("src/foo.ts");
  });
});

describe("DiffPanel — no standalone Review button", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not render a standalone 'Review' text button (removed in this branch)", async () => {
    setupBaseMocks({
      mockThread: {
        projectId: "project-1",
        runtimeMode: "full-access",
        worktreePath: "/tmp/test",
      },
    });
    vi.doMock("../lib/checkpointDiffState", () => ({
      useCheckpointDiff: () => ({
        data: {
          diff: "diff --git a/test.ts b/test.ts\nnew file mode 100644\nindex 000..111\n",
        },
        error: null,
        isPending: false,
      }),
      invalidateCheckpointDiffs: vi.fn(),
    }));

    const markup = await renderDiffPanel();
    expect(markup).not.toContain(">Review<");
  });
});

describe("DiffPanel — routing", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders without errors when diff panel is not open (diffSearch.diff !== '1')", async () => {
    setupBaseMocks({
      mockThread: {
        projectId: "project-1",
        runtimeMode: "full-access",
        worktreePath: "/tmp/test",
      },
      diffSearch: { diff: "0" },
    });

    const markup = await renderDiffPanel();
    expect(markup).not.toContain("No completed turns yet.");
    expect(markup).not.toContain("Select a thread");
  });
});
