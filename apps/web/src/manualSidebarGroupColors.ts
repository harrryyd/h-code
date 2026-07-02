import type { ManualSidebarGroupColorPalette } from "@t3tools/contracts/settings";

export const MANUAL_SIDEBAR_GROUP_COLOR_SWATCH: Record<ManualSidebarGroupColorPalette, string> = {
  slate: "#64748b",
  sky: "#0ea5e9",
  mint: "#10b981",
  sage: "#84cc16",
  amber: "#f59e0b",
  peach: "#fb7185",
  rose: "#f43f5e",
  lavender: "#a78bfa",
};

export const MANUAL_SIDEBAR_GROUP_COLOR_LABELS: Record<ManualSidebarGroupColorPalette, string> = {
  slate: "Slate",
  sky: "Sky",
  mint: "Mint",
  sage: "Sage",
  amber: "Amber",
  peach: "Peach",
  rose: "Rose",
  lavender: "Lavender",
};

export const MANUAL_SIDEBAR_GROUP_COLOR_OPTIONS = Object.entries(
  MANUAL_SIDEBAR_GROUP_COLOR_LABELS,
) as ReadonlyArray<readonly [ManualSidebarGroupColorPalette, string]>;
