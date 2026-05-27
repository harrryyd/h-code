import "../../index.css";

import { EnvironmentId, ThreadId, type McpServerSnapshot } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const LOADING_INDICATOR_DELAY_MS = 150;

const { environmentApiById, readEnvironmentApiMock } = vi.hoisted(() => ({
  environmentApiById: new Map<
    string,
    {
      mcp: {
        listServers: ReturnType<typeof vi.fn>;
        toggleServer: ReturnType<typeof vi.fn>;
      };
    }
  >(),
  readEnvironmentApiMock: vi.fn((environmentId: string) => environmentApiById.get(environmentId)),
}));

vi.mock("~/environmentApi", () => ({
  readEnvironmentApi: readEnvironmentApiMock,
}));

import { McpToggleButton } from "./McpToggleButton";

const THREAD_ID = ThreadId.make("thread-mcp-toggle-browser");
const ENVIRONMENT_ID = EnvironmentId.make("environment-mcp-toggle-browser");

function createServer(name: string, status: McpServerSnapshot["status"]): McpServerSnapshot {
  return {
    name,
    status,
  };
}

function isLoadingRowVisible(): boolean {
  return document.querySelector('[data-mcp-loading-state="visible"]') !== null;
}

async function mountButton() {
  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(
    <McpToggleButton environmentId={ENVIRONMENT_ID} threadId={THREAD_ID} />,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("McpToggleButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    environmentApiById.clear();
    readEnvironmentApiMock.mockClear();
    vi.useRealTimers();
  });

  it("does not flash loading chrome on fast initial open", async () => {
    let resolveListServers: (value: { servers: ReadonlyArray<McpServerSnapshot> }) => void = () => {
      throw new Error("Expected MCP list resolver to be captured.");
    };
    const listServers = vi.fn(
      () =>
        new Promise<{ servers: ReadonlyArray<McpServerSnapshot> }>((resolve) => {
          resolveListServers = resolve;
        }),
    );
    environmentApiById.set(ENVIRONMENT_ID, {
      mcp: {
        listServers,
        toggleServer: vi.fn(async () => undefined),
      },
    });

    const mounted = await mountButton();

    try {
      await page.getByRole("button", { name: "MCP" }).click();

      expect(listServers).toHaveBeenCalledTimes(1);

      expect(isLoadingRowVisible()).toBe(false);

      await vi.advanceTimersByTimeAsync(100);

      expect(isLoadingRowVisible()).toBe(false);

      resolveListServers({ servers: [createServer("filesystem", "connected")] });
      await vi.runAllTimersAsync();

      await expect.element(page.getByText("filesystem")).toBeVisible();
      expect(isLoadingRowVisible()).toBe(false);
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows loading chrome when the initial load is slow", async () => {
    let resolveListServers: (value: { servers: ReadonlyArray<McpServerSnapshot> }) => void = () => {
      throw new Error("Expected MCP list resolver to be captured.");
    };
    const listServers = vi.fn(
      () =>
        new Promise<{ servers: ReadonlyArray<McpServerSnapshot> }>((resolve) => {
          resolveListServers = resolve;
        }),
    );
    environmentApiById.set(ENVIRONMENT_ID, {
      mcp: {
        listServers,
        toggleServer: vi.fn(async () => undefined),
      },
    });

    const mounted = await mountButton();

    try {
      await page.getByRole("button", { name: "MCP" }).click();

      expect(listServers).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(LOADING_INDICATOR_DELAY_MS + 1);

      await vi.waitFor(() => {
        expect(isLoadingRowVisible()).toBe(true);
      });

      resolveListServers({ servers: [createServer("filesystem", "connected")] });
      await vi.runAllTimersAsync();

      await expect.element(page.getByText("filesystem")).toBeVisible();
    } finally {
      await mounted.cleanup();
    }
  });
});
