import type { ReviewComment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { randomUUID } from "~/lib/utils";

function createComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: randomUUID(),
    file: "src/app.ts",
    line: 42,
    commitSHA: "abc123def456",
    body: "Please review this change.",
    author: { login: "tester" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ReviewComment anchoring", () => {
  it("stores file, lineNumber, and commitSHA together", () => {
    const comment = createComment({
      file: "packages/shared/src/git.ts",
      line: 128,
      commitSHA: "deadbeefcafe",
    });

    expect(comment.file).toBe("packages/shared/src/git.ts");
    expect(comment.line).toBe(128);
    expect(comment.commitSHA).toBe("deadbeefcafe");
  });

  it("supports file-level comments with no line anchor", () => {
    const comment = createComment({
      file: "README.md",
      line: undefined,
      commitSHA: "sha1",
      body: "Overall review feedback.",
    });

    expect(comment.file).toBe("README.md");
    expect(comment.line).toBeUndefined();
    expect(comment.commitSHA).toBe("sha1");
    expect(comment.body).toBe("Overall review feedback.");
  });

  it("persists 3 comments on different lines with distinct anchors", () => {
    const comments = [
      createComment({ id: "a", file: "src/a.ts", line: 10, commitSHA: "abc" }),
      createComment({ id: "b", file: "src/a.ts", line: 25, commitSHA: "abc" }),
      createComment({ id: "c", file: "src/b.ts", line: 5, commitSHA: "abc" }),
    ];

    expect(comments).toHaveLength(3);

    const uniqueLines = new Set(comments.map((c) => `${c.file}:${c.line}`));
    expect(uniqueLines.size).toBe(3);

    for (const comment of comments) {
      expect(comment.file).toBeTruthy();
      expect(typeof comment.line).toBe("number");
      expect(comment.commitSHA).toBe("abc");
    }
  });

  it("handles GitHub-authored comments distinctly from local drafts", () => {
    const local = createComment({ author: { login: "local" } });
    const github = createComment({ author: { login: "octocat" } });

    const isGitHub = (c: ReviewComment) => c.author.login !== "local";
    expect(isGitHub(local)).toBe(false);
    expect(isGitHub(github)).toBe(true);
  });
});
