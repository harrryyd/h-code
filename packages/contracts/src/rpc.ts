import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { ThreadId, TrimmedNonEmptyString, PositiveInt } from "./baseSchemas.ts";
import { ExternalLauncherError, LaunchEditorInput } from "./editor.ts";
import {
  AuthAccessStreamError,
  AuthAccessStreamEvent,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import {
  GitActionProgressEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitCommandError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  VcsPullInput,
  GitPullRequestRefInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  VcsStatusInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "./git.ts";
import {
  ReviewDiffPreviewError,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
} from "./review.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  RelayClientInstallFailedError,
  RelayClientInstallProgressEventSchema,
  RelayClientStatusSchema,
} from "./relayClient.ts";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import {
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerLifecycleStreamEvent,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerProviderUpdatedPayload,
  ServerTraceDiagnosticsResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
  ReviewComment,
  ReviewCommentAgentStatus,
  ReviewDraft,
} from "./sourceControl.ts";
import { TodoCategory, TodoItem, TodoItemPriority } from "./todos.ts";
import { VcsError } from "./vcs.ts";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",

  // MCP methods
  mcpListServers: "mcp.listServers",
  mcpToggleServer: "mcp.toggleServer",

  // VCS methods
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  // Git workflow methods
  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Review methods
  reviewGetDiffPreview: "review.getDiffPreview",

  // Change request review methods
  changeRequestGetReviewDraft: "changeRequest.getReviewDraft",
  changeRequestUpsertReviewComment: "changeRequest.upsertReviewComment",
  changeRequestDeleteReviewComment: "changeRequest.deleteReviewComment",
  changeRequestGetPrDiff: "changeRequest.getPrDiff",
  changeRequestSubmitReview: "changeRequest.submitReview",
  changeRequestRunBackgroundAgent: "changeRequest.runBackgroundAgent",
  changeRequestRunBatchAgents: "changeRequest.runBatchAgents",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalAttach: "terminal.attach",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverSignalProcess: "server.signalProcess",

  // Cloud environment methods
  cloudGetRelayClientStatus: "cloud.getRelayClientStatus",
  cloudInstallRelayClient: "cloud.installRelayClient",

  // Source control methods
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",

  // Todo methods
  todosLoad: "todo.load",
  todosMutate: "todo.mutate",

  // Streaming subscriptions
  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeTerminalMetadata: "subscribeTerminalMetadata",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
} as const;

export const McpServerSnapshotSchema = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["connected", "failed", "needs-auth", "pending", "disabled"]),
});
export type McpServerSnapshot = typeof McpServerSnapshotSchema.Type;

export const WsMcpListServersInput = Schema.Struct({
  threadId: ThreadId,
});
export type WsMcpListServersInput = typeof WsMcpListServersInput.Type;

export const WsMcpListServersResult = Schema.Struct({
  servers: Schema.Array(McpServerSnapshotSchema),
});
export type WsMcpListServersResult = typeof WsMcpListServersResult.Type;

export const WsMcpToggleServerInput = Schema.Struct({
  threadId: ThreadId,
  mcpServerName: Schema.String,
  enabled: Schema.Boolean,
});
export type WsMcpToggleServerInput = typeof WsMcpToggleServerInput.Type;

export const WsMcpToggleServerResult = Schema.Struct({});
export type WsMcpToggleServerResult = typeof WsMcpToggleServerResult.Type;

export class McpToggleError extends Schema.TaggedErrorClass<McpToggleError>()("McpToggleError", {
  kind: Schema.Literals(["provider-not-claude", "session-not-found", "sdk-failure"]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `MCP toggle error (${this.kind}): ${this.detail}`;
  }
}

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

export const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    /**
     * When supplied, only refresh this specific provider instance. When
     * omitted, refresh all configured instances — the legacy `refresh()`
     * behaviour retained for transports that still dispatch untargeted
     * refreshes.
     */
    instanceId: Schema.optional(ProviderInstanceId),
  }),
  success: ServerProviderUpdatedPayload,
  error: EnvironmentAuthorizationError,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([ServerProviderUpdateError, EnvironmentAuthorizationError]),
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetProcessResourceHistoryRpc = Rpc.make(
  WS_METHODS.serverGetProcessResourceHistory,
  {
    payload: ServerProcessResourceHistoryInput,
    success: ServerProcessResourceHistoryResult,
    error: EnvironmentAuthorizationError,
  },
);

export const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
  error: EnvironmentAuthorizationError,
});

export const WsCloudGetRelayClientStatusRpc = Rpc.make(WS_METHODS.cloudGetRelayClientStatus, {
  payload: Schema.Struct({}),
  success: RelayClientStatusSchema,
  error: EnvironmentAuthorizationError,
});

export const WsCloudInstallRelayClientRpc = Rpc.make(WS_METHODS.cloudInstallRelayClient, {
  payload: Schema.Struct({}),
  success: RelayClientInstallProgressEventSchema,
  error: Schema.Union([RelayClientInstallFailedError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsSourceControlLookupRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlLookupRepository,
  {
    payload: SourceControlRepositoryLookupInput,
    success: SourceControlRepositoryInfo,
    error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
  },
);

export const WsSourceControlCloneRepositoryRpc = Rpc.make(WS_METHODS.sourceControlCloneRepository, {
  payload: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

export const WsSourceControlPublishRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlPublishRepository,
  {
    payload: SourceControlPublishRepositoryInput,
    success: SourceControlPublishRepositoryResult,
    error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
  },
);

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: Schema.Union([ProjectSearchEntriesError, EnvironmentAuthorizationError]),
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: Schema.Union([ProjectWriteFileError, EnvironmentAuthorizationError]),
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: Schema.Union([ExternalLauncherError, EnvironmentAuthorizationError]),
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: Schema.Union([FilesystemBrowseError, EnvironmentAuthorizationError]),
});

export const WsMcpListServersRpc = Rpc.make(WS_METHODS.mcpListServers, {
  payload: WsMcpListServersInput,
  success: WsMcpListServersResult,
  error: Schema.Union([McpToggleError, EnvironmentAuthorizationError]),
});

export const WsMcpToggleServerRpc = Rpc.make(WS_METHODS.mcpToggleServer, {
  payload: WsMcpToggleServerInput,
  success: WsMcpToggleServerResult,
  error: Schema.Union([McpToggleError, EnvironmentAuthorizationError]),
});

export const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusInput,
  success: VcsStatusStreamEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: VcsStatusInput,
  success: VcsStatusResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

export const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  payload: VcsCreateWorktreeInput,
  success: VcsCreateWorktreeResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsRemoveWorktreeRpc = Rpc.make(WS_METHODS.vcsRemoveWorktree, {
  payload: VcsRemoveWorktreeInput,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: Schema.Union([VcsError, EnvironmentAuthorizationError]),
});

/**
 * Ephemeral live diff preview for compact/mobile surfaces.
 * Not the persisted T3 Review model. Future review sessions should use
 * review.open* + review.getSnapshot.
 */
export const WsReviewGetDiffPreviewRpc = Rpc.make(WS_METHODS.reviewGetDiffPreview, {
  payload: ReviewDiffPreviewInput,
  success: ReviewDiffPreviewResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

export const WsChangeRequestGetReviewDraftInput = Schema.Struct({
  threadId: ThreadId,
  prNumber: PositiveInt,
});
export type WsChangeRequestGetReviewDraftInput = typeof WsChangeRequestGetReviewDraftInput.Type;

export const WsChangeRequestGetReviewDraftRpc = Rpc.make(
  WS_METHODS.changeRequestGetReviewDraft,
  {
    payload: WsChangeRequestGetReviewDraftInput,
    success: Schema.NullOr(ReviewDraft),
    error: EnvironmentAuthorizationError,
  },
);

export const WsChangeRequestUpsertReviewCommentInput = Schema.Struct({
  threadId: ThreadId,
  prNumber: PositiveInt,
  prHeadSHA: TrimmedNonEmptyString,
  comment: ReviewComment,
});
export type WsChangeRequestUpsertReviewCommentInput =
  typeof WsChangeRequestUpsertReviewCommentInput.Type;

export const WsChangeRequestUpsertReviewCommentRpc = Rpc.make(
  WS_METHODS.changeRequestUpsertReviewComment,
  {
    payload: WsChangeRequestUpsertReviewCommentInput,
    success: ReviewDraft,
    error: EnvironmentAuthorizationError,
  },
);

export const WsChangeRequestDeleteReviewCommentInput = Schema.Struct({
  threadId: ThreadId,
  prNumber: PositiveInt,
  commentId: TrimmedNonEmptyString,
});
export type WsChangeRequestDeleteReviewCommentInput =
  typeof WsChangeRequestDeleteReviewCommentInput.Type;

export const WsChangeRequestDeleteReviewCommentRpc = Rpc.make(
  WS_METHODS.changeRequestDeleteReviewComment,
  {
    payload: WsChangeRequestDeleteReviewCommentInput,
    success: Schema.NullOr(ReviewDraft),
    error: EnvironmentAuthorizationError,
  },
);
export class ChangeRequestGetPrDiffError extends Schema.TaggedErrorClass<ChangeRequestGetPrDiffError>()(
  "ChangeRequestGetPrDiffError",
  {
    kind: Schema.Literals(["diff-failed", "not-a-repo", "pr-not-found"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `PR diff error (${this.kind}): ${this.detail}`;
  }
}

export const ChangeRequestGetPrDiffInput = Schema.Struct({
  threadId: ThreadId,
  prNumber: PositiveInt,
});
export type ChangeRequestGetPrDiffInput = typeof ChangeRequestGetPrDiffInput.Type;

export const ChangeRequestGetPrDiffResult = Schema.Struct({
  diff: Schema.String,
  prHeadSHA: TrimmedNonEmptyString,
});
export type ChangeRequestGetPrDiffResult = typeof ChangeRequestGetPrDiffResult.Type;

export const WsChangeRequestGetPrDiffRpc = Rpc.make(WS_METHODS.changeRequestGetPrDiff, {
  payload: ChangeRequestGetPrDiffInput,
  success: ChangeRequestGetPrDiffResult,
  error: Schema.Union([ChangeRequestGetPrDiffError, EnvironmentAuthorizationError]),
});

export class ChangeRequestRunBackgroundAgentError extends Schema.TaggedErrorClass<ChangeRequestRunBackgroundAgentError>()(
  "ChangeRequestRunBackgroundAgentError",
  {
    kind: Schema.Literals(["thread-not-found", "no-worktree", "agent-failed"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Background agent error (${this.kind}): ${this.detail}`;
  }
}

export const ChangeRequestRunBackgroundAgentInput = Schema.Struct({
  threadId: ThreadId,
  prNumber: PositiveInt,
  commentId: TrimmedNonEmptyString,
});
export type ChangeRequestRunBackgroundAgentInput = typeof ChangeRequestRunBackgroundAgentInput.Type;

export const BackgroundAgentResponseEvent = Schema.Struct({
  type: Schema.Literals(["text", "detail", "status", "done", "error"]),
  commentId: TrimmedNonEmptyString,
  content: Schema.optional(Schema.String),
  agentStatus: Schema.optional(ReviewCommentAgentStatus),
  title: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});
export type BackgroundAgentResponseEvent = typeof BackgroundAgentResponseEvent.Type;

export const WsChangeRequestRunBackgroundAgentRpc = Rpc.make(
  WS_METHODS.changeRequestRunBackgroundAgent,
  {
    payload: ChangeRequestRunBackgroundAgentInput,
    success: BackgroundAgentResponseEvent,
    error: Schema.Union([ChangeRequestRunBackgroundAgentError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsChangeRequestRunBatchAgentsInput = Schema.Struct({
  threadId: ThreadId,
  prNumber: PositiveInt,
  commentIds: Schema.Array(TrimmedNonEmptyString),
});
export type WsChangeRequestRunBatchAgentsInput = typeof WsChangeRequestRunBatchAgentsInput.Type;

export const WsChangeRequestRunBatchAgentsRpc = Rpc.make(
  WS_METHODS.changeRequestRunBatchAgents,
  {
    payload: WsChangeRequestRunBatchAgentsInput,
    success: BackgroundAgentResponseEvent,
    error: Schema.Union([ChangeRequestRunBackgroundAgentError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export class ChangeRequestSubmitReviewError extends Schema.TaggedErrorClass<ChangeRequestSubmitReviewError>()(
  "ChangeRequestSubmitReviewError",
  {
    kind: Schema.Literals(["no-draft", "review-failed", "not-a-repo"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Submit review error (${this.kind}): ${this.detail}`;
  }
}

export const WsChangeRequestSubmitReviewInput = Schema.Struct({
  threadId: ThreadId,
  prNumber: PositiveInt,
  runBatchAgents: Schema.optional(Schema.Boolean),
});
export type WsChangeRequestSubmitReviewInput = typeof WsChangeRequestSubmitReviewInput.Type;

export const WsChangeRequestSubmitReviewRpc = Rpc.make(
  WS_METHODS.changeRequestSubmitReview,
  {
    payload: WsChangeRequestSubmitReviewInput,
    success: ReviewDraft,
    error: Schema.Union([ChangeRequestSubmitReviewError, EnvironmentAuthorizationError]),
  },
);

export const TodosLoadResult = Schema.Struct({
  categories: Schema.Array(TodoCategory),
  items: Schema.Array(TodoItem),
  jiraBaseUrl: Schema.optional(Schema.String),
});
export type TodosLoadResult = typeof TodosLoadResult.Type;

export class TodosLoadError extends Schema.TaggedErrorClass<TodosLoadError>()("TodosLoadError", {
  kind: Schema.Literals(["io-failure", "parse-failure"]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Todo load error (${this.kind}): ${this.detail}`;
  }
}

export const WsTodosLoadRpc = Rpc.make(WS_METHODS.todosLoad, {
  payload: Schema.Struct({}),
  success: TodosLoadResult,
  error: Schema.Union([TodosLoadError, EnvironmentAuthorizationError]),
});

export const TodoMutationType = Schema.Literals([
  "createCategory",
  "renameCategory",
  "setCategoryColor",
  "setCategoryJiraLink",
  "deleteCategory",
  "toggleCategory",
  "createItem",
  "cycleItemStatus",
  "reorderItems",
  "reorderCategories",
  "updateItemDescription",
  "setItemJiraLink",
  "renameItem",
  "setItemPriority",
  "setJiraBaseUrl",
  "deleteItem",
]);
export type TodoMutationType = typeof TodoMutationType.Type;

export const CreateCategoryMutation = Schema.Struct({
  type: Schema.Literal("createCategory"),
  name: Schema.String,
  color: Schema.String,
});
export const RenameCategoryMutation = Schema.Struct({
  type: Schema.Literal("renameCategory"),
  categoryId: Schema.String,
  name: Schema.String,
});
export const SetCategoryColorMutation = Schema.Struct({
  type: Schema.Literal("setCategoryColor"),
  categoryId: Schema.String,
  color: Schema.String,
});
export const SetCategoryJiraLinkMutation = Schema.Struct({
  type: Schema.Literal("setCategoryJiraLink"),
  categoryId: Schema.String,
  jiraLink: Schema.String,
});
export const DeleteCategoryMutation = Schema.Struct({
  type: Schema.Literal("deleteCategory"),
  categoryId: Schema.String,
});

export const CreateItemMutation = Schema.Struct({
  type: Schema.Literal("createItem"),
  categoryId: Schema.String,
  title: TrimmedNonEmptyString,
});

export const CycleItemStatusMutation = Schema.Struct({
  type: Schema.Literal("cycleItemStatus"),
  itemId: Schema.String,
});

export const ReorderItemsMutation = Schema.Struct({
  type: Schema.Literal("reorderItems"),
  updates: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      categoryId: Schema.String,
      sortOrder: Schema.Number,
    }),
  ),
});

export const ReorderCategoriesMutation = Schema.Struct({
  type: Schema.Literal("reorderCategories"),
  orderedIds: Schema.Array(Schema.String),
});

export const UpdateItemDescriptionMutation = Schema.Struct({
  type: Schema.Literal("updateItemDescription"),
  itemId: Schema.String,
  description: Schema.String,
});

export const SetItemJiraLinkMutation = Schema.Struct({
  type: Schema.Literal("setItemJiraLink"),
  itemId: Schema.String,
  jiraLink: Schema.String,
});

export const SetJiraBaseUrlMutation = Schema.Struct({
  type: Schema.Literal("setJiraBaseUrl"),
  jiraBaseUrl: Schema.String,
});

export const RenameItemMutation = Schema.Struct({
  type: Schema.Literal("renameItem"),
  itemId: Schema.String,
  title: TrimmedNonEmptyString,
});

export const SetItemPriorityMutation = Schema.Struct({
  type: Schema.Literal("setItemPriority"),
  itemId: Schema.String,
  priority: TodoItemPriority,
});

export const DeleteItemMutation = Schema.Struct({
  type: Schema.Literal("deleteItem"),
  itemId: Schema.String,
});

export const ToggleCategoryMutation = Schema.Struct({
  type: Schema.Literal("toggleCategory"),
  categoryId: Schema.String,
});

export const TodoMutation = Schema.Union([
  CreateCategoryMutation,
  RenameCategoryMutation,
  SetCategoryColorMutation,
  SetCategoryJiraLinkMutation,
  DeleteCategoryMutation,
  ToggleCategoryMutation,
  CreateItemMutation,
  CycleItemStatusMutation,
  ReorderItemsMutation,
  ReorderCategoriesMutation,
  UpdateItemDescriptionMutation,
  SetItemJiraLinkMutation,
  RenameItemMutation,
  SetItemPriorityMutation,
  SetJiraBaseUrlMutation,
  DeleteItemMutation,
]);
export type TodoMutation = typeof TodoMutation.Type;

export const TodosMutateInput = Schema.Struct({
  mutations: Schema.Array(TodoMutation),
});
export type TodosMutateInput = typeof TodosMutateInput.Type;

export class TodosMutateError extends Schema.TaggedErrorClass<TodosMutateError>()(
  "TodosMutateError",
  {
    kind: Schema.Literals(["io-failure", "validation-failure"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Todo mutate error (${this.kind}): ${this.detail}`;
  }
}

export const WsTodosMutateRpc = Rpc.make(WS_METHODS.todosMutate, {
  payload: TodosMutateInput,
  success: TodosLoadResult,
  error: Schema.Union([TodosMutateError, EnvironmentAuthorizationError]),
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalAttachRpc = Rpc.make(WS_METHODS.terminalAttach, {
  payload: TerminalAttachInput,
  success: TerminalAttachStreamEvent,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: Schema.Union([OrchestrationGetTurnDiffError, EnvironmentAuthorizationError]),
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: Schema.Union([OrchestrationGetFullThreadDiffError, EnvironmentAuthorizationError]),
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: Schema.Union([OrchestrationReplayEventsError, EnvironmentAuthorizationError]),
});

export const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationRpcSchemas.getArchivedShellSnapshot.output,
    error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  },
);

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationRpcSchemas.subscribeThread.output,
    error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeTerminalMetadataRpc = Rpc.make(WS_METHODS.subscribeTerminalMetadata, {
  payload: Schema.Struct({}),
  success: TerminalMetadataStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  error: Schema.Union([AuthAccessStreamError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerDiscoverSourceControlRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerSignalProcessRpc,
  WsCloudGetRelayClientStatusRpc,
  WsCloudInstallRelayClientRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsSourceControlPublishRepositoryRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsMcpListServersRpc,
  WsMcpToggleServerRpc,
  WsSubscribeVcsStatusRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsTodosLoadRpc,
  WsTodosMutateRpc,
  WsReviewGetDiffPreviewRpc,
  WsChangeRequestGetReviewDraftRpc,
  WsChangeRequestUpsertReviewCommentRpc,
  WsChangeRequestDeleteReviewCommentRpc,
  WsChangeRequestGetPrDiffRpc,
  WsChangeRequestSubmitReviewRpc,
  WsChangeRequestRunBackgroundAgentRpc,
  WsChangeRequestRunBatchAgentsRpc,
  WsTerminalOpenRpc,
  WsTerminalAttachRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeTerminalMetadataRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
);
