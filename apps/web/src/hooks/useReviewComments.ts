import type { ReviewComment, ReviewDraft } from "@t3tools/contracts";
import { useCallback, useEffect, useState, useRef } from "react";
import { readEnvironmentApi } from "../environmentApi";
import type { EnvironmentId } from "@t3tools/contracts";

export interface EditingCommentState {
  filePath: string;
  lineNumber: number | null;
  prefillBody: string;
}

export interface BackgroundAgentEvent {
  type: "text" | "detail" | "status" | "done" | "error";
  commentId: string;
  content?: string;
  agentStatus?: string;
  title?: string;
  message?: string;
}

export interface UseReviewCommentsOptions {
  environmentId: EnvironmentId | null;
  threadId: string | null;
  prNumber: number | null;
  prHeadSHA: string | null;
}

export interface UseReviewCommentsResult {
  reviewDraft: ReviewDraft | null;
  comments: readonly ReviewComment[];
  draftPending: boolean;
  draftError: string | null;
  editingComment: EditingCommentState | null;
  savePending: boolean;
  saveError: string | null;
  submitting: boolean;
  submitError: string | null;
  startEditing: (filePath: string, lineNumber: number | null, prefillBody?: string) => void;
  cancelEditing: () => void;
  saveComment: (body: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  refreshDraft: () => void;
  submitReview: () => Promise<ReviewDraft | null>;
  submitReviewWithBatchAgents: () => void;
  runBackgroundAgent: (commentId: string) => void;
  agentEvents: Map<string, BackgroundAgentEvent[]>;
  agentRunning: Set<string>;
}

export function useReviewComments(
  options: UseReviewCommentsOptions,
): UseReviewCommentsResult {
  const { environmentId, threadId, prNumber, prHeadSHA } = options;
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null);
  const [draftPending, setDraftPending] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<EditingCommentState | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [agentEvents, setAgentEvents] = useState<Map<string, BackgroundAgentEvent[]>>(new Map());
  const [agentRunning, setAgentRunning] = useState<Set<string>>(new Set());
  const agentUnsubRef = useRef<Map<string, () => void>>(new Map());

  const refreshDraft = useCallback(() => {
    if (!environmentId || !threadId || !prNumber) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;
    setDraftPending(true);
    setDraftError(null);
    api.changeRequest
      .getReviewDraft({ threadId, prNumber })
      .then(
        (draft) => {
          setReviewDraft(draft);
          setDraftPending(false);
        },
        (error) => {
          setDraftError(error instanceof Error ? error.message : "Failed to load review draft");
          setDraftPending(false);
        },
      );
  }, [environmentId, threadId, prNumber]);

  useEffect(() => {
    if (environmentId && threadId && typeof prNumber === "number") {
      refreshDraft();
    }
  }, [environmentId, threadId, prNumber, refreshDraft]);

  const startEditing = useCallback(
    (filePath: string, lineNumber: number | null, prefillBody = "") => {
      setEditingComment({ filePath, lineNumber, prefillBody });
    },
    [],
  );

  const cancelEditing = useCallback(() => {
    setEditingComment(null);
    setSaveError(null);
  }, []);

  const saveComment = useCallback(
    async (body: string) => {
      if (!environmentId || !threadId || !prNumber || !prHeadSHA || !editingComment) return;
      const api = readEnvironmentApi(environmentId);
      if (!api) return;
      setSavePending(true);
      setSaveError(null);
      const id = crypto.randomUUID();
      const comment: ReviewComment = {
        id,
        file: editingComment.filePath,
        line: editingComment.lineNumber ?? undefined,
        commitSHA: prHeadSHA,
        body,
        author: { login: "local" },
        createdAt: new Date().toISOString(),
      };
      try {
        const updatedDraft = await api.changeRequest.upsertReviewComment({
          threadId,
          prNumber,
          prHeadSHA,
          comment,
        });
        setReviewDraft(updatedDraft);
        setEditingComment(null);
        setSavePending(false);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Failed to save comment");
        setSavePending(false);
      }
    },
    [environmentId, threadId, prNumber, prHeadSHA, editingComment],
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!environmentId || !threadId || !prNumber) return;
      const api = readEnvironmentApi(environmentId);
      if (!api) return;
      try {
        const updatedDraft = await api.changeRequest.deleteReviewComment({
          threadId,
          prNumber,
          commentId,
        });
        setReviewDraft(updatedDraft);
      } catch (error) {
        setDraftError(error instanceof Error ? error.message : "Failed to delete comment");
      }
    },
    [environmentId, threadId, prNumber],
  );

  const submitReview = useCallback(
    async (): Promise<ReviewDraft | null> => {
      if (!environmentId || !threadId || !prNumber) return null;
      const api = readEnvironmentApi(environmentId);
      if (!api) return null;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const updatedDraft = await api.changeRequest.submitReview({
          threadId,
          prNumber,
        });
        setReviewDraft(updatedDraft);
        setSubmitting(false);
        return updatedDraft;
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "Failed to submit review");
        setSubmitting(false);
        return null;
      }
    },
    [environmentId, threadId, prNumber],
  );

  const submitReviewWithBatchAgents = useCallback(() => {
    if (!environmentId || !threadId || !prNumber) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;
    setSubmitting(true);
    setSubmitError(null);
    api.changeRequest
      .submitReview({ threadId, prNumber, runBatchAgents: true })
      .then((updatedDraft) => {
        setReviewDraft(updatedDraft);
        setSubmitting(false);

        if (updatedDraft) {
          const commentIds = updatedDraft.comments.map((c) => c.id);

          if (commentIds.length > 0) {
            const unsub = api.changeRequest.runBatchAgents(
              { threadId, prNumber, commentIds },
              (event) => {
                setAgentEvents((prev) => {
                  const next = new Map(prev);
                  const events = [...(next.get(event.commentId) ?? []), event];
                  next.set(event.commentId, events);
                  return next;
                });

                if (event.type === "status" && event.agentStatus) {
                  setReviewDraft((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      comments: prev.comments.map((c) =>
                        c.id === event.commentId
                          ? { ...c, agentStatus: event.agentStatus as ReviewComment["agentStatus"] }
                          : c,
                      ),
                    };
                  });

                  if (event.agentStatus === "running") {
                    setAgentRunning((prev) => new Set(prev).add(event.commentId));
                  } else if (event.agentStatus === "completed" || event.agentStatus === "failed") {
                    setAgentRunning((prev) => {
                      const next = new Set(prev);
                      next.delete(event.commentId);
                      return next;
                    });
                  }
                }

                if (event.type === "done" || event.type === "error") {
                  setAgentRunning((prev) => {
                    const next = new Set(prev);
                    next.delete(event.commentId);
                    return next;
                  });
                }
              },
              {
                onResubscribe: () => {},
              },
            );

            agentUnsubRef.current.set("__batch__", unsub);
          }
        }
      })
      .catch((error) => {
        setSubmitError(error instanceof Error ? error.message : "Failed to submit review");
        setSubmitting(false);
      });
  }, [environmentId, threadId, prNumber]);

  const runBackgroundAgent = useCallback(
    (commentId: string) => {
      if (!environmentId || !threadId || !prNumber) return;
      const api = readEnvironmentApi(environmentId);
      if (!api) return;

      // Clean up any existing subscription for this comment
      const existingUnsub = agentUnsubRef.current.get(commentId);
      if (existingUnsub) {
        existingUnsub();
      }

      // Clear previous events for this comment
      setAgentEvents((prev) => {
        const next = new Map(prev);
        next.set(commentId, []);
        return next;
      });

      // Mark as running
      setAgentRunning((prev) => new Set(prev).add(commentId));

      const unsub = api.changeRequest.runBackgroundAgent(
        { threadId, prNumber, commentId },
        (event) => {
          setAgentEvents((prev) => {
            const next = new Map(prev);
            const events = [...(next.get(commentId) ?? []), event];
            next.set(commentId, events);
            return next;
          });

          if (event.type === "status" && event.agentStatus) {
            // Update comment agentStatus in the local draft
            setReviewDraft((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                comments: prev.comments.map((c) =>
                  c.id === commentId ? { ...c, agentStatus: event.agentStatus as ReviewComment["agentStatus"] } : c,
                ),
              };
            });
          }

          if (event.type === "done" || event.type === "error") {
            setAgentRunning((prev) => {
              const next = new Set(prev);
              next.delete(commentId);
              return next;
            });
            agentUnsubRef.current.delete(commentId);
          }
        },
        {
          onResubscribe: () => {
            setAgentRunning((prev) => new Set(prev).add(commentId));
          },
        },
      );

      agentUnsubRef.current.set(commentId, unsub);
    },
    [environmentId, threadId, prNumber],
  );

  return {
    reviewDraft,
    comments: reviewDraft?.comments ?? [],
    draftPending,
    draftError,
    editingComment,
    savePending,
    saveError,
    submitting,
    submitError,
    startEditing,
    cancelEditing,
    saveComment,
    deleteComment,
    submitReview,
    submitReviewWithBatchAgents,
    runBackgroundAgent,
    agentEvents,
    agentRunning,
    refreshDraft,
  };
}
