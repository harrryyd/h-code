import { describe, expect, it } from "vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";

import {
  buildSidebarProjectCollection,
  type SidebarProjectSnapshot,
} from "./sidebarProjectGrouping";
import type { Project } from "./types";

const primaryEnvId = EnvironmentId.make("env-primary");
const remoteEnvId = EnvironmentId.make("env-remote");

function makeProject(
  overrides: Partial<Project> & Pick<Project, "id" | "environmentId" | "name">,
): Project {
  return {
    cwd: `/tmp/${overrides.name}-${overrides.id}`,
    defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
    ...overrides,
  };
}

function findSnapshot(
  snapshots: readonly SidebarProjectSnapshot[],
  name: string,
): SidebarProjectSnapshot | undefined {
  return snapshots.find((snapshot) => snapshot.name === name);
}

describe("buildSidebarProjectCollection", () => {
  it("renders manual sections ahead of the implicit ungrouped list and keeps empty groups", () => {
    const frontendProject = makeProject({
      id: ProjectId.make("frontend"),
      environmentId: primaryEnvId,
      name: "frontend",
    });
    const backendProject = makeProject({
      id: ProjectId.make("backend"),
      environmentId: primaryEnvId,
      name: "backend",
    });

    const result = buildSidebarProjectCollection({
      projects: [frontendProject, backendProject],
      groupingSettings: {
        sidebarProjectGroupingMode: "repository",
        sidebarProjectGroupingOverrides: {},
      },
      manualGroupSettings: {
        manualSidebarGroups: [
          { id: "frontend", name: "Frontend", collapsed: false },
          { id: "ops", name: "Ops", collapsed: true },
        ],
        projectManualSidebarGroupAssignments: {
          "env-primary:/tmp/frontend-frontend": "frontend",
        },
      },
      primaryEnvironmentId: primaryEnvId,
      resolveEnvironmentLabel: () => null,
    });

    expect(result.sections).toEqual([
      {
        id: "group:frontend",
        kind: "manual",
        title: "Frontend",
        collapsed: false,
        projectKeys: ["group:frontend::env-primary:/tmp/frontend-frontend"],
      },
      {
        id: "group:ops",
        kind: "manual",
        title: "Ops",
        collapsed: true,
        projectKeys: [],
      },
      {
        id: "ungrouped",
        kind: "ungrouped",
        title: "Ungrouped",
        collapsed: false,
        projectKeys: ["ungrouped::env-primary:/tmp/backend-backend"],
      },
    ]);
    expect(findSnapshot(result.snapshots, "frontend")?.projectKey).toBe(
      "group:frontend::env-primary:/tmp/frontend-frontend",
    );
    expect(findSnapshot(result.snapshots, "backend")?.projectKey).toBe(
      "ungrouped::env-primary:/tmp/backend-backend",
    );
  });

  it("splits cross-environment logical groups when member projects belong to different manual sections", () => {
    const sharedCanonicalKey = "github.com/example/shared-repo";
    const primaryProject = makeProject({
      id: ProjectId.make("shared-primary"),
      environmentId: primaryEnvId,
      name: "shared",
      cwd: "/tmp/shared-primary",
      repositoryIdentity: {
        canonicalKey: sharedCanonicalKey,
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/example/shared-repo.git",
        },
      },
    });
    const remoteProject = makeProject({
      id: ProjectId.make("shared-remote"),
      environmentId: remoteEnvId,
      name: "shared",
      cwd: "/tmp/shared-remote",
      repositoryIdentity: {
        canonicalKey: sharedCanonicalKey,
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/example/shared-repo.git",
        },
      },
    });

    const result = buildSidebarProjectCollection({
      projects: [primaryProject, remoteProject],
      groupingSettings: {
        sidebarProjectGroupingMode: "repository",
        sidebarProjectGroupingOverrides: {},
      },
      manualGroupSettings: {
        manualSidebarGroups: [{ id: "frontend", name: "Frontend", collapsed: false }],
        projectManualSidebarGroupAssignments: {
          "env-primary:/tmp/shared-primary": "frontend",
        },
      },
      primaryEnvironmentId: primaryEnvId,
      resolveEnvironmentLabel: (environmentId) =>
        environmentId === remoteEnvId ? "Remote" : environmentId === primaryEnvId ? "Local" : null,
    });

    expect(result.sections.map((section) => section.id)).toEqual(["group:frontend", "ungrouped"]);
    expect(result.snapshots).toHaveLength(2);

    const frontendSnapshot = result.snapshots.find((snapshot) =>
      snapshot.projectKey.startsWith("group:frontend::"),
    );
    const ungroupedSnapshot = result.snapshots.find((snapshot) =>
      snapshot.projectKey.startsWith("ungrouped::"),
    );

    expect(frontendSnapshot?.groupedProjectCount).toBe(1);
    expect(ungroupedSnapshot?.groupedProjectCount).toBe(1);
    expect(result.physicalToSnapshotProjectKey.get("env-primary:/tmp/shared-primary")).toBe(
      frontendSnapshot?.projectKey,
    );
    expect(result.physicalToSnapshotProjectKey.get("env-remote:/tmp/shared-remote")).toBe(
      ungroupedSnapshot?.projectKey,
    );
  });
});
