import type { EnvironmentId, McpServerSnapshot, ThreadId } from "@t3tools/contracts";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { RefreshCwIcon, WrenchIcon } from "lucide-react";

import { readEnvironmentApi } from "~/environmentApi";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const STATUS_COPY: Record<McpServerSnapshot["status"], { label: string; dotClassName: string }> = {
  connected: {
    label: "Connected",
    dotClassName: "bg-emerald-500",
  },
  failed: {
    label: "Failed",
    dotClassName: "bg-red-500",
  },
  "needs-auth": {
    label: "Needs auth",
    dotClassName: "bg-amber-500",
  },
  pending: {
    label: "Pending",
    dotClassName: "bg-sky-500",
  },
  disabled: {
    label: "Disabled",
    dotClassName: "bg-muted-foreground/35",
  },
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

export const McpToggleButton = memo(function McpToggleButton(props: {
  threadId: ThreadId;
  environmentId: EnvironmentId;
  compact?: boolean;
}) {
  const { compact = false, environmentId, threadId } = props;
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<ReadonlyArray<McpServerSnapshot>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [pendingServerNames, setPendingServerNames] = useState<ReadonlySet<string>>(new Set());
  const loadGenerationRef = useRef(0);
  const api = readEnvironmentApi(environmentId);

  const loadServers = useCallback(async () => {
    if (!api) {
      setServers([]);
      setLoadingError("Environment connection unavailable.");
      return;
    }

    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setIsLoading(true);
    setLoadingError(null);

    try {
      const result = await api.mcp.listServers({ threadId });
      if (loadGenerationRef.current !== generation) return;
      setServers(result.servers);
    } catch (error) {
      if (loadGenerationRef.current !== generation) return;
      setServers([]);
      setLoadingError(toErrorMessage(error, "Failed to load MCP servers."));
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [api, threadId]);

  useEffect(() => {
    if (!open) return;
    void loadServers();
  }, [loadServers, open]);

  const toggleServer = useCallback(
    async (serverName: string, enabled: boolean) => {
      if (!api) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "MCP toggle unavailable",
            description: "Environment connection unavailable.",
          }),
        );
        return;
      }

      setPendingServerNames((current) => new Set(current).add(serverName));
      try {
        await api.mcp.toggleServer({
          threadId,
          mcpServerName: serverName,
          enabled,
        });
        await loadServers();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update MCP server",
            description: toErrorMessage(error, `Could not update '${serverName}'.`),
          }),
        );
        await loadServers();
      } finally {
        setPendingServerNames((current) => {
          const next = new Set(current);
          next.delete(serverName);
          return next;
        });
      }
    },
    [api, loadServers, threadId],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "min-w-0 shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80",
              compact ? "sm:pl-2" : "sm:px-3",
            )}
            type="button"
          />
        }
      >
        <WrenchIcon className="size-4" />
        <span className="sr-only sm:not-sr-only">MCP</span>
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        className="w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-border/70 bg-popover/98 p-0 shadow-lg/10 backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
          <div>
            <div className="text-sm font-medium">MCP Servers</div>
            <div className="text-xs text-muted-foreground">Toggle Claude thread tools</div>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => void loadServers()}
            disabled={isLoading}
            aria-label="Refresh MCP server status"
            type="button"
          >
            {isLoading ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" />}
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {isLoading && servers.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg px-2 py-3 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading MCP servers...
            </div>
          ) : loadingError ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {loadingError}
            </div>
          ) : servers.length === 0 ? (
            <div className="rounded-lg px-3 py-2 text-sm text-muted-foreground">
              No configured MCP servers were reported by Claude.
            </div>
          ) : (
            <div className="space-y-1">
              {servers.map((server) => {
                const statusMeta = STATUS_COPY[server.status];
                const isPending = pendingServerNames.has(server.name);
                return (
                  <div
                    key={server.name}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/35"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {server.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="inline-flex items-center gap-1.5 outline-none" />
                            }
                          >
                            <span
                              aria-hidden="true"
                              className={cn("size-2 rounded-full", statusMeta.dotClassName)}
                            />
                            <span>{statusMeta.label}</span>
                          </TooltipTrigger>
                          <TooltipPopup side="top">{statusMeta.label}</TooltipPopup>
                        </Tooltip>
                      </div>
                    </div>
                    {isPending ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
                    <Switch
                      checked={server.status !== "disabled"}
                      disabled={isPending}
                      onCheckedChange={(checked) =>
                        void toggleServer(server.name, Boolean(checked))
                      }
                      aria-label={`Toggle MCP server ${server.name}`}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
});
