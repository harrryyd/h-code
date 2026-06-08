import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import type * as DateTime from "effect/DateTime";

import {
  TrimmedNonEmptyString,
  type ChangeRequestLabel,
  type SourceControlRepositoryVisibility,
  type VcsError,
} from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubPullRequests from "./gitHubPullRequests.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export class GitHubCliError extends Schema.TaggedErrorClass<GitHubCliError>()("GitHubCliError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `GitHub CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly updatedAt?: Option.Option<DateTime.Utc>;
  readonly labels?: ReadonlyArray<ChangeRequestLabel>;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GitHubPullRequestReviewComment {
  readonly id: string;
  readonly path: string;
  readonly line?: number;
  readonly commitSHA: string;
  readonly body: string;
  readonly author: { readonly login: string };
  readonly createdAt: string;
  readonly replies?: ReadonlyArray<GitHubPullRequestReviewComment>;
}

export interface GitHubPullRequestReview {
  readonly comments: ReadonlyArray<GitHubPullRequestReviewComment>;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export interface GitHubCliShape {
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<VcsProcess.VcsProcessOutput, GitHubCliError>;

  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  readonly createRepository: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly visibility: SourceControlRepositoryVisibility;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly getPullRequestReviews: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestReview, GitHubCliError>;

  readonly createPullRequestReview: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHubCliError>;
}

export class GitHubCli extends Context.Service<GitHubCli, GitHubCliShape>()(
  "t3/sourceControl/GitHubCli",
) {}

function gitHubPullRequestJsonFields(input: {
  readonly includeUpdatedAt?: boolean;
  readonly includeLabels: boolean;
}): string {
  return [
    "number",
    "title",
    "url",
    "baseRefName",
    "headRefName",
    "state",
    "mergedAt",
    ...(input.includeUpdatedAt ? ["updatedAt"] : []),
    "isCrossRepository",
    "headRepository",
    "headRepositoryOwner",
    ...(input.includeLabels ? ["labels"] : []),
  ].join(",");
}

function isUnsupportedLabelsJsonFieldError(error: GitHubCliError): boolean {
  const lower = error.detail.toLowerCase();
  return (
    lower.includes("labels") &&
    (lower.includes("unknown field") ||
      lower.includes("unknown json field") ||
      lower.includes("invalid field"))
  );
}

function toSummaryWithOptionalUpdatedAt(
  record: GitHubPullRequestSummary & {
    readonly updatedAt: Option.Option<DateTime.Utc>;
  },
): GitHubPullRequestSummary {
  const { updatedAt, ...summary } = record;
  return Option.isSome(updatedAt) ? { ...summary, updatedAt } : summary;
}

export function executeGitHubPullRequestJsonCommand(input: {
  readonly execute: GitHubCliShape["execute"];
  readonly cwd: string;
  readonly argsPrefix: ReadonlyArray<string>;
  readonly includeUpdatedAt?: boolean;
  readonly timeoutMs?: number;
}): Effect.Effect<VcsProcess.VcsProcessOutput, GitHubCliError> {
  const run = (includeLabels: boolean) =>
    input.execute({
      cwd: input.cwd,
      args: [
        ...input.argsPrefix,
        "--json",
        gitHubPullRequestJsonFields({
          includeLabels,
          ...(input.includeUpdatedAt !== undefined
            ? { includeUpdatedAt: input.includeUpdatedAt }
            : {}),
        }),
      ],
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });

  return run(true).pipe(
    Effect.catch((error) =>
      isUnsupportedLabelsJsonFieldError(error) ? run(false) : Effect.fail(error),
    ),
  );
}

function errorText(error: VcsError | unknown): string {
  if (typeof error === "object" && error !== null) {
    const tag = "_tag" in error && typeof error._tag === "string" ? error._tag : "";
    const detail = "detail" in error && typeof error.detail === "string" ? error.detail : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return [tag, detail, message].filter(Boolean).join("\n");
  }

  return String(error);
}

function normalizeGitHubCliError(
  operation: "execute" | "stdout",
  error: VcsError | unknown,
): GitHubCliError {
  const text = errorText(error);
  const lower = text.toLowerCase();

  if (lower.includes("command not found: gh") || lower.includes("enoent")) {
    return new GitHubCliError({
      operation,
      detail: "GitHub CLI (`gh`) is required but not available on PATH.",
      cause: error,
    });
  }

  if (
    lower.includes("authentication failed") ||
    lower.includes("not logged in") ||
    lower.includes("gh auth login") ||
    lower.includes("no oauth token")
  ) {
    return new GitHubCliError({
      operation,
      detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
      cause: error,
    });
  }

  if (
    lower.includes("could not resolve to a pullrequest") ||
    lower.includes("repository.pullrequest") ||
    lower.includes("no pull requests found for branch") ||
    lower.includes("pull request not found")
  ) {
    return new GitHubCliError({
      operation,
      detail: "Pull request not found. Check the PR number or URL and try again.",
      cause: error,
    });
  }

  return new GitHubCliError({
    operation,
    detail: text,
    cause: error,
  });
}

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

/**
 * `gh repo create` prints the canonical URL of the new repository on stdout
 * (e.g. `https://github.com/owner/repo`). Reading it back here avoids a
 * follow-up `gh repo view`, which can race GitHub's GraphQL eventual
 * consistency window and falsely report the just-created repo as missing.
 */
function deriveRepositoryCloneUrlsFromCreateOutput(
  stdout: string,
  repository: string,
): GitHubRepositoryCloneUrls {
  const fallbackHost = "github.com";
  const match = stdout.match(/https?:\/\/[^\s]+/);
  if (match) {
    const cleaned = match[0].replace(/\.git$/, "");
    try {
      const parsed = new URL(cleaned);
      const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "");
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length === 2) {
        const nameWithOwner = `${segments[0]}/${segments[1]}`;
        return {
          nameWithOwner,
          url: `${parsed.origin}/${nameWithOwner}`,
          sshUrl: `git@${parsed.host}:${nameWithOwner}.git`,
        };
      }
    } catch {
      // Fall through to the input-derived defaults below.
    }
  }
  return {
    nameWithOwner: repository,
    url: `https://${fallbackHost}/${repository}`,
    sshUrl: `git@${fallbackHost}:${repository}.git`,
  };
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation: "listOpenPullRequests" | "getPullRequest" | "getRepositoryCloneUrls",
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: `${invalidDetail}: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
          cause: error,
        }),
    ),
  );
}

export const make = Effect.fn("makeGitHubCli")(function* () {
  const process = yield* VcsProcess.VcsProcess;

  const execute: GitHubCliShape["execute"] = (input) =>
    process
      .run({
        operation: "GitHubCli.execute",
        command: "gh",
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })
      .pipe(Effect.mapError((error) => normalizeGitHubCliError("execute", error)));

  return GitHubCli.of({
    execute,
    listOpenPullRequests: (input) =>
      executeGitHubPullRequestJsonCommand({
        execute,
        cwd: input.cwd,
        argsPrefix: [
          "pr",
          "list",
          "--head",
          input.headSelector,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubCliError({
                        operation: "listOpenPullRequests",
                        detail: `GitHub CLI returned invalid PR list JSON: ${GitHubPullRequests.formatGitHubJsonDecodeError(decoded.failure)}`,
                        cause: decoded.failure,
                      }),
                    );
                  }

                  return Effect.succeed(decoded.success.map(toSummaryWithOptionalUpdatedAt));
                }),
              ),
        ),
      ),
    getPullRequest: (input) =>
      executeGitHubPullRequestJsonCommand({
        execute,
        cwd: input.cwd,
        argsPrefix: ["pr", "view", input.reference],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubCliError({
                    operation: "getPullRequest",
                    detail: `GitHub CLI returned invalid pull request JSON: ${GitHubPullRequests.formatGitHubJsonDecodeError(decoded.failure)}`,
                    cause: decoded.failure,
                  }),
                );
              }

              return Effect.succeed(
                (({ updatedAt: _updatedAt, ...summary }) => summary)(decoded.success),
              );
            }),
          ),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createRepository: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "create", input.repository, `--${input.visibility}`],
      }).pipe(
        Effect.map((result) =>
          deriveRepositoryCloneUrlsFromCreateOutput(result.stdout, input.repository),
        ),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
    getPullRequestReviews: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "view", input.reference, "--json", "reviews"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => {
            const parsed = JSON.parse(raw);
            const reviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];
            const comments: Array<GitHubPullRequestReviewComment> = [];
            for (const review of reviews) {
              if (review.comments && Array.isArray(review.comments)) {
                for (const comment of review.comments) {
                  comments.push({
                    id: String(comment.id ?? ""),
                    path: comment.path ?? "",
                    line: typeof comment.line === "number" ? comment.line : undefined,
                    commitSHA: comment.commit?.oid ?? "",
                    body: comment.body ?? "",
                    author: { login: comment.author?.login ?? "" },
                    createdAt: comment.createdAt ?? "",
                    replies:
                      comment.replies?.nodes?.map(
                        (reply: Record<string, unknown>) => ({
                          id: String(reply.id ?? ""),
                          path: reply.path ?? "",
                          line:
                            typeof reply.line === "number" ? reply.line : undefined,
                          commitSHA: reply.commit?.oid ?? "",
                          body: reply.body ?? "",
                          author: { login: reply.author?.login ?? "" },
                          createdAt: reply.createdAt ?? "",
                        }),
                      ) ?? undefined,
                  });
                }
              }
            }
            return { comments };
          }),
        ),
      ),
    createPullRequestReview: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "review", input.reference, "--comment", "--body-file", input.bodyFile],
      }).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(GitHubCli, make());
