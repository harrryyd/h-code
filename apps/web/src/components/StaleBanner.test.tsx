import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { StaleBanner } from "./StaleBanner";

describe("StaleBanner", () => {
  it("renders banner with no outdated comments", () => {
    const markup = renderToStaticMarkup(
      <StaleBanner outdatedCommentCount={0} onRefresh={() => {}} />,
    );

    expect(markup).toContain("This PR has been updated since you opened review mode");
    expect(markup).toContain("Refresh view");
    expect(markup).not.toContain("outdated");
  });

  it("renders banner with outdated comment count", () => {
    const markup = renderToStaticMarkup(
      <StaleBanner outdatedCommentCount={3} onRefresh={() => {}} />,
    );

    expect(markup).toContain("3 comments outdated");
    expect(markup).toContain("Refresh view");
  });

  it("uses singular form for single outdated comment", () => {
    const markup = renderToStaticMarkup(
      <StaleBanner outdatedCommentCount={1} onRefresh={() => {}} />,
    );

    expect(markup).toContain("1 comment outdated");
    expect(markup).not.toContain("comments outdated");
  });

  it("renders refresh button with icon", () => {
    const markup = renderToStaticMarkup(
      <StaleBanner outdatedCommentCount={2} onRefresh={() => {}} />,
    );

    expect(markup).toContain("Refresh view");
    expect(markup).toContain("lucide-refresh-cw");
  });
});
