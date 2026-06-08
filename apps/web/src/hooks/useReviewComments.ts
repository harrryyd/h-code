import type { ReviewComment, ReviewDraft } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";
import { readEnvironmentApi } from "../environmentApi";
import type { EnvironmentId } from "@t3tools/contracts";

export interface EditingCommentState {
  filePath: string;
  lineNumber: number | null;
  prefillBody: string;
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
    refreshDraft,
  };
}
