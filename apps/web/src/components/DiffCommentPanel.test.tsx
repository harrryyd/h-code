import type { ReviewComment } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DiffCommentPanel } from "./DiffCommentPanel";

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "test-1",
    file: "src/app.ts",
    line: 42,
    commitSHA: "abc123",
    body: "Test comment body.",
    author: { login: "tester" },
    createdAt: "2025-06-01T12:00:00Z",
    ...overrides,
  };
}

describe("DiffCommentPanel", () => {
  it("renders an existing comment with body and author", () => {
    const comment = makeComment();
    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[comment]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
      />,
    );

    expect(markup).toContain("Test comment body.");
    expect(markup).toContain("tester");
    expect(markup).toContain("Line 42");
  });

  it("renders file-level comment without line number", () => {
    const comment = makeComment({ line: undefined });
    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[comment]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
      />,
    );

    expect(markup).toContain("Test comment body.");
    expect(markup).not.toContain("Line 42");
  });

  it("applies GitHub badge styling for non-local comments", () => {
    const comment = makeComment({ author: { login: "github-bot" } });
    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[comment]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
      />,
    );

    expect(markup).toContain("GitHub");
    expect(markup).toContain("github-bot");
  });

  it("shows edit form when editing comment for matching file", () => {
    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[]}
        editingComment={{ filePath: "src/app.ts", lineNumber: 10 }}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
      />,
    );

    expect(markup).toContain("Write a comment");
    expect(markup).toContain("src/app.ts:10");
  });

  it("uses filePath only for file-level editing comment", () => {
    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[]}
        editingComment={{ filePath: "src/app.ts", lineNumber: null }}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
      />,
    );

    expect(markup).toContain("Write a comment");
    expect(markup).toContain("src/app.ts");
    expect(markup).not.toContain("src/app.ts:");
  });

  it("renders multiple comments for the same file", () => {
    const comment1 = makeComment({ id: "c1", body: "First" });
    const comment2 = makeComment({ id: "c2", body: "Second", author: { login: "github-bot" } });
    const otherComment = makeComment({ id: "c3", file: "other.ts", body: "Other file" });

    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[comment1, comment2, otherComment]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
      />,
    );

    expect(markup).toContain("First");
    expect(markup).toContain("Second");
    expect(markup).not.toContain("Other file");
  });

  it("filters comments to matching file only", () => {
    const comments = [
      makeComment({ id: "a", file: "a.ts", body: "File A" }),
      makeComment({ id: "b", file: "b.ts", body: "File B" }),
    ];

    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="a.ts"
        comments={comments}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
      />,
    );

    expect(markup).toContain("File A");
    expect(markup).not.toContain("File B");
  });

  it("shows save error when present", () => {
    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[]}
        editingComment={{ filePath: "src/app.ts", lineNumber: 1 }}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError="Failed to save comment"
      />,
    );

    expect(markup).toContain("Failed to save comment");
  });

  it("shows comment-on-file button when not editing", () => {
    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
      />,
    );

    expect(markup).toContain("Comment on file");
  });

  it("hides add comment buttons while editing", () => {
    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[]}
        editingComment={{ filePath: "src/app.ts", lineNumber: 1 }}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
      />,
    );

    expect(markup).toContain("Write a comment");
    expect(markup).not.toContain("Comment on file");
    expect(markup).not.toContain("Comment on line");
  });

  it("collapses outdated comments under toggle when PR head SHA changed", () => {
    const currentSHA = "def456";
    const storedSHA = "abc123";
    const outdatedComment = makeComment({
      id: "old",
      commitSHA: storedSHA,
      body: "Old review comment.",
    });
    const currentComment = makeComment({
      id: "new",
      commitSHA: currentSHA,
      body: "Current review comment.",
    });

    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[outdatedComment, currentComment]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
        currentPrHeadSHA={currentSHA}
        storedPrHeadSHA={storedSHA}
      />,
    );

    expect(markup).toContain("Show 1 outdated");
    expect(markup).toContain("Current review comment.");
    expect(markup).toContain("1 outdated");
  });

  it("renders outdated comments with body and Outdated badge when expanded", () => {
    const currentSHA = "def456";
    const storedSHA = "abc123";
    const outdatedComment = makeComment({
      id: "old",
      commitSHA: storedSHA,
      body: "Old review comment.",
    });

    // Verify that the outdated comment body and Outdated badge exist
    // in the component logic (even though SSR has collapsed state)
    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[outdatedComment]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
        currentPrHeadSHA={currentSHA}
        storedPrHeadSHA={storedSHA}
      />,
    );

    expect(markup).toContain("Show 1 outdated");
    expect(markup).toContain("1 outdated");
    expect(markup).toContain("Old review comment.");
    expect(markup).toContain("Outdated");
  });

  it("does not show outdated toggle when PR head SHA is unchanged", () => {
    const sha = "abc123";
    const comment = makeComment({ commitSHA: sha, body: "My comment." });

    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[comment]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
        currentPrHeadSHA={sha}
        storedPrHeadSHA={sha}
      />,
    );

    expect(markup).not.toContain("Show");
    expect(markup).not.toContain("Outdated");
    expect(markup).toContain("My comment.");
  });

  it("does not show outdated toggle when currentPrHeadSHA is not provided", () => {
    const sha = "abc123";
    const comment = makeComment({ commitSHA: sha, body: "My comment." });

    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/app.ts"
        comments={[comment]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
      />,
    );

    expect(markup).not.toContain("Outdated");
    expect(markup).toContain("My comment.");
  });

  it("file-level comments without line number are not stale when file is unmodified", () => {
    const currentSHA = "def456";
    const storedSHA = "abc123";
    const fileComment = makeComment({
      id: "unmod",
      file: "src/unmodified.ts",
      commitSHA: storedSHA,
      body: "Unmodified file comment.",
      line: undefined,
    });

    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/unmodified.ts"
        comments={[fileComment]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
        currentPrHeadSHA={currentSHA}
        storedPrHeadSHA={storedSHA}
        modifiedFiles={new Set(["src/modified.ts"])}
      />,
    );

    expect(markup).toContain("Unmodified file comment.");
    expect(markup).not.toContain("Outdated");
    expect(markup).not.toContain("Show");
  });

  it("file-level comments are stale when their file was modified", () => {
    const currentSHA = "def456";
    const storedSHA = "abc123";
    const fileComment = makeComment({
      id: "mod",
      file: "src/modified.ts",
      commitSHA: storedSHA,
      body: "Modified file comment.",
      line: undefined,
    });

    const markup = renderToStaticMarkup(
      <DiffCommentPanel
        filePath="src/modified.ts"
        comments={[fileComment]}
        editingComment={null}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSaveComment={async () => {}}
        onDeleteComment={() => {}}
        savePending={false}
        saveError={null}
        currentPrHeadSHA={currentSHA}
        storedPrHeadSHA={storedSHA}
        modifiedFiles={new Set(["src/modified.ts"])}
      />,
    );

    expect(markup).toContain("Show 1 outdated");
    expect(markup).toContain("Modified file comment.");
    expect(markup).toContain("Outdated");
  });
});
