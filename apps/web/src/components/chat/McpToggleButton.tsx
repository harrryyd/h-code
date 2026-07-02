import type { EnvironmentId, McpServerSnapshot, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { RefreshCwIcon, WrenchIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const LOADING_INDICATOR_DELAY_MS = 150;

const STATUS_COPY: Record<McpServerSnapshot["status"], { label: string; dotClassName: string }> = {
  connected: { label: "Connected", dotClassName: "bg-emerald-500" },
  failed: { label: "Failed", dotClassName: "bg-red-500" },
  "needs-auth": { label: "Needs auth", dotClassName: "bg-amber-500" },
  pending: { label: "Pending", dotClassName: "bg-sky-500" },
  disabled: { label: "Disabled", dotClassName: "bg-muted-foreground/35" },
};

export const McpToggleButton = memo(function McpToggleButton(props: {
  threadId: ThreadId;
  environmentId: EnvironmentId;
  compact?: boolean;
}) {
  const { compact = false, environmentId, threadId } = props;
  const listServers = useAtomCommand(serverEnvironment.listMcpServers, {
    reportFailure: false,
  });
  const toggleServerCommand = useAtomCommand(serverEnvironment.toggleMcpServer, {
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<ReadonlyArray<McpServerSnapshot>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const [hasResolvedServers, setHasResolvedServers] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [pendingServerNames, setPendingServerNames] = useState<ReadonlySet<string>>(new Set());
  const loadGenerationRef = useRef(0);
  const loadingIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoadingIndicatorDelay = useCallback(() => {
    if (loadingIndicatorTimeoutRef.current !== null) {
      clearTimeout(loadingIndicatorTimeoutRef.current);
      loadingIndicatorTimeoutRef.current = null;
    }
  }, []);

  const queueLoadingIndicator = useCallback(
    (generation: number) => {
      clearLoadingIndicatorDelay();
      setShowLoadingIndicator(false);
      loadingIndicatorTimeoutRef.current = setTimeout(() => {
        if (loadGenerationRef.current === generation) setShowLoadingIndicator(true);
        loadingIndicatorTimeoutRef.current = null;
      }, LOADING_INDICATOR_DELAY_MS);
    },
    [clearLoadingIndicatorDelay],
  );

  const loadServers = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setIsLoading(true);
    setLoadingError(null);
    queueLoadingIndicator(generation);

    const result = await listServers({ environmentId, input: { threadId } });
    if (loadGenerationRef.current !== generation) return;
    if (result._tag === "Success") {
      setServers(result.value.servers);
      setHasResolvedServers(true);
    } else {
      setServers([]);
      setLoadingError(Cause.pretty(result.cause));
      setHasResolvedServers(true);
    }
    clearLoadingIndicatorDelay();
    setIsLoading(false);
    setShowLoadingIndicator(false);
  }, [clearLoadingIndicatorDelay, environmentId, listServers, queueLoadingIndicator, threadId]);

  useEffect(() => {
    if (open) void loadServers();
    else {
      clearLoadingIndicatorDelay();
      setShowLoadingIndicator(false);
    }
  }, [clearLoadingIndicatorDelay, loadServers, open]);

  useEffect(() => () => clearLoadingIndicatorDelay(), [clearLoadingIndicatorDelay]);

  const toggleServer = useCallback(
    async (serverName: string, enabled: boolean) => {
      setPendingServerNames((current) => new Set(current).add(serverName));
      const result = await toggleServerCommand({
        environmentId,
        input: { threadId, mcpServerName: serverName, enabled },
      });
      if (result._tag === "Failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update MCP server",
            description: Cause.pretty(result.cause),
          }),
        );
      }
      await loadServers();
      setPendingServerNames((current) => {
        const next = new Set(current);
        next.delete(serverName);
        return next;
      });
    },
    [environmentId, loadServers, threadId, toggleServerCommand],
  );

  const waiting = isLoading && !hasResolvedServers && servers.length === 0 && loadingError === null;

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
            {showLoadingIndicator ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {waiting && showLoadingIndicator ? (
            <div className="flex items-center gap-2 rounded-lg px-2 py-3 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading MCP servers...
            </div>
          ) : waiting ? (
            <div aria-hidden="true" className="h-10 opacity-0">
              Loading MCP servers...
            </div>
          ) : loadingError ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {loadingError}
            </div>
          ) : hasResolvedServers && servers.length === 0 ? (
            <div className="rounded-lg px-3 py-2 text-sm text-muted-foreground">
              No configured MCP servers were reported by Claude.
            </div>
          ) : (
            <div className="space-y-1">
              {servers.map((server) => {
                const status = STATUS_COPY[server.status];
                const pending = pendingServerNames.has(server.name);
                return (
                  <div
                    key={server.name}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/35"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{server.name}</div>
                      <Tooltip>
                        <TooltipTrigger
                          render={<span className="inline-flex items-center gap-1.5 text-xs" />}
                        >
                          <span className={cn("size-2 rounded-full", status.dotClassName)} />
                          <span>{status.label}</span>
                        </TooltipTrigger>
                        <TooltipPopup side="top">{status.label}</TooltipPopup>
                      </Tooltip>
                    </div>
                    {pending ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
                    <Switch
                      checked={server.status !== "disabled"}
                      disabled={pending}
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
