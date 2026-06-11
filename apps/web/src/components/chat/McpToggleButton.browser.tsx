import "../../index.css";

import { EnvironmentId, ThreadId, type McpServerSnapshot } from "@t3tools/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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
const SECOND_THREAD_ID = ThreadId.make("thread-mcp-toggle-browser-2");
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

async function mountButton(props?: { threadId?: ThreadId; environmentId?: EnvironmentId }) {
  const host = document.createElement("div");
  document.body.append(host);
  const threadId = props?.threadId ?? THREAD_ID;
  const environmentId = props?.environmentId ?? ENVIRONMENT_ID;

  const screen = await render(
    <McpToggleButton environmentId={environmentId} threadId={threadId} />,
    { container: host },
  );

  return {
    rerender: async (nextProps?: { threadId?: ThreadId; environmentId?: EnvironmentId }) => {
      await screen.rerender(
        <McpToggleButton
          environmentId={nextProps?.environmentId ?? environmentId}
          threadId={nextProps?.threadId ?? threadId}
        />,
      );
    },
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

function deferredListServersResolver(label: string) {
  return () => {
    throw new Error(`Expected ${label} MCP list resolver to be captured.`);
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
    let resolveListServers: (value: { servers: ReadonlyArray<McpServerSnapshot> }) => void =
      deferredListServersResolver("first");
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
    let resolveListServers: (value: { servers: ReadonlyArray<McpServerSnapshot> }) => void =
      deferredListServersResolver("second");
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

  it("clears stale servers when the thread changes while the menu stays open", async () => {
    let resolveCurrentListServers: (value: { servers: ReadonlyArray<McpServerSnapshot> }) => void =
      deferredListServersResolver("current");
    const listServers = vi.fn(
      ({ threadId }: { threadId: ThreadId }) =>
        new Promise<{ servers: ReadonlyArray<McpServerSnapshot> }>((resolve) => {
          resolveCurrentListServers = resolve;
          if (threadId === THREAD_ID) {
            resolve({ servers: [createServer("filesystem", "connected")] });
          }
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

      await expect.element(page.getByText("filesystem")).toBeVisible();

      await mounted.rerender({ threadId: SECOND_THREAD_ID });

      await vi.waitFor(() => {
        expect(listServers).toHaveBeenCalledTimes(2);
      });

      expect(document.body.textContent ?? "").not.toContain("filesystem");

      resolveCurrentListServers({ servers: [createServer("github", "connected")] });
      await vi.runAllTimersAsync();

      await expect.element(page.getByText("github")).toBeVisible();
      expect(document.body.textContent ?? "").not.toContain("filesystem");
    } finally {
      await mounted.cleanup();
    }
  });

  it("ignores a late response from a closed menu before reopening", async () => {
    let requestCount = 0;
    let resolveFirstListServers: (value: { servers: ReadonlyArray<McpServerSnapshot> }) => void =
      deferredListServersResolver("first");
    let resolveSecondListServers: (value: { servers: ReadonlyArray<McpServerSnapshot> }) => void =
      deferredListServersResolver("second");
    const listServers = vi.fn(
      () =>
        new Promise<{ servers: ReadonlyArray<McpServerSnapshot> }>((resolve) => {
          requestCount += 1;
          if (requestCount === 1) {
            resolveFirstListServers = resolve;
            return;
          }
          resolveSecondListServers = resolve;
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
      const trigger = page.getByRole("button", { name: "MCP", exact: true });
      await trigger.click();
      await trigger.click();
      resolveFirstListServers({ servers: [createServer("filesystem", "connected")] });
      await vi.runAllTimersAsync();

      await trigger.click();

      await vi.waitFor(() => {
        expect(listServers).toHaveBeenCalledTimes(2);
      });

      expect(document.body.textContent ?? "").not.toContain("filesystem");

      resolveSecondListServers({ servers: [createServer("github", "connected")] });
      await vi.runAllTimersAsync();

      await expect.element(page.getByText("github")).toBeVisible();
      expect(document.body.textContent ?? "").not.toContain("filesystem");
    } finally {
      await mounted.cleanup();
    }
  });
});
