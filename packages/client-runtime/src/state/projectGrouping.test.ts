import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveProjectThreadDefaultOverrideKey,
  resolveProjectThreadEnvMode,
} from "./projectGrouping.ts";

const remoteProject = {
  environmentId: EnvironmentId.make("remote"),
  workspaceRoot: "/repo",
};

describe("project thread defaults", () => {
  it("uses a target-environment override before the legacy primary fallback", () => {
    const key = deriveProjectThreadDefaultOverrideKey(remoteProject);
    expect(
      resolveProjectThreadEnvMode({
        project: remoteProject,
        target: {
          defaultThreadEnvMode: "local",
          projectThreadDefaults: { [key]: "worktree" },
        },
        legacyPrimary: {
          defaultThreadEnvMode: "worktree",
          projectThreadDefaults: { [key]: "local" },
        },
      }),
    ).toBe("worktree");
  });

  it("reads a legacy primary override only while the target has none", () => {
    const key = deriveProjectThreadDefaultOverrideKey(remoteProject);
    expect(
      resolveProjectThreadEnvMode({
        project: remoteProject,
        target: { defaultThreadEnvMode: "local", projectThreadDefaults: {} },
        legacyPrimary: {
          defaultThreadEnvMode: "local",
          projectThreadDefaults: { [key]: "worktree" },
        },
      }),
    ).toBe("worktree");
  });

  it("resolves inherit against the target environment default", () => {
    const key = deriveProjectThreadDefaultOverrideKey(remoteProject);
    expect(
      resolveProjectThreadEnvMode({
        project: remoteProject,
        target: {
          defaultThreadEnvMode: "worktree",
          projectThreadDefaults: { [key]: "inherit" },
        },
        legacyPrimary: {
          defaultThreadEnvMode: "local",
          projectThreadDefaults: { [key]: "local" },
        },
      }),
    ).toBe("worktree");
  });
});
