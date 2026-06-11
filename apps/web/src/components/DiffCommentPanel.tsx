import type { ReviewComment } from "@t3tools/contracts";
import { Loader2Icon, CheckIcon, XIcon, BotIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "~/lib/utils";
import { formatShortTimestamp } from "../timestampFormat";
import type { BackgroundAgentEvent } from "../hooks/useReviewComments";

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

function AgentResponseDisplay({
  events,
  isRunning,
}: {
  events: BackgroundAgentEvent[];
  isRunning: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);

  const textEvents = events.filter((e) => e.type === "text");
  const detailEvents = events.filter((e) => e.type === "detail");
  const hasError = events.some((e) => e.type === "error");
  const isComplete = events.some((e) => e.type === "done");

  if (events.length === 0 && !isRunning) return null;

  return (
    <div className="mx-3 mb-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <Loader2Icon className="size-3 animate-spin text-blue-400" />
          ) : hasError ? (
            <XIcon className="size-3 text-red-400" />
          ) : isComplete ? (
            <CheckIcon className="size-3 text-green-400" />
          ) : (
            <BotIcon className="size-3 text-blue-400" />
          )}
          <span className="text-[10px] font-medium text-blue-400/80">AI Response</span>
        </div>
      </div>

      {/* Visible text output */}
      {textEvents.length > 0 && (
        <div className="mb-1 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/85">
          {textEvents.map((e, i) => (
            <span key={i}>{e.content}</span>
          ))}
        </div>
      )}

      {isRunning && textEvents.length === 0 && (
        <p className="text-[10px] text-muted-foreground/50 animate-pulse">
          Agent is working...
        </p>
      )}

      {/* Error message */}
      {hasError && (
        <p className="text-[10px] text-red-400/80">
          {events.find((e) => e.type === "error")?.message ?? "Agent encountered an error."}
        </p>
      )}

      {/* Show details toggle */}
      {detailEvents.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[9px] text-muted-foreground/50 hover:text-muted-foreground/70"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            Show details ({detailEvents.length})
          </button>
          {showDetails && (
            <div className="mt-1 space-y-1">
              {detailEvents.map((e, i) => (
                <details key={i} className="text-[10px]">
                  <summary className="cursor-pointer text-muted-foreground/60 hover:text-muted-foreground/80">
                    {e.title ?? "Detail"}
                  </summary>
                  <pre className="mt-0.5 max-h-32 overflow-auto rounded border border-border/30 bg-background/80 p-1.5 text-[9px] whitespace-pre-wrap text-muted-foreground/70">
                    {e.content}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface InlineCommentProps {
  comment: ReviewComment;
  onDelete?: ((commentId: string) => void) | undefined;
  onRequestAgent?: ((commentId: string) => void) | undefined;
  agentEvents?: BackgroundAgentEvent[] | undefined;
  agentRunning?: boolean | undefined;
}

function InlineComment({
  comment,
  onDelete,
  onRequestAgent,
  agentEvents,
  agentRunning,
  outdated,
}: InlineCommentProps & { outdated?: boolean }) {
  const isGitHub = comment.author.login !== "local";
  const agentStatus = comment.agentStatus;
  const isAgentIdle = !agentStatus || agentStatus === "idle";
  const isAgentRunning = agentRunning || agentStatus === "running";

  return (
    <div
      className={cn(
        "mx-3 mb-1 rounded-md border p-2.5",
        outdated
          ? "border-border/30 bg-foreground/3 opacity-60"
          : isGitHub
            ? "border-border/50 bg-amber-500/5"
            : "border-border/70 bg-background/60",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-[10px] font-medium",
              outdated
                ? "text-muted-foreground/50"
                : isGitHub
                  ? "text-amber-400/80"
                  : "text-primary/80",
            )}
          >
            {comment.author.login}
          </span>
          {outdated && (
            <span className="rounded-full border border-muted-foreground/30 px-1 py-px text-[8px] text-muted-foreground/50">
              Outdated
            </span>
          )}
          {isGitHub && !outdated && (
            <span className="rounded-full border border-amber-500/30 px-1 py-px text-[8px] text-amber-400/60">
              GitHub
            </span>
          )}
          <span className="text-[9px] text-muted-foreground/50">
            {formatShortTimestamp(comment.createdAt, "24-hour")}
          </span>
          {/* Agent status indicator */}
          {agentStatus === "completed" && (
            <span className="inline-flex items-center gap-0.5 text-[8px] text-green-400/70">
              <CheckIcon className="size-2.5" />
              Done
            </span>
          )}
          {agentStatus === "failed" && (
            <span className="inline-flex items-center gap-0.5 text-[8px] text-red-400/70">
              <XIcon className="size-2.5" />
              Failed
            </span>
          )}
          {isAgentRunning && (
            <Loader2Icon className="size-2.5 animate-spin text-blue-400" />
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {/* Request AI response button */}
          {onRequestAgent && isAgentIdle && (
            <button
              type="button"
              className="inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[9px] text-blue-400/60 hover:bg-blue-500/10 hover:text-blue-400/80"
              onClick={() => onRequestAgent(comment.id)}
              title="Request AI response"
            >
              <BotIcon className="size-2.5" />
              Request AI
            </button>
          )}
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
      </div>
      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/85">
        {comment.body}
      </p>
      {typeof comment.line === "number" && (
        <div className="mt-1 text-[9px] text-muted-foreground/40">
          Line {comment.line}
        </div>
      )}

      {/* Agent response events */}
      {agentEvents && agentEvents.length > 0 && (
        <AgentResponseDisplay events={agentEvents} isRunning={isAgentRunning} />
      )}
      {isAgentRunning && (!agentEvents || agentEvents.length === 0) && (
        <AgentResponseDisplay events={[]} isRunning={true} />
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
  onRequestAgent?: ((commentId: string) => void) | undefined;
  agentEvents?: Map<string, BackgroundAgentEvent[]> | undefined;
  agentRunning?: Set<string> | undefined;
  currentPrHeadSHA?: string | null | undefined;
  storedPrHeadSHA?: string | null | undefined;
  modifiedFiles?: ReadonlySet<string> | undefined;
}

function isCommentOutdated(
  comment: ReviewComment,
  currentPrHeadSHA: string | null | undefined,
  storedPrHeadSHA: string | null | undefined,
  filePath: string,
  modifiedFiles: ReadonlySet<string> | undefined,
): boolean {
  if (!currentPrHeadSHA || !storedPrHeadSHA) return false;
  if (currentPrHeadSHA === storedPrHeadSHA) return false;
  if (comment.commitSHA === currentPrHeadSHA) return false;
  if (typeof comment.line !== "number") {
    return modifiedFiles?.has(filePath) ?? false;
  }
  return true;
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
  onRequestAgent,
  agentEvents,
  agentRunning,
  currentPrHeadSHA,
  storedPrHeadSHA,
  modifiedFiles,
}: DiffCommentPanelProps) {
  const [showOutdated, setShowOutdated] = useState(false);
  const fileComments = comments.filter((c) => c.file === filePath);
  const isEditing = editingComment?.filePath === filePath;

  const outdatedComments = fileComments.filter((c) =>
    isCommentOutdated(c, currentPrHeadSHA, storedPrHeadSHA, filePath, modifiedFiles),
  );
  const currentComments = fileComments.filter(
    (c) => !isCommentOutdated(c, currentPrHeadSHA, storedPrHeadSHA, filePath, modifiedFiles),
  );

  const commentedLines = currentComments
    .filter((c) => typeof c.line === "number")
    .map((c) => c.line as number);
  const uniqueCommentedLines = [...new Set(commentedLines)].sort((a, b) => a - b);

  return (
    <div className="diff-comment-panel py-1">
      {fileComments.length > 0 && (
        <div className="mx-3 mb-1 flex items-center gap-1.5 text-[9px] text-muted-foreground/50">
          <span>{currentComments.length} comment{currentComments.length !== 1 ? "s" : ""}</span>
          {outdatedComments.length > 0 && (
            <span className="text-muted-foreground/40">
              ({outdatedComments.length} outdated)
            </span>
          )}
          {uniqueCommentedLines.length > 0 && (
            <span>
              on line{uniqueCommentedLines.length !== 1 ? "s" : ""}{" "}
              {uniqueCommentedLines.map((line) => (
                <button
                  key={line}
                  type="button"
                  className="inline-flex size-4 items-center justify-center rounded-sm bg-foreground/6 text-[8px] font-medium text-muted-foreground/70 hover:bg-foreground/12 hover:text-foreground/70"
                  onClick={() => onStartEditing(filePath, line)}
                  title={`Comment on line ${line}`}
                >
                  {line}
                </button>
              )).reduce((prev, curr) => <>{prev} {curr}</> as never)}
            </span>
          )}
        </div>
      )}
      {outdatedComments.length > 0 && (
        <div className="mx-3 mb-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[9px] text-muted-foreground/50 hover:text-muted-foreground/70"
            onClick={() => setShowOutdated(!showOutdated)}
          >
            {showOutdated ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            Show {outdatedComments.length} outdated
          </button>
          <div className="mt-1" hidden={!showOutdated}>
            {outdatedComments.map((comment) => (
              <InlineComment
                key={comment.id}
                comment={comment}
                onDelete={onDeleteComment}
                onRequestAgent={undefined}
                agentEvents={agentEvents?.get(comment.id)}
                agentRunning={agentRunning?.has(comment.id)}
                outdated
              />
            ))}
          </div>
        </div>
      )}
      {currentComments.map((comment) => (
        <InlineComment
          key={comment.id}
          comment={comment}
          onDelete={onDeleteComment}
          onRequestAgent={onRequestAgent}
          agentEvents={agentEvents?.get(comment.id)}
          agentRunning={agentRunning?.has(comment.id)}
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
        </div>
      )}
    </div>
  );
}
