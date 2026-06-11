import { EnvironmentId, ThreadId, type EnvironmentApi } from "@t3tools/contracts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { useReviewComments, type UseReviewCommentsResult } from "./useReviewComments";
import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../environmentApi";

const ENVIRONMENT_ID = EnvironmentId.make("test-env");
const THREAD_ID = ThreadId.make("thread-1");
const PR_NUMBER = 42;

let capturedResult: UseReviewCommentsResult | null = null;

function CaptureComponent(props: {
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  prNumber: number | null;
  prHeadSHA: string | null;
}) {
  const result = useReviewComments({
    environmentId: props.environmentId,
    threadId: props.threadId,
    prNumber: props.prNumber,
    prHeadSHA: props.prHeadSHA,
  });
  capturedResult = result;
  return null;
}

function renderCapture(
  options: {
    environmentId?: EnvironmentId | null;
    threadId?: ThreadId | null;
    prNumber?: number | null;
    prHeadSHA?: string | null;
  } = {},
) {
  capturedResult = null;
  renderToStaticMarkup(
    React.createElement(CaptureComponent, {
      environmentId: options.environmentId ?? ENVIRONMENT_ID,
      threadId: options.threadId ?? THREAD_ID,
      prNumber: options.prNumber ?? PR_NUMBER,
      prHeadSHA: options.prHeadSHA ?? "abc123",
    }),
  );
}

function setupMockApi(
  mockSubmitReview: ReturnType<typeof vi.fn>,
  overrides: Partial<EnvironmentApi["changeRequest"]> = {},
) {
  const api: EnvironmentApi = {
    terminal: {},
    projects: {},
    filesystem: {},
    sourceControl: {},
    vcs: {},
    git: {},
    mcp: {},
    review: {},
    changeRequest: {
      getPrDiff: vi.fn(),
      getReviewDraft: vi.fn(),
      upsertReviewComment: vi.fn(),
      deleteReviewComment: vi.fn(),
      submitReview: mockSubmitReview,
      runBackgroundAgent: vi.fn(),
      runBatchAgents: vi.fn(),
      ...overrides,
    },
    orchestration: {},
  } as unknown as EnvironmentApi;

  __setEnvironmentApiOverrideForTests(ENVIRONMENT_ID, api);
}

beforeAll(() => {
  vi.stubGlobal("window", {
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    desktopBridge: undefined,
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetEnvironmentApiOverridesForTests();
  capturedResult = null;
});

describe("useReviewComments", () => {
  let mockSubmitReview: ReturnType<typeof vi.fn>;

  describe("submitReview", () => {
    it("calls submitReview WITHOUT runBatchAgents when submitReview is invoked directly", async () => {
      mockSubmitReview = vi.fn();
      const mockDraft = { id: "draft-1", prHeadSHA: "abc123", comments: [] };
      mockSubmitReview.mockResolvedValue(mockDraft);

      setupMockApi(mockSubmitReview);
      renderCapture();

      expect(capturedResult).not.toBeNull();
      const result = await capturedResult!.submitReview();

      expect(mockSubmitReview).toHaveBeenCalledTimes(1);
      const callArg = mockSubmitReview.mock.calls[0]?.[0];
      expect(callArg).not.toHaveProperty("runBatchAgents");
      expect(callArg).toEqual({
        threadId: THREAD_ID,
        prNumber: PR_NUMBER,
      });
      expect(result).toEqual(mockDraft);
    });
  });

  describe("submitReviewWithBatchAgents", () => {
    it("calls submitReview WITH runBatchAgents: true when submitReviewWithBatchAgents is invoked", () => {
      mockSubmitReview = vi.fn();
      const mockDraft = {
        id: "draft-1",
        prHeadSHA: "abc123",
        comments: [
          {
            id: "c1",
            file: "x.ts",
            body: "x",
            commitSHA: "abc123",
            author: { login: "local" },
            createdAt: "now",
          },
        ],
      };
      mockSubmitReview.mockResolvedValue(mockDraft);

      setupMockApi(mockSubmitReview);
      renderCapture();

      expect(capturedResult).not.toBeNull();
      capturedResult!.submitReviewWithBatchAgents();

      expect(mockSubmitReview).toHaveBeenCalledTimes(1);
      expect(mockSubmitReview).toHaveBeenCalledWith({
        threadId: THREAD_ID,
        prNumber: PR_NUMBER,
        runBatchAgents: true,
      });
    });
  });

  describe("toggle off — no agents spawned", () => {
    it("does NOT call runBatchAgents when submitReview is called (toggle off)", async () => {
      mockSubmitReview = vi.fn();
      const mockRunBatchAgents = vi.fn();
      const mockDraft = { id: "draft-1", prHeadSHA: "abc123", comments: [] };
      mockSubmitReview.mockResolvedValue(mockDraft);

      setupMockApi(mockSubmitReview, { runBatchAgents: mockRunBatchAgents });
      renderCapture();

      expect(capturedResult).not.toBeNull();
      await capturedResult!.submitReview();

      expect(mockRunBatchAgents).not.toHaveBeenCalled();
    });

    it("does NOT pass runBatchAgents: true when submitReview is called (toggle off)", async () => {
      mockSubmitReview = vi.fn();
      const mockDraft = { id: "draft-1", prHeadSHA: "abc123", comments: [] };
      mockSubmitReview.mockResolvedValue(mockDraft);

      setupMockApi(mockSubmitReview);
      renderCapture();

      expect(capturedResult).not.toBeNull();
      await capturedResult!.submitReview();

      expect(mockSubmitReview).toHaveBeenCalledWith(
        expect.not.objectContaining({ runBatchAgents: expect.anything() }),
      );
    });

    it("passes runBatchAgents: true when submitReviewWithBatchAgents is called (toggle on)", () => {
      mockSubmitReview = vi.fn();
      const mockDraft = {
        id: "draft-1",
        prHeadSHA: "abc123",
        comments: [],
      };
      mockSubmitReview.mockResolvedValue(mockDraft);

      setupMockApi(mockSubmitReview);
      renderCapture();

      expect(capturedResult).not.toBeNull();
      capturedResult!.submitReviewWithBatchAgents();

      expect(mockSubmitReview).toHaveBeenCalledWith({
        threadId: THREAD_ID,
        prNumber: PR_NUMBER,
        runBatchAgents: true,
      });
    });
  });
});
