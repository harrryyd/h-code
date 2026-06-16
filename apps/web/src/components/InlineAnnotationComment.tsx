import type { DiffLineAnnotation } from "@pierre/diffs/types";
import type { ReviewComment } from "@t3tools/contracts";
import { Loader2Icon, CheckIcon, XIcon, BotIcon, ReplyIcon, Trash2Icon } from "lucide-react";
import { cn } from "~/lib/utils";
import { formatShortTimestamp } from "../timestampFormat";
import type { BackgroundAgentEvent } from "../hooks/useReviewComments";

const annotationMetadataStyle =
  "--gt-annotation-border: var(--t3-border); --gt-annotation-bg: var(--t3-bg-secondary)";

export interface InlineAnnotationCommentProps {
  annotation: DiffLineAnnotation<{
    commentId: string;
    body: string;
    author: string;
    agentStatus?: string;
    createdAt: string;
  }>;
  onReply?: ((body: string) => void) | undefined;
  onDelete?: ((commentId: string) => void) | undefined;
  onRequestAgent?: ((commentId: string) => void) | undefined;
  agentRunning?: boolean | undefined;
}

/**
 * Compact inline comment rendered at the annotation position in a diff view.
 * Uses minimal styling to not disrupt the diff line spacing.
 */
export function InlineAnnotationComment({
  annotation,
  onReply,
  onDelete,
  onRequestAgent,
  agentRunning,
}: InlineAnnotationCommentProps) {
  const m = annotation.metadata;
  if (!m) return null;
  const isLocal = m.author === "local" || m.author === "local-published";
  const isGitHub = !isLocal && m.author !== "local-published";
  const agentIdle = !m.agentStatus || m.agentStatus === "idle";

  return (
    <div
      className={cn(
        "ml-2 mr-1 mb-px rounded-sm border px-1.5 py-px text-[10px] leading-snug",
        isGitHub ? "border-amber-500/20 bg-amber-500/5" : "border-primary/15 bg-primary/5",
      )}
    >
      <div className="flex items-center gap-1 text-muted-foreground/60">
        <span className="font-medium">{m.author}</span>
        {isGitHub && (
          <span className="rounded-full border border-amber-500/30 px-1 text-[7px] text-amber-400/60">
            GitHub
          </span>
        )}
        <span className="text-[8px]">{formatShortTimestamp(m.createdAt, "24-hour")}</span>
        {m.agentStatus === "completed" && <CheckIcon className="size-2.5 text-green-400/70" />}
        {m.agentStatus === "failed" && <XIcon className="size-2.5 text-red-400/70" />}
        {agentRunning && <Loader2Icon className="size-2.5 animate-spin text-blue-400" />}
      </div>
      <p className="mt-0.5 whitespace-pre-wrap text-foreground/80">{m.body}</p>
      <div className="mt-0.5 flex items-center gap-1">
        {onReply && (
          <button
            type="button"
            className="inline-flex size-3.5 items-center justify-center rounded-sm text-muted-foreground/30 hover:text-foreground/50"
            onClick={() => onReply(m.body)}
            title="Reply"
          >
            <ReplyIcon className="size-2.5" />
          </button>
        )}
        {onRequestAgent && agentIdle && (
          <button
            type="button"
            className="inline-flex h-3.5 items-center gap-0.5 rounded-sm px-1 text-[7px] text-blue-400/50 hover:text-blue-400/70"
            onClick={() => onRequestAgent(m.commentId)}
            title="Request AI"
          >
            <BotIcon className="size-2" />
            AI
          </button>
        )}
        {onDelete && isLocal && (
          <button
            type="button"
            className="inline-flex size-3.5 items-center justify-center rounded-sm text-muted-foreground/30 hover:text-red-400/50"
            onClick={() => onDelete(m.commentId)}
            title="Delete"
          >
            <Trash2Icon className="size-2.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Given a set of comments with line numbers for a specific file, derive
 * the `DiffLineAnnotation` props needed by FileDiff's `lineAnnotations`.
 */
export function deriveLineAnnotations(comments: readonly ReviewComment[]): DiffLineAnnotation<{
  commentId: string;
  body: string;
  author: string;
  agentStatus?: string;
  createdAt: string;
}>[] {
  return comments
    .filter((c) => typeof c.line === "number")
    .map(
      (c) =>
        ({
          side: "additions" as const,
          lineNumber: c.line!,
          metadata: {
            commentId: c.id,
            body: c.body,
            author: c.author.login,
            agentStatus: c.agentStatus,
            createdAt: c.createdAt,
          },
        }) as DiffLineAnnotation<{
          commentId: string;
          body: string;
          author: string;
          agentStatus?: string;
          createdAt: string;
        }>,
    );
}
