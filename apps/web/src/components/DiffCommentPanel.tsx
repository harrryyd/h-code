import type { ReviewComment } from "@t3tools/contracts";
import { MessageCircleIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "~/lib/utils";
import { formatShortTimestamp } from "../timestampFormat";

interface InlineCommentInputProps {
  filePath: string;
  lineNumber: number | null;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}

function InlineCommentInput({
  filePath,
  lineNumber,
  onSave,
  onCancel,
  pending,
  error,
}: InlineCommentInputProps) {
  const [body, setBody] = useState("");
  const trimmed = body.trim();

  const handleSave = useCallback(() => {
    if (!trimmed) return;
    void onSave(trimmed);
  }, [trimmed, onSave]);

  return (
    <div className="mx-3 mb-2 rounded-md border border-border/70 bg-background/60 p-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground/80">
          {filePath}
          {lineNumber !== null ? `:${lineNumber}` : ""}
        </span>
        <button
          type="button"
          className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground/60 hover:bg-foreground/8 hover:text-foreground/70"
          onClick={onCancel}
          disabled={pending}
        >
          <XIcon className="size-3" />
        </button>
      </div>
      <textarea
        className="w-full resize-none rounded-sm border border-border/60 bg-background/80 px-2 py-1.5 font-mono text-[11px] text-foreground/90 placeholder:text-muted-foreground/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a comment..."
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSave();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {error && (
        <p className="mt-1 text-[10px] text-red-500/80">{error}</p>
      )}
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <button
          type="button"
          className="inline-flex h-6 items-center rounded-sm px-2 text-[10px] text-muted-foreground/60 hover:bg-foreground/8 hover:text-foreground/70"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex h-6 items-center rounded-sm px-2.5 text-[10px] font-medium",
            trimmed && !pending
              ? "bg-primary/15 text-primary hover:bg-primary/20"
              : "bg-foreground/6 text-muted-foreground/50",
          )}
          onClick={handleSave}
          disabled={!trimmed || pending}
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

interface InlineCommentProps {
  comment: ReviewComment;
  onDelete?: (commentId: string) => void;
}

function InlineComment({ comment, onDelete }: InlineCommentProps) {
  const isGitHub = comment.author.login !== "local";

  return (
    <div
      className={cn(
        "mx-3 mb-1 rounded-md border p-2.5",
        isGitHub
          ? "border-border/50 bg-amber-500/5"
          : "border-border/70 bg-background/60",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-[10px] font-medium",
              isGitHub ? "text-amber-400/80" : "text-primary/80",
            )}
          >
            {comment.author.login}
          </span>
          {isGitHub && (
            <span className="rounded-full border border-amber-500/30 px-1 py-px text-[8px] text-amber-400/60">
              GitHub
            </span>
          )}
          <span className="text-[9px] text-muted-foreground/50">
            {formatShortTimestamp(comment.createdAt, "iso")}
          </span>
        </div>
        {onDelete && !isGitHub && (
          <button
            type="button"
            className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground/40 hover:bg-foreground/8 hover:text-red-500/70"
            onClick={() => onDelete(comment.id)}
            title="Delete comment"
          >
            <Trash2Icon className="size-3" />
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/85">
        {comment.body}
      </p>
      {typeof comment.line === "number" && (
        <div className="mt-1 text-[9px] text-muted-foreground/40">
          Line {comment.line}
        </div>
      )}
    </div>
  );
}

interface DiffCommentPanelProps {
  filePath: string;
  comments: readonly ReviewComment[];
  editingComment: { filePath: string; lineNumber: number | null } | null;
  onStartEditing: (filePath: string, lineNumber: number | null) => void;
  onCancelEditing: () => void;
  onSaveComment: (body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => void;
  savePending: boolean;
  saveError: string | null;
}

export function DiffCommentPanel({
  filePath,
  comments,
  editingComment,
  onStartEditing,
  onCancelEditing,
  onSaveComment,
  onDeleteComment,
  savePending,
  saveError,
}: DiffCommentPanelProps) {
  const fileComments = comments.filter((c) => c.file === filePath);
  const isEditing = editingComment?.filePath === filePath;

  return (
    <div className="diff-comment-panel py-1">
      {fileComments.map((comment) => (
        <InlineComment
          key={comment.id}
          comment={comment}
          onDelete={onDeleteComment}
        />
      ))}
      {isEditing && (
        <InlineCommentInput
          filePath={editingComment!.filePath}
          lineNumber={editingComment!.lineNumber}
          onSave={onSaveComment}
          onCancel={onCancelEditing}
          pending={savePending}
          error={saveError}
        />
      )}
      {!isEditing && (
        <div className="flex gap-1 px-3">
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[10px] text-muted-foreground/50 hover:bg-foreground/6 hover:text-muted-foreground/70"
            onClick={() => onStartEditing(filePath, null)}
            title="Add file-level comment"
          >
            <PlusIcon className="size-3" />
            <span>Comment on file</span>
          </button>
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[10px] text-muted-foreground/50 hover:bg-foreground/6 hover:text-muted-foreground/70"
            onClick={() => onStartEditing(filePath, null)}
            title="Add line comment"
          >
            <MessageCircleIcon className="size-3" />
            <span>Comment on line</span>
          </button>
        </div>
      )}
    </div>
  );
}
