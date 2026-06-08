import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ReviewComment, ReviewDraft } from "./sourceControl.ts";

const decodeReviewComment = Schema.decodeUnknownSync(ReviewComment);
const decodeReviewDraft = Schema.decodeUnknownSync(ReviewDraft);

describe("ReviewComment", () => {
  it("decodes a valid review comment", () => {
    const parsed = decodeReviewComment({
      id: "comment-1",
      file: "src/app.ts",
      commitSHA: "abc123",
      body: "Consider using a more descriptive variable name.",
      author: { login: "codex-bot" },
      createdAt: "2025-06-01T12:00:00Z",
    });

    expect(parsed.id).toBe("comment-1");
    expect(parsed.file).toBe("src/app.ts");
    expect(parsed.commitSHA).toBe("abc123");
    expect(parsed.body).toBe("Consider using a more descriptive variable name.");
    expect(parsed.author).toEqual({ login: "codex-bot" });
    expect(parsed.line).toBeUndefined();
    expect(parsed.replies).toBeUndefined();
    expect(parsed.agentStatus).toBeUndefined();
  });

  it("decodes a review comment with an optional line number", () => {
    const parsed = decodeReviewComment({
      id: "comment-2",
      file: "src/app.ts",
      line: 42,
      commitSHA: "abc123",
      body: "NIT: typo in variable name",
      author: { login: "codex-bot" },
      createdAt: "2025-06-01T12:00:00Z",
    });

    expect(parsed.line).toBe(42);
  });

  it("decodes a review comment with agent status (legacy values)", () => {
    expect(decodeReviewComment({
      id: "comment-legacy-1",
      file: "src/old.ts",
      commitSHA: "abc123",
      body: "Legacy pending comment",
      agentStatus: "pending",
      author: { login: "bot" },
      createdAt: "2025-01-01T00:00:00Z",
    }).agentStatus).toBe("pending");

    expect(decodeReviewComment({
      id: "comment-legacy-2",
      file: "src/old.ts",
      commitSHA: "abc123",
      body: "Legacy resolved comment",
      agentStatus: "resolved",
      author: { login: "bot" },
      createdAt: "2025-01-01T00:00:00Z",
    }).agentStatus).toBe("resolved");

    expect(decodeReviewComment({
      id: "comment-legacy-3",
      file: "src/old.ts",
      commitSHA: "abc123",
      body: "Legacy suggestion comment",
      agentStatus: "suggestion",
      author: { login: "bot" },
      createdAt: "2025-01-01T00:00:00Z",
    }).agentStatus).toBe("suggestion");
  });

  it("decodes a review comment with agent status (new values)", () => {
    expect(decodeReviewComment({
      id: "comment-3",
      file: "src/utils.ts",
      commitSHA: "def456",
      body: "Refactor to reduce complexity.",
      agentStatus: "running",
      author: { login: "codex-bot" },
      createdAt: "2025-06-02T08:30:00Z",
    }).agentStatus).toBe("running");

    expect(decodeReviewComment({
      id: "comment-idle",
      file: "src/idle.ts",
      commitSHA: "def456",
      body: "Idle agent",
      agentStatus: "idle",
      author: { login: "bot" },
      createdAt: "2025-01-01T00:00:00Z",
    }).agentStatus).toBe("idle");

    expect(decodeReviewComment({
      id: "comment-failed",
      file: "src/failed.ts",
      commitSHA: "def456",
      body: "Failed agent",
      agentStatus: "failed",
      author: { login: "bot" },
      createdAt: "2025-01-01T00:00:00Z",
    }).agentStatus).toBe("failed");

    expect(decodeReviewComment({
      id: "comment-completed",
      file: "src/done.ts",
      commitSHA: "def456",
      body: "Completed agent",
      agentStatus: "completed",
      author: { login: "bot" },
      createdAt: "2025-01-01T00:00:00Z",
    }).agentStatus).toBe("completed");
  });

  it("decodes a review comment with nested replies", () => {
    const parsed = decodeReviewComment({
      id: "comment-4",
      file: "src/app.ts",
      line: 10,
      commitSHA: "abc123",
      body: "Why is this using any type?",
      author: { login: "reviewer" },
      createdAt: "2025-06-01T12:00:00Z",
      replies: [
        {
          id: "reply-1",
          file: "src/app.ts",
          line: 10,
          commitSHA: "abc123",
          body: "Good catch, fixed in next commit.",
          author: { login: "developer" },
          createdAt: "2025-06-01T12:05:00Z",
        },
      ],
    });

    expect(parsed.replies).toHaveLength(1);
    expect(parsed.replies?.[0]?.id).toBe("reply-1");
    expect(parsed.replies?.[0]?.body).toBe("Good catch, fixed in next commit.");
  });

  it("rejects a review comment with a missing required field", () => {
    expect(() =>
      decodeReviewComment({
        file: "src/app.ts",
        commitSHA: "abc123",
        body: "missing id",
        author: { login: "codex-bot" },
        createdAt: "2025-06-01T12:00:00Z",
      }),
    ).toThrow();
  });

  it("rejects a review comment with empty body", () => {
    expect(() =>
      decodeReviewComment({
        id: "comment-5",
        file: "src/app.ts",
        commitSHA: "abc123",
        body: "",
        author: { login: "codex-bot" },
        createdAt: "2025-06-01T12:00:00Z",
      }),
    ).toThrow();
  });

  it("rejects a review comment with negative line number", () => {
    expect(() =>
      decodeReviewComment({
        id: "comment-6",
        file: "src/app.ts",
        line: -1,
        commitSHA: "abc123",
        body: "invalid line number",
        author: { login: "codex-bot" },
        createdAt: "2025-06-01T12:00:00Z",
      }),
    ).toThrow();
  });
});

describe("ReviewDraft", () => {
  it("decodes a valid review draft", () => {
    const parsed = decodeReviewDraft({
      threadId: "thread-123",
      prNumber: 42,
      prHeadSHA: "abc123def456",
      comments: [],
      state: "draft",
    });

    expect(parsed.threadId).toBe("thread-123");
    expect(parsed.prNumber).toBe(42);
    expect(parsed.prHeadSHA).toBe("abc123def456");
    expect(parsed.comments).toEqual([]);
    expect(parsed.state).toBe("draft");
  });

  it("decodes a review draft with multiple comments", () => {
    const parsed = decodeReviewDraft({
      threadId: "thread-456",
      prNumber: 99,
      prHeadSHA: "sha256",
      state: "draft",
      comments: [
        {
          id: "c1",
          file: "src/a.ts",
          commitSHA: "abc",
          body: "First comment",
          author: { login: "bot" },
          createdAt: "2025-06-01T12:00:00Z",
        },
        {
          id: "c2",
          file: "src/b.ts",
          line: 33,
          commitSHA: "abc",
          body: "Second comment",
          agentStatus: "completed",
          author: { login: "bot" },
          createdAt: "2025-06-01T12:01:00Z",
        },
      ],
    });

    expect(parsed.comments).toHaveLength(2);
    expect(parsed.comments[0]?.id).toBe("c1");
    expect(parsed.comments[1]?.id).toBe("c2");
    expect(parsed.comments[1]?.agentStatus).toBe("completed");
  });

  it("rejects a review draft with prNumber of 0", () => {
    expect(() =>
      decodeReviewDraft({
        threadId: "thread-789",
        prNumber: 0,
        prHeadSHA: "abc",
        comments: [],
        state: "draft",
      }),
    ).toThrow();
  });

  it("rejects a review draft with invalid state", () => {
    expect(() =>
      decodeReviewDraft({
        threadId: "thread-789",
        prNumber: 1,
        prHeadSHA: "abc",
        comments: [],
        state: "invalid",
      }),
    ).toThrow();
  });
});
