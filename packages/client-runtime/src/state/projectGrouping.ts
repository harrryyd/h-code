import { scopedProjectKey, scopeProjectRef } from "../environment/scoped.ts";
import type { ScopedProjectRef, SidebarProjectGroupingMode } from "@t3tools/contracts";
import type {
  ClientSettings,
  ManualSidebarGroup,
  ProjectThreadDefaultMode,
  ServerSettings,
  ThreadEnvMode,
} from "@t3tools/contracts/settings";

import type { EnvironmentProject } from "./models.ts";
import { normalizeProjectPathForComparison } from "./projects.ts";

export interface ProjectGroupingSettings {
  readonly sidebarProjectGroupingMode: SidebarProjectGroupingMode;
  readonly sidebarProjectGroupingOverrides: Record<string, SidebarProjectGroupingMode>;
}

export type ProjectGroupingMode = SidebarProjectGroupingMode;

export interface ProjectThreadDefaultsSettings {
  readonly defaultThreadEnvMode: ThreadEnvMode;
  readonly projectThreadDefaults: Record<string, ProjectThreadDefaultMode>;
}

export interface ManualSidebarGroupsSettings {
  readonly manualSidebarGroups: ReadonlyArray<ManualSidebarGroup>;
  readonly projectManualSidebarGroupAssignments: Record<string, string>;
}

export function selectProjectGroupingSettings(settings: ClientSettings): ProjectGroupingSettings {
  return {
    sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
    sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
  };
}

function uniqueNonEmptyValues(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

function deriveRepositoryRelativeProjectPath(
  project: Pick<EnvironmentProject, "workspaceRoot" | "repositoryIdentity">,
): string | null {
  const rootPath = project.repositoryIdentity?.rootPath?.trim();
  if (!rootPath) {
    return null;
  }

  const normalizedProjectPath = normalizeProjectPathForComparison(project.workspaceRoot);
  const normalizedRootPath = normalizeProjectPathForComparison(rootPath);
  if (normalizedProjectPath.length === 0 || normalizedRootPath.length === 0) {
    return null;
  }

  if (normalizedProjectPath === normalizedRootPath) {
    return "";
  }

  const separator = normalizedRootPath.includes("\\") ? "\\" : "/";
  const rootPrefix = `${normalizedRootPath}${separator}`;
  if (!normalizedProjectPath.startsWith(rootPrefix)) {
    return null;
  }

  return normalizedProjectPath.slice(rootPrefix.length).replaceAll("\\", "/");
}

export function derivePhysicalProjectKeyFromPath(environmentId: string, cwd: string): string {
  return `${environmentId}:${normalizeProjectPathForComparison(cwd)}`;
}

export function derivePhysicalProjectKey(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
): string {
  return derivePhysicalProjectKeyFromPath(project.environmentId, project.workspaceRoot);
}

export function deriveProjectGroupingOverrideKey(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
): string {
  return derivePhysicalProjectKey(project);
}

export const deriveProjectThreadDefaultOverrideKey = deriveProjectGroupingOverrideKey;
export const deriveProjectManualSidebarGroupAssignmentKey = deriveProjectGroupingOverrideKey;

export function selectProjectThreadDefaultsSettings(
  settings: ServerSettings,
): ProjectThreadDefaultsSettings {
  return {
    defaultThreadEnvMode: settings.defaultThreadEnvMode,
    projectThreadDefaults: settings.projectThreadDefaults,
  };
}

export function selectManualSidebarGroupsSettings(
  settings: ServerSettings,
): ManualSidebarGroupsSettings {
  return {
    manualSidebarGroups: settings.manualSidebarGroups,
    projectManualSidebarGroupAssignments: settings.projectManualSidebarGroupAssignments,
  };
}

export function resolveProjectThreadDefaultMode(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
  settings: ProjectThreadDefaultsSettings,
): ProjectThreadDefaultMode {
  return (
    settings.projectThreadDefaults[deriveProjectThreadDefaultOverrideKey(project)] ?? "inherit"
  );
}

export function resolveProjectThreadEnvMode(input: {
  readonly project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">;
  readonly target: ProjectThreadDefaultsSettings;
  readonly legacyPrimary?: ProjectThreadDefaultsSettings | undefined;
}): ThreadEnvMode {
  const key = deriveProjectThreadDefaultOverrideKey(input.project);
  const targetOverride = input.target.projectThreadDefaults[key];
  if (targetOverride !== undefined) {
    return targetOverride === "inherit" ? input.target.defaultThreadEnvMode : targetOverride;
  }
  const legacyOverride = input.legacyPrimary?.projectThreadDefaults[key];
  return legacyOverride === undefined || legacyOverride === "inherit"
    ? input.target.defaultThreadEnvMode
    : legacyOverride;
}

export function resolveProjectManualSidebarGroupId(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
  settings: ManualSidebarGroupsSettings,
): string | null {
  const assigned =
    settings.projectManualSidebarGroupAssignments[
      deriveProjectManualSidebarGroupAssignmentKey(project)
    ];
  return assigned && settings.manualSidebarGroups.some((group) => group.id === assigned)
    ? assigned
    : null;
}

export function getProjectOrderKey(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
): string {
  return derivePhysicalProjectKey(project);
}

export function resolveProjectGroupingMode(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
  settings: ProjectGroupingSettings,
): SidebarProjectGroupingMode {
  return (
    settings.sidebarProjectGroupingOverrides?.[deriveProjectGroupingOverrideKey(project)] ??
    settings.sidebarProjectGroupingMode
  );
}

function deriveRepositoryScopedKey(
  project: Pick<EnvironmentProject, "workspaceRoot" | "repositoryIdentity">,
  groupingMode: SidebarProjectGroupingMode,
): string | null {
  const canonicalKey = project.repositoryIdentity?.canonicalKey;
  if (!canonicalKey) {
    return null;
  }

  if (groupingMode === "repository") {
    return canonicalKey;
  }

  const relativeProjectPath = deriveRepositoryRelativeProjectPath(project);
  if (relativeProjectPath === null) {
    return canonicalKey;
  }

  return relativeProjectPath.length === 0
    ? canonicalKey
    : `${canonicalKey}::${relativeProjectPath}`;
}

export function deriveLogicalProjectKey(
  project: Pick<
    EnvironmentProject,
    "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity"
  >,
  options?: {
    readonly groupingMode?: SidebarProjectGroupingMode;
  },
): string {
  const groupingMode = options?.groupingMode ?? "repository";
  if (groupingMode === "separate") {
    return derivePhysicalProjectKey(project);
  }

  return (
    deriveRepositoryScopedKey(project, groupingMode) ??
    derivePhysicalProjectKey(project) ??
    scopedProjectKey(scopeProjectRef(project.environmentId, project.id))
  );
}

export function deriveLogicalProjectKeyFromSettings(
  project: Pick<
    EnvironmentProject,
    "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity"
  >,
  settings: ProjectGroupingSettings,
): string {
  return deriveLogicalProjectKey(project, {
    groupingMode: resolveProjectGroupingMode(project, settings),
  });
}

export function deriveLogicalProjectKeyFromRef(
  projectRef: ScopedProjectRef,
  project:
    | Pick<EnvironmentProject, "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity">
    | null
    | undefined,
  options?: {
    readonly groupingMode?: SidebarProjectGroupingMode;
  },
): string {
  return project ? deriveLogicalProjectKey(project, options) : scopedProjectKey(projectRef);
}

export function deriveProjectGroupLabel(input: {
  readonly representative: Pick<EnvironmentProject, "title" | "repositoryIdentity">;
  readonly members: ReadonlyArray<Pick<EnvironmentProject, "title" | "repositoryIdentity">>;
}): string {
  const sharedDisplayNames = uniqueNonEmptyValues(
    input.members.map((member) => member.repositoryIdentity?.displayName),
  );
  if (sharedDisplayNames.length === 1) {
    return sharedDisplayNames[0]!;
  }

  const sharedRepositoryNames = uniqueNonEmptyValues(
    input.members.map((member) => member.repositoryIdentity?.name),
  );
  if (sharedRepositoryNames.length === 1) {
    return sharedRepositoryNames[0]!;
  }

  return input.representative.title;
}
