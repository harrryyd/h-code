import { ChevronDownIcon } from "lucide-react";
import { memo } from "react";

interface ContextSummaryBannerProps {
  summary: string;
}

export const ContextSummaryBanner = memo(function ContextSummaryBanner({
  summary,
}: ContextSummaryBannerProps) {
  if (!summary) return null;

  return (
    <div className="my-2 rounded-lg border border-blue-500/15 bg-blue-500/5 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5">
        <ChevronDownIcon className="size-3.5 shrink-0 rotate-180 text-blue-500/60" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-500/70">
          Context compacted
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground/70">{summary}</p>
    </div>
  );
});
