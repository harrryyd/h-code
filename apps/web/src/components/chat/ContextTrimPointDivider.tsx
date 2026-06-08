import { type ContextTrimPoint } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { memo, useState } from "react";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

interface ContextTrimPointDividerProps {
  id: string;
  createdAt: string;
  trimPoint: ContextTrimPoint;
}

export const ContextTrimPointDivider = memo(function ContextTrimPointDivider({
  trimPoint,
}: ContextTrimPointDividerProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-3 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="flex h-6 items-center gap-1.5 rounded-full border border-border/50 bg-card/45 px-2.5 py-0.5 text-[10px] text-muted-foreground/70 hover:bg-card/70 hover:text-foreground/80"
        aria-expanded={expanded}
        data-scroll-anchor-ignore
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronDownIcon
          className={cn("size-3 transition-transform", expanded ? "rotate-0" : "-rotate-90")}
        />
        <span>Earlier messages</span>
        {trimPoint.prunedMessageCount > 0 && (
          <span className="text-muted-foreground/50">
            {trimPoint.prunedMessageCount.toLocaleString()} messages pruned
          </span>
        )}
      </Button>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
});
