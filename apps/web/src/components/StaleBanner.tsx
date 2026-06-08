import { RefreshCwIcon } from "lucide-react";

interface StaleBannerProps {
  outdatedCommentCount: number;
  onRefresh: () => void;
}

export function StaleBanner({ outdatedCommentCount, onRefresh }: StaleBannerProps) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <span className="text-[11px] text-amber-400/90">
        This PR has been updated since you opened review mode
        {outdatedCommentCount > 0 && (
          <span>
            {" "}
            ({outdatedCommentCount} comment{outdatedCommentCount !== 1 ? "s" : ""} outdated)
          </span>
        )}
        .
      </span>
      <button
        type="button"
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm bg-amber-500/20 px-2 text-[10px] font-medium text-amber-400 hover:bg-amber-500/30"
        onClick={onRefresh}
      >
        <RefreshCwIcon className="size-3" />
        Refresh view
      </button>
    </div>
  );
}
